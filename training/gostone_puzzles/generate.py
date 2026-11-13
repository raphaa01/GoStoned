from __future__ import annotations

from collections import Counter
from pathlib import Path
import time

import numpy as np
import torch

from .common import atomic_json, canonical, digest, read_json, records, relative_pattern, tactical_core
from .historical import infer_targets
from .model import encode, load_model
from .rules import State, terminal
from .solver import Limits, Solver


def draw_board(model, parent, rng, mode="joint", temperature=.8):
    original = np.asarray(parent["board"], dtype=np.int64).reshape(19, 19)
    if mode == "mutation":
        board = original.copy()
        occupied = np.argwhere(original != 0)
        center = occupied[int(rng.integers(len(occupied)))]
        for _ in range(int(rng.integers(2, 6))):
            y, x = np.clip(center+rng.integers(-2, 3, size=2), 0, 18)
            board[y, x] = int(rng.integers(3))
        return board.ravel().tolist(), 0.0
    # Change an actual tactical neighborhood, not decoration outside the fight.
    points = [m for line in parent["solutions"] for m in line[:4]]
    center = points[int(rng.integers(len(points)))]
    yy, xx = np.mgrid[:19, :19]
    region = (abs(xx-center % 19)+abs(yy-center//19)) <= int(rng.integers(2, 5))
    mask = region & (rng.random((19, 19)) < .7)
    mask[center//19, center % 19] = True
    board, visible = original.copy(), ~mask
    with torch.inference_mode():
        # Iterative masked reconstruction; retains true 19x19 edge geometry.
        for _ in range(4):
            x, _ = encode(board.ravel(), parent["to_play"], parent["category"], visible)
            logits, _, preference = model(torch.from_numpy(x[None]))
            probs = torch.softmax(logits[0].permute(1, 2, 0)/temperature, -1).numpy()
            remaining = np.argwhere(~visible)
            if not len(remaining):
                break
            order = rng.permutation(len(remaining))
            for i in order[:max(1, (len(remaining)+1)//2)]:
                y, column = remaining[i]
                value = int(rng.choice(3, p=probs[y, column]/probs[y, column].sum()))
                board[y, column] = 0 if value == 0 else parent["to_play"] if value == 1 else 3-parent["to_play"]
                visible[y, column] = True
        # Last step fills every outstanding location from the final prediction.
        for y, column in np.argwhere(~visible):
            value = int(rng.choice(3, p=probs[y, column]/probs[y, column].sum()))
            board[y, column] = 0 if value == 0 else parent["to_play"] if value == 1 else 3-parent["to_play"]
    return board.ravel().tolist(), float(torch.sigmoid(preference)[0])


def proof_line(state, certificate):
    nodes, key, line = certificate["nodes"], certificate["root"], []
    def length(k):
        node = nodes[k]
        return 0 if node.get("terminal") else 1+max(length(b["next"]) for b in node["branches"])
    while not nodes[key].get("terminal"):
        node = nodes[key]
        branch = max(node["branches"], key=lambda b: (length(b["next"]), b["move"] != -1))
        line.append({"color": state.to_play, "move": branch["move"]})
        state = state.play(branch["move"])
        key = branch["next"]
    return line


def certify(candidate, own_moves, seconds=2.0, nodes=20000):
    initial = State.setup(19, candidate["board"], candidate["to_play"], candidate["targets"])
    if terminal(initial, candidate["category"], candidate["to_play"]) is not None:
        return {"status": "already-terminal", "scope": "full-board"}
    result = Solver(candidate["category"], candidate["to_play"], Limits(own_moves, nodes, seconds)).solve(initial)
    if result["status"] != "proven-win":
        return result
    line = proof_line(initial, result["certificate"])
    result["solution"] = line
    actual_own = sum(m["color"] == candidate["to_play"] for m in line)
    result["requested_depth_matches_demonstration"] = actual_own == own_moves
    result["all_initial_moves_resolved"] = False
    result["wrong_variations"] = []
    result["first_move_refutations"] = []
    first = line[0]["move"] if line else None
    # Full refutation of every other legal first move is required for uniqueness.
    started = time.monotonic()
    unresolved = []
    other_winners = []
    for move, child in initial.legal():
        if move == first:
            continue
        if time.monotonic()-started > seconds:
            unresolved.append(move)
            continue
        answer = Solver(candidate["category"], candidate["to_play"],
                        Limits(own_moves, nodes, max(.01, seconds-(time.monotonic()-started)))).solve(child, allow_captured_target=True)
        if answer["status"] == "proven-loss":
            result["first_move_refutations"].append({"move": move, "certificate": answer["certificate"]})
            if move != -1:
                refutation = [{"color": initial.to_play, "move": move}] + proof_line(child, answer["certificate"])
                if len(result["wrong_variations"]) < 2:
                    result["wrong_variations"].append({"status": "incorrect", "moves": refutation[:4],
                        "feedback_after_ply": min(4, len(refutation)), "certificate": answer["certificate"],
                        "endpoint": "goal-prevention-proven"})
        elif answer["status"] == "proven-win":
            other_winners.append(move)
        else:
            unresolved.append(move)
    result["unresolved_initial_moves"] = unresolved
    result["other_winning_first_moves"] = other_winners
    result["all_initial_moves_resolved"] = not unresolved
    result["unique_first_move"] = not unresolved and not other_winners
    # Separate bounded-goal proof: inability to win sooner is not an unbounded loss.
    lower = None
    if own_moves > 1:
        lower = Solver(candidate["category"], candidate["to_play"],
                       Limits(own_moves-1, nodes, seconds), deadline=True).solve(initial)
    result["minimum_depth_certified"] = own_moves == 1 or lower["status"] == "deadline-failure"
    result["minimum_depth_certificate"] = lower.get("certificate") if lower else None
    result["export_blockers"] = []
    if unresolved:
        result["export_blockers"].append("unresolved-first-moves")
    if other_winners:
        result["export_blockers"].append("multiple-correct-first-moves")
    if len(result["wrong_variations"]) != 2:
        result["export_blockers"].append("two-refutations-not-proven")
    if not result["minimum_depth_certified"] or not result["requested_depth_matches_demonstration"]:
        result["export_blockers"].append("minimum-depth-not-certified")
    if any(move["move"] == -1 for move in line):
        result["export_blockers"].append("pass-in-main-demonstration")
    result["export_eligible"] = not result["export_blockers"]
    return result


def generate(root: Path, approach="joint", count=30, own_moves=3, kyu_min=10, kyu_max=20,
             seed=2026, proof_seconds=.25, proof_nodes=3000, checkpoint: Path | None = None):
    if approach not in ("joint", "denoise", "mutation") or not 1 <= count <= 10000:
        raise ValueError("Invalid generation settings")
    if not 1 <= own_moves <= 8 or not 1 <= kyu_min <= kyu_max <= 30:
        raise ValueError("Invalid depth or Kyu range")
    if not 0 < proof_seconds <= 600 or not 1 <= proof_nodes <= 10000000:
        raise ValueError("Invalid proof budget")
    rng = np.random.default_rng(seed)
    source = [r for r in records(root) if r["category"] in ("life", "kill")]
    if not source:
        raise ValueError("No historical life/death references imported")
    model = None
    metadata = {}
    if approach != "mutation":
        torch.set_num_threads(4)
        checkpoint = checkpoint or root / "models" / approach / "checkpoint.pt"
        model, metadata = load_model(checkpoint)
    existing = {canonical(r["board"], 19, r["to_play"]) for r in records(root)}
    core_index = {tactical_core(r["board"], r["targets"], r["to_play"]) for r in source}
    for path in (root / "candidates").glob("*.json"):
        row = read_json(path)
        existing.add(canonical(row["board"], 19, row["to_play"]))
        if row.get("core_fingerprint"):
            core_index.add(row["core_fingerprint"])
    seen_solutions = {read_json(path).get("solution_pattern") for path in (root / "candidates").glob("*.json")}
    counts, saved = Counter(), []
    started = time.monotonic()
    for attempt in range(count):
        if (root / "stop-generation.flag").exists():
            counts["stopped"] += 1
            break
        parent = source[int(rng.integers(len(source)))]
        board, preference = draw_board(model, parent, rng, approach)
        if model and metadata.get("preference_ready"):
            options = [(board,preference)]+[draw_board(model,parent,rng,approach) for _ in range(2)]
            board,preference = max(options,key=lambda item:item[1])
        player = parent["to_play"]
        if attempt % 2:
            board, player = [3-c if c else 0 for c in board], 3-player
        key = canonical(board, 19, player)
        if key in existing:
            counts["duplicate-position"] += 1
            continue
        existing.add(key)
        try:
            State.setup(19, board, player)
        except ValueError:
            counts["illegal-setup"] += 1
            continue
        total_stones = sum(bool(c) for c in board)
        if not 5 <= total_stones <= 65:
            counts["stone-count"] += 1
            continue
        # Reject the original failure: large solid blocks; do not add safe walls.
        grid = np.asarray(board).reshape(19, 19)
        if any(np.all(grid[y:y+3, x:x+3] == c) for c in (1, 2) for y in range(17) for x in range(17)):
            counts["dense-block"] += 1
            continue
        first = parent["solutions"][0][0]
        if model:
            features, _ = encode(board, player, parent["category"])
            with torch.inference_mode():
                _, logits, _ = model(torch.from_numpy(features[None]))
            logits = logits[0, :361].numpy()
            logits[np.asarray(board) != 0] = -1e9
            first = int(logits.argmax())
        targets = infer_targets(board, player, parent["category"], first)
        if not targets:
            counts["no-target"] += 1
            continue
        core = tactical_core(board, targets, player)
        if core in core_index:
            counts["duplicate-tactical-core"] += 1
            continue
        core_index.add(core)
        identifier = digest((key, approach, seed, attempt))[:24]
        candidate = {"schema": "gostone.puzzle-candidate/1", "id": identifier,
                     "size": 19, "board": board, "to_play": player,
                     "category": parent["category"], "targets": targets,
                     "core_fingerprint": core,
                     "parent_id": parent["id"], "parent_family": parent["family"],
                     "approach": approach, "seed": seed, "attempt": attempt,
                     "requested_own_moves": own_moves, "requested_kyu": [kyu_min, kyu_max],
                     "difficulty": {"kyu": None, "status": "uncalibrated", "requested_band_only": True},
                     "model_steps": metadata.get("steps"), "preference_score": preference,
                     "preference_trained": metadata.get("preference_ready", False),
                     "review": "pending", "created_at": time.time(), "model_role": "proposal-only"}
        candidate["verification"] = certify(candidate, own_moves, proof_seconds, proof_nodes)
        line = candidate["verification"].get("solution", [])
        pattern = relative_pattern([(m["move"] % 19, m["move"]//19) for m in line if m["move"] >= 0],
                                   [1 if m["color"] == player else 2 for m in line if m["move"] >= 0])
        if pattern and pattern in seen_solutions:
            counts["duplicate-solution"] += 1
            continue
        if pattern:
            seen_solutions.add(pattern)
        candidate["solution_pattern"] = pattern
        atomic_json(root / "candidates" / (identifier+".json"), candidate)
        counts[candidate["verification"]["status"]] += 1
        saved.append(identifier)
        atomic_json(root / "generation-progress.json", {"approach": approach, "attempted": attempt+1,
                    "requested_attempts": count, "counts": dict(counts), "seconds": time.monotonic()-started})
    report = {"approach": approach, "attempts_requested": count, "counts": dict(counts),
              "saved": saved, "seconds": time.monotonic()-started, "seed": seed,
              "production_ready": False, "approved_puzzles": 0,
              "note": "Candidate count is not a count of correct, novel, human-approved puzzles."}
    atomic_json(root / "experiments" / f"{approach}-{seed}-{time.time_ns()}.json", report)
    return report


def review(root: Path, identifier: str, rating: str, note="", tags=None):
    if len(identifier) != 24 or any(c not in "0123456789abcdef" for c in identifier):
        raise ValueError("Invalid candidate identifier")
    if rating not in ("good", "bad", "unsure") or len(note) > 4000:
        raise ValueError("Invalid feedback")
    candidate = read_json(root / "candidates" / (identifier+".json"))
    if not candidate:
        raise ValueError("Candidate does not exist")
    result = {"candidate_id": identifier, "rating": rating, "note": note,
              "tags": [str(tag)[:80] for tag in (tags or [])][:12], "updated_at": time.time(),
              "role": "human-quality-feedback; cannot override proof status"}
    atomic_json(root / "reviews" / (identifier+".json"), result)
    return result
