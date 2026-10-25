"""Resumable proof-guided composition. A proof candidate is not a ranked release."""
from __future__ import annotations

import copy
from pathlib import Path
import shutil
import time

from .common import (atomic_json,canonical,digest,read_json,records,solution_fingerprint,
                     tactical_core,workspace_lock)
from .generate import certify,generate,NeuralOrdering,proof_line
from .model import load_model
from .rules import State,terminal
from .solver import verify_certificate,Solver,Limits
from .portable import file_hash


def minimize(candidate,model,seconds=1,nodes=60000):
    """Remove real stones, reprove every requirement after each accepted edit."""
    result=copy.deepcopy(candidate)
    removed=[]
    original_id=result["id"]
    points=[p for p,c in enumerate(result["board"]) if c and p not in result["targets"]]
    points.sort(key=lambda p:min(abs(p % 19-q % 19)+abs(p//19-q//19)
                                for q in result["targets"]),reverse=True)
    for point in points:
        trial=copy.deepcopy(result)
        trial["board"][point]=0
        try:
            State.setup(19,trial["board"],trial["to_play"],trial["targets"])
        except ValueError:
            continue
        ordering=NeuralOrdering(model,trial["category"],trial["to_play"])
        proof=certify(trial,trial["requested_own_moves"],seconds,nodes,policy=ordering)
        if proof.get("export_eligible"):
            result=trial
            result["verification"]=proof
            removed.append(point)
    result["id"]=digest(("minimized",canonical(result["board"],19,result["to_play"]),
                         result["category"],result.get("anchor_groups"),result["requested_own_moves"]))[:24]
    result["core_fingerprint"]=tactical_core(result["board"],result["targets"],result["to_play"])
    result["solution_pattern"]=solution_fingerprint(result["verification"]["solution"],result["to_play"])
    result["minimization"]={"original_id":original_id,"removed":removed}
    return result


def replay_proofs(row):
    """Recheck under the current objective rules, including old cached candidates."""
    initial=State.setup(19,row["board"],row["to_play"],row["targets"])
    result=row["verification"]
    solution=result["solution"]
    if not solution or sum(m["color"] == row["to_play"] for m in solution) != row["requested_own_moves"]:
        raise ValueError("Cached demonstration has the wrong own-move count")
    required={move for move,_ in initial.legal()}-{solution[0]["move"]}
    refuted=[entry["move"] for entry in result["first_move_refutations"]]
    if set(refuted) != required or len(set(refuted)) != len(refuted):
        raise ValueError("Cached first-move coverage is incomplete")
    if (result["certificate"].get("deadline_plies") is not None
            or solution != proof_line(initial,result["certificate"])):
        raise ValueError("Cached demonstration is not the full proof's longest defense")
    proofs=[(initial,result["certificate"])]
    lower=result.get("minimum_depth_certificate")
    if row["requested_own_moves"] > 1:
        if (not lower or lower.get("deadline_plies") != 2*(row["requested_own_moves"]-1)-1
                or lower["nodes"][lower["root"]]["outcome"] != -1):
            raise ValueError("Cached minimum-depth proof is missing or has a different horizon")
        proofs.append((initial,lower))
    for entry in result["first_move_refutations"]:
        proof=entry["certificate"]
        if proof.get("deadline_plies") is not None or proof["nodes"][proof["root"]]["outcome"] != -1:
            raise ValueError("Cached first-move refutation is incomplete")
    proofs.extend((initial.play(entry["move"]),entry["certificate"])
                  for entry in result["first_move_refutations"])
    for state,proof in proofs:
        if proof["goal"] != row["category"] or proof["player"] != row["to_play"]:
            raise ValueError("Cached proof objective changed")
        if proof.get("anchor_groups",[]) != row.get("anchor_groups",[]):
            raise ValueError("Cached proof anchor groups changed")
        verify_certificate(state,proof)
    if result["certificate"]["nodes"][result["certificate"]["root"]]["outcome"] != 1:
        raise ValueError("Cached main proof does not establish success")
    state=initial
    for move in solution:
        if move["color"] != state.to_play or move["move"] < 0:
            raise ValueError("Invalid cached main demonstration")
        state=state.play(move["move"])
    if terminal(state,row["category"],row["to_play"],row.get("anchor_groups",())) != 1:
        raise ValueError("The demonstrated endpoint no longer satisfies the objective")
    wrong=result["wrong_variations"]
    if len(wrong) != 2 or len({w["moves"][0]["move"] for w in wrong}) != 2:
        raise ValueError("Two distinct cached error paths are required")
    for variation in wrong:
        state=initial
        if not 2 <= len(variation["moves"]) <= 4:
            raise ValueError("Invalid cached error-path length")
        proof=variation["certificate"]
        first=variation["moves"][0]
        if first["color"] != initial.to_play or first["move"] == solution[0]["move"]:
            raise ValueError("Invalid cached error-path first move")
        verify_certificate(initial.play(first["move"]),proof)
        if (proof.get("deadline_plies") is not None or proof["nodes"][proof["root"]]["outcome"] != -1
                or proof["goal"] != row["category"] or proof["player"] != row["to_play"]
                or proof.get("anchor_groups",[]) != row.get("anchor_groups",[])):
            raise ValueError("Cached error-path proof does not establish this failure")
        if variation["moves"][1:] != proof_line(initial.play(first["move"]),proof):
            raise ValueError("Cached error path is not its proof's demonstration")
        for move in variation["moves"]:
            if move["color"] != state.to_play or move["move"] < 0:
                raise ValueError("Invalid cached error-path move")
            state=state.play(move["move"])
        if terminal(state,row["category"],row["to_play"],row.get("anchor_groups",())) != -1:
            raise ValueError("A displayed error path does not reach its proved failure")


def recheck_refutations(row,model,seconds=30,stop_requested=None):
    """Continue actual counterproofs; UNKNOWN never becomes an incorrect move.

    The queue survives batch boundaries. Complete unsuccessful passes increase
    the per-move budget, up to three passes, rather than repeatedly abandoning
    an almost complete puzzle after the same short first-move timeout.
    """
    result=row["verification"]
    initial=State.setup(19,row["board"],row["to_play"],row["targets"])
    for proof in (result["certificate"],result.get("minimum_depth_certificate")):
        if proof:
            if (proof["goal"] != row["category"] or proof["player"] != row["to_play"]
                    or proof.get("anchor_groups",[]) != row.get("anchor_groups",[])):
                raise ValueError("The pending proof objective changed")
            verify_certificate(initial,proof)
    saved=row.setdefault("refutation_recheck",{"pass":0,"queue":list(result["unresolved_initial_moves"]),
                                               "next_queue":[],"calls":0})
    start=time.monotonic()
    while saved["pass"] < 3 and not result.get("other_winning_first_moves"):
        if not saved["queue"]:
            if not saved["next_queue"]:
                break
            saved["pass"]+=1
            saved["queue"],saved["next_queue"]=saved["next_queue"],[]
            if saved["pass"] >= 3:
                break
        left=seconds-(time.monotonic()-start)
        if left < .05 or (stop_requested and stop_requested()):
            break
        move=saved["queue"].pop(0)
        child=initial.play(move)
        budget=min(left,(2,5,15)[saved["pass"]])
        policy=NeuralOrdering(model,row["category"],row["to_play"],max_calls=4) if model else None
        answer=Solver(row["category"],row["to_play"],Limits(min(8,row["requested_own_moves"]+3),300000,budget),
                      policy=policy,seek=-1,anchors=row.get("anchor_groups",())).solve(child,allow_captured_target=True)
        saved["calls"]+=1
        if answer["status"] == "proven-loss":
            result["first_move_refutations"].append({"move":move,"certificate":answer["certificate"]})
            result["unresolved_initial_moves"].remove(move)
            refutation=[{"color":initial.to_play,"move":move}]+proof_line(child,answer["certificate"])
            if (len(result["wrong_variations"]) < 2 and 2 <= len(refutation) <= 4
                    and all(m["move"] >= 0 for m in refutation)):
                result["wrong_variations"].append({"status":"incorrect","moves":refutation,
                    "feedback_after_ply":len(refutation),"certificate":answer["certificate"],
                    "endpoint":"goal-prevention-proven"})
        elif answer["status"] == "proven-win":
            result["other_winning_first_moves"].append(move)
            result["unresolved_initial_moves"].remove(move)
        else:
            saved["next_queue"].append(move)
    result["all_initial_moves_resolved"]=not result["unresolved_initial_moves"]
    result["unique_first_move"]=result["all_initial_moves_resolved"] and not result["other_winning_first_moves"]
    blockers=[b for b in result["export_blockers"] if b not in
              ("unresolved-first-moves","multiple-correct-first-moves","two-refutations-not-proven")]
    if result["unresolved_initial_moves"]:
        blockers.append("unresolved-first-moves")
    if result["other_winning_first_moves"]:
        blockers.append("multiple-correct-first-moves")
    if len(result["wrong_variations"]) != 2:
        blockers.append("two-refutations-not-proven")
    result["export_blockers"]=blockers
    result["export_eligible"]=not blockers
    return row


def compose(root: Path,checkpoint: Path, *, target=30,own_moves=3,kyu_min=10,kyu_max=20,
            batch_size=500,seed=2026,resume: Path | None = None):
    """Keep searching until the requested proof count or an explicit stop.

    Ranks and visual quality remain separate gates. No hard attempt limit is
    disguised as a requested count of completed puzzles. Every batch has a
    saved progress record and its own independently resumable candidate files.
    """
    if not 1 <= target <= 10000 or not 1 <= own_moves <= 8 or not 1 <= kyu_min <= kyu_max <= 30:
        raise ValueError("Invalid composition target, depth or Kyu range")
    if not 1 <= batch_size <= 10000:
        raise ValueError("Invalid proposal batch size")
    root=root.resolve()
    checkpoint=checkpoint.resolve()
    run=(resume or root/"experiments"/f"composition-{time.time_ns()}").resolve()
    if not run.is_relative_to((root/"experiments").resolve()):
        raise ValueError("Composition workspace must stay inside this lab's experiments")
    settings={"checkpoint_sha256":file_hash(checkpoint),"own_moves":own_moves,"kyu":[kyu_min,kyu_max],"seed":seed}
    if resume:
        progress=read_json(run/"composition.json")
        if not progress or progress["settings"] != settings:
            raise ValueError("Resume settings differ from the recorded composition run")
    else:
        run.mkdir(parents=True)
        shutil.copytree(root/"data",run/"data")
        shutil.copy2(checkpoint,run/"seed-model.pt")
        progress={"schema":"gostone.proof-composition/1","settings":settings,"round":0,
                  "attempts":0,"proved_candidates":[],"profiles":{},"seconds":0}
    checkpoint=run/"seed-model.pt"
    if not checkpoint.is_file() or file_hash(checkpoint) != settings["checkpoint_sha256"]:
        raise ValueError("The composition run's frozen checkpoint is missing or changed")
    model,_=load_model(checkpoint)
    seen_positions={canonical(r["board"],19,r["to_play"]) for r in records(root)}
    seen_cores={tactical_core(r["board"],r["targets"],r["to_play"])
                for r in records(root) if r.get("targets")}
    seen_patterns=set()
    for path in (root/"candidates").glob("*.json"):
        row=read_json(path)
        seen_positions.add(canonical(row["board"],19,row["to_play"]))
        seen_cores.add(tactical_core(row["board"],row.get("targets",()),row["to_play"]))
        if row.get("solution_pattern"):
            seen_patterns.add(row["solution_pattern"])
        if (not resume and row.get("requested_own_moves") == own_moves
                and row.get("verification",{}).get("export_eligible")):
            replay_proofs(row)
            progress["proved_candidates"].append(row["id"])
    for reference in records(root):
        for line in reference["solutions"]:
            for length in range(3,len(line)+1):
                for offset in range(len(line)-length+1):
                    player=reference["to_play"] if offset % 2 == 0 else 3-reference["to_play"]
                    moves=[{"move":p,"color":player if i % 2 == 0 else 3-player}
                           for i,p in enumerate(line[offset:offset+length])]
                    seen_patterns.add(solution_fingerprint(moves,player))
    starting_seconds=progress["seconds"]
    started=time.monotonic()
    def save(status):
        progress.update(status=status,seconds=starting_seconds+time.monotonic()-started,
                        proof_target=target,production_ready=False,
                        notice="Proof candidates still need visual assessment and a defensible Kyu grade.")
        atomic_json(run/"composition.json",progress)
        atomic_json(root/"composition-progress.json",{**progress,"workspace":str(run)})
    save("running")
    profiles=("atari","balanced","initiative","tempo")
    while len(progress["proved_candidates"]) < target:
        if (root/"stop-composition.flag").exists():
            save("stopped")
            return progress
        profile=profiles[progress["round"] % len(profiles)]
        batch=run/f"batch-{progress['round']:06d}-{profile}"
        if batch.exists():
            # A crashed batch is evidence, never overwritten or silently treated
            # as a full batch. Existing candidates are recovered below.
            report=read_json(batch/"completed.json")
        else:
            shutil.copytree(run/"data",batch/"data")
            report=None
        if report is None:
            def gate(row):
                if max(map(len,row["anchor_groups"])) > 10 or sum(bool(c) for c in row["board"]) > 35:
                    return "too-large-for-curriculum"
                row["proposal_constraints"]["curriculum"]=profile
                return None
            with workspace_lock(batch):
                report=generate(batch,approach="fresh",count=batch_size,own_moves=own_moves,
                    kyu_min=kyu_min,kyu_max=kyu_max,seed=seed+progress["round"],
                    proof_seconds=2,proof_nodes=150000,refutation_seconds=30,checkpoint=checkpoint,
                    category="semeai",anchor_profile=profile,proposal_filter=gate,
                    stop_requested=lambda:(root/"stop-composition.flag").exists())
            atomic_json(batch/"completed.json",report)
        for path in sorted((batch/"candidates").glob("*.json")):
            row=read_json(path)
            result=row["verification"]
            if (result.get("minimum_depth_certified") and result.get("requested_depth_matches_demonstration")
                    and len(result.get("wrong_variations",[])) == 2
                    and result.get("unresolved_initial_moves") and not result.get("other_winning_first_moves")):
                pending=run/"pending-refutations"/(row["id"]+".json")
                if not pending.exists():
                    atomic_json(pending,row)
        pending_paths=sorted((run/"pending-refutations").glob("*.json"),key=lambda p:p.stat().st_mtime)
        if pending_paths and not (root/"stop-composition.flag").exists():
            path=pending_paths[0]
            row=recheck_refutations(read_json(path),model,stop_requested=lambda:(root/"stop-composition.flag").exists())
            atomic_json(path,row)
            if row["verification"].get("export_eligible"):
                atomic_json(batch/"candidates"/path.name,row)
                path.unlink()
            elif row["refutation_recheck"]["pass"] >= 3 or row["verification"].get("other_winning_first_moves"):
                atomic_json(run/"unresolved-refutations"/path.name,row)
                path.unlink()
        progress["pending_counterproofs"]=sum(1 for _ in (run/"pending-refutations").glob("*.json"))
        added=0
        for path in sorted((batch/"candidates").glob("*.json")):
            row=read_json(path)
            if not row["verification"].get("export_eligible"):
                continue
            replay_proofs(row)
            row=minimize(row,model)
            replay_proofs(row)
            position=canonical(row["board"],19,row["to_play"])
            core=row["core_fingerprint"]
            pattern=row["solution_pattern"]
            if position in seen_positions or core in seen_cores or (pattern and pattern in seen_patterns):
                continue
            row["composition_run"]=run.name
            row["quality_status"]="awaiting-visual-and-rank-assessment"
            # The root CLI lock is held only while publishing candidate files.
            # Training and source import remain available between publications.
            while True:
                try:
                    with workspace_lock(root):
                        atomic_json(root/"candidates"/(row["id"]+".json"),row)
                    break
                except ValueError as error:
                    if not str(error).startswith("Another job owns"):
                        raise
                    if (root/"stop-composition.flag").exists():
                        save("stopped")
                        return progress
                    time.sleep(.25)
            seen_positions.add(position)
            seen_cores.add(core)
            if pattern:
                seen_patterns.add(pattern)
            progress["proved_candidates"].append(row["id"])
            added+=1
        progress["attempts"]+=report.get("attempts_performed",report["attempts_requested"])
        tally=progress["profiles"].setdefault(profile,{"attempts":0,"proof_candidates":0})
        tally["attempts"]+=report.get("attempts_performed",report["attempts_requested"])
        tally["proof_candidates"]+=added
        progress["round"]+=1
        save("running")
        print(f"Composition: {len(progress['proved_candidates'])}/{target} proved candidates, "
              f"{progress['attempts']} proposals, last profile {profile}: {added}",flush=True)
    save("proof-target-reached; visual-and-rank-review-pending")
    return progress
