from __future__ import annotations

from collections import Counter
from pathlib import Path
import time

import numpy as np
import torch

from .common import atomic_json, canonical, digest, read_json, records, solution_fingerprint, tactical_core
from .historical import infer_targets
from .model import encode, load_model
from .rules import State, terminal, static_placement_allowed
from .solver import Limits, Solver


def shape_probabilities(logits,temperature=.8,prior_correction=0):
    # The board loss weights stones 3.0 and empties 0.35. Its optimum predicts
    # a weight-biased posterior. Undoing those weights before sampling avoids
    # interpreting the training rebalance as an instruction to fill the board.
    weights=logits.new_tensor([.35,3.,3.])
    return torch.softmax((logits-prior_correction*weights.log())/temperature,-1)


def draw_board(model, parent, rng, mode="joint", temperature=.8, stats=None, own_moves=3,
               unconditioned=False,shape_prior_correction=0,shape_fill_mode="confidence"):
    stats = stats if stats is not None else {}
    original = np.asarray(parent["board"], dtype=np.int64).reshape(19, 19)
    if mode == "fresh":
        # The reference supplies category and a footprint bounding box only.
        # No reference stone or target pattern survives as a fixed puzzle core.
        occupied = np.argwhere(original != 0)
        low = np.maximum(0, occupied.min(0)-1)
        high = np.minimum(18, occupied.max(0)+1)
        board = np.zeros((19, 19), dtype=np.int64)
        visible = np.ones((19, 19), dtype=bool)
        visible[low[0]:high[0]+1, low[1]:high[1]+1] = False
        iterations=int((~visible).sum()) if shape_fill_mode == "raster" else 10
        with torch.inference_mode():
            for iteration in range(iterations):
                features, _ = encode(board.ravel(), parent["to_play"], parent["category"], visible,
                                     input_planes=model.config.input_planes, own_moves=own_moves)
                if unconditioned:
                    features[5:13]=0
                logits, _, preference = model(torch.from_numpy(features[None]))
                probabilities = shape_probabilities(logits[0].permute(1,2,0),temperature,shape_prior_correction).numpy()
                pending = np.argwhere(~visible)
                if not len(pending):
                    break
                if shape_fill_mode == "raster":
                    # Sample each next point from the already sampled prefix.
                    # Parallel choices from marginal probabilities can average
                    # incompatible forms into one dense, incoherent block.
                    pending=pending[:1]
                choices = [int(rng.choice(3, p=probabilities[y, x]/probabilities[y, x].sum())) for y, x in pending]
                confidence = np.asarray([probabilities[y, x, choice] for (y, x), choice in zip(pending, choices)])
                confidence += rng.gumbel(size=len(pending))*.08*(1-iteration/iterations)
                count = 1 if shape_fill_mode == "raster" else max(1,int(np.ceil(len(pending)/(iterations-iteration))))
                for index in np.argsort(-confidence)[:count]:
                    y, x = pending[index]
                    choice = choices[index]
                    distribution = probabilities[y,x].copy()
                    while choice:
                        color = parent["to_play"] if choice == 1 else 3-parent["to_play"]
                        if static_placement_allowed(board.ravel(),19,int(y*19+x),color):
                            break
                        stats["rejected_static_choices"] = stats.get("rejected_static_choices",0)+1
                        distribution[choice] = 0
                        choice = int(rng.choice(3,p=distribution/distribution.sum())) if distribution.sum() else 0
                    board[y, x] = 0 if choice == 0 else parent["to_play"] if choice == 1 else 3-parent["to_play"]
                    visible[y, x] = True
        return board.ravel().tolist(), float(torch.sigmoid(preference)[0])
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
            x, _ = encode(board.ravel(), parent["to_play"], parent["category"], visible,
                          input_planes=model.config.input_planes, targets=parent.get("targets", ()), own_moves=own_moves)
            logits, _, preference = model(torch.from_numpy(x[None]))
            probs = shape_probabilities(logits[0].permute(1,2,0),temperature,shape_prior_correction).numpy()
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


def certify(candidate, own_moves, seconds=2.0, nodes=20000, policy=None,refutation_seconds=None):
    initial = State.setup(19, candidate["board"], candidate["to_play"], candidate["targets"])
    anchors=candidate.get("anchor_groups",())
    if terminal(initial, candidate["category"], candidate["to_play"],anchors) is not None:
        return {"status": "already-terminal", "scope": "full-board"}
    from .guide import TacticalGuide
    guide = TacticalGuide(initial, candidate["category"], candidate["to_play"], prior=policy,
                          seconds=min(.5,seconds*.25), nodes=min(10000,nodes),anchors=anchors)
    hypothesis = guide.search(initial,2*own_moves-1)
    guide_report = guide.report(hypothesis)
    ordering = guide if hypothesis == 1 else policy
    result = Solver(candidate["category"], candidate["to_play"], Limits(own_moves, nodes, seconds), policy=ordering, seek=1,anchors=anchors).solve(initial)
    result["tactical_guide"] = guide_report
    if result["status"] != "proven-win":
        return result
    line = proof_line(initial, result["certificate"])
    result["solution"] = line
    actual_own = sum(m["color"] == candidate["to_play"] for m in line)
    result["requested_depth_matches_demonstration"] = actual_own == own_moves
    result["all_initial_moves_resolved"] = False
    result["wrong_variations"] = []
    result["first_move_refutations"] = []
    if actual_own != own_moves:
        result.update(unique_first_move=False, minimum_depth_certified=False, export_eligible=False,
                      export_blockers=["different-demonstration-depth"])
        return result
    if isinstance(policy, NeuralOrdering):
        policy.max_calls += 16
    first = line[0]["move"] if line else None
    # Full refutation of every other legal first move is required for uniqueness.
    started = time.monotonic()
    refutation_seconds=seconds if refutation_seconds is None else refutation_seconds
    unresolved = []
    other_winners = []
    alternatives = list(initial.legal())
    tactical_points = [m["move"] for m in line if m["move"] >= 0]
    alternatives.sort(key=lambda item: (10000 if item[0] < 0 else
                      min(abs(item[0] % 19-p % 19)+abs(item[0]//19-p//19) for p in tactical_points)))
    for move, child in alternatives:
        if move == first:
            continue
        remaining=refutation_seconds-(time.monotonic()-started)
        if remaining <= 0:
            unresolved.append(move)
            continue
        answer = Solver(candidate["category"], candidate["to_play"],
                        Limits(min(8,own_moves+3), nodes,min(remaining,max(.025,min(.5,refutation_seconds/100)))),
                        policy=policy, seek=-1,anchors=anchors).solve(child, allow_captured_target=True)
        if answer["status"] == "proven-loss":
            result["first_move_refutations"].append({"move": move, "certificate": answer["certificate"]})
            if move != -1:
                refutation = [{"color": initial.to_play, "move": move}] + proof_line(child, answer["certificate"])
                if (len(result["wrong_variations"]) < 2 and 2 <= len(refutation) <= 4
                        and all(m["move"] >= 0 for m in refutation)):
                    result["wrong_variations"].append({"status": "incorrect", "moves": refutation,
                        "feedback_after_ply": len(refutation), "certificate": answer["certificate"],
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
                       Limits(own_moves-1, nodes, seconds), policy=policy, deadline=True,anchors=anchors).solve(initial)
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
             seed=2026, proof_seconds=.25, proof_nodes=3000, checkpoint: Path | None = None,category=None,
             proposal_filter=None,anchor_profile=None,refutation_seconds=None,stop_requested=None,
             shape_prior_correction=0,shape_fill_mode="confidence"):
    if approach not in ("joint", "denoise", "mutation", "fresh") or not 1 <= count <= 10000:
        raise ValueError("Invalid generation settings")
    if not 1 <= own_moves <= 8 or not 1 <= kyu_min <= kyu_max <= 30:
        raise ValueError("Invalid depth or Kyu range")
    if not 0 < proof_seconds <= 600 or not 1 <= proof_nodes <= 10000000:
        raise ValueError("Invalid proof budget")
    if refutation_seconds is not None and not 0 < refutation_seconds <= 3600:
        raise ValueError("Invalid counterexample budget")
    if anchor_profile not in (None,"atari","tempo","balanced","initiative"):
        raise ValueError("Invalid capturing-race profile")
    if not 0 <= shape_prior_correction <= 1:
        raise ValueError("Invalid shape-prior correction")
    if shape_fill_mode not in ("confidence","raster") or (shape_fill_mode == "raster" and approach != "fresh"):
        raise ValueError("Sequential shape sampling is supported only for fresh composition")
    rng = np.random.default_rng(seed)
    supported=("life","kill","connect","semeai")
    if category is not None and category not in supported:
        raise ValueError("Unsupported generation category")
    all_references=records(root)
    source = [r for r in all_references if r["category"] in supported and (category is None or r["category"] == category)]
    if not source:
        raise ValueError("No historical references for this objective imported")
    model = None
    metadata = {}
    if approach != "mutation":
        torch.set_num_threads(4)
        checkpoint = checkpoint or root / "models" / ("joint" if approach == "fresh" else approach) / "checkpoint.pt"
        model, metadata = load_model(checkpoint)
        if approach == "fresh" and metadata.get("masking_strategy") != "mixed-local-and-unseeded":
            raise ValueError("Fresh composition needs a model trained with unseeded shape masks")
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
    performed=0
    for attempt in range(count):
        if (root / "stop-generation.flag").exists() or (stop_requested and stop_requested()):
            counts["stopped"] += 1
            break
        performed+=1
        unconditioned=(approach == "fresh" and metadata.get("category_dropout",0) > 0 and rng.random() < .5)
        if unconditioned:
            reference=all_references[int(rng.integers(len(all_references)))]
            parent={**reference,"category":category or str(rng.choice(supported))}
        else:
            reference=parent=source[int(rng.integers(len(source)))]
        proposal_stats = {}
        board, preference = draw_board(model, parent, rng, approach, stats=proposal_stats, own_moves=own_moves,
                                       unconditioned=unconditioned,shape_prior_correction=shape_prior_correction,shape_fill_mode=shape_fill_mode)
        if model and metadata.get("preference_ready"):
            options = [(board,preference,proposal_stats)]
            for _ in range(2):
                alternative_stats = {}
                alternate,score = draw_board(model,parent,rng,approach,own_moves=own_moves,stats=alternative_stats,
                                             unconditioned=unconditioned,shape_prior_correction=shape_prior_correction,shape_fill_mode=shape_fill_mode)
                options.append((alternate,score,alternative_stats))
            board,preference,proposal_stats = max(options,key=lambda item:item[1])
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
            features, _ = encode(board, player, parent["category"], input_planes=model.config.input_planes,own_moves=own_moves)
            with torch.inference_mode():
                _, logits, _ = model(torch.from_numpy(features[None]))
            logits = logits[0, :361].numpy()
            logits[np.asarray(board) != 0] = -1e9
            first = int(logits.argmax())
        from .objectives import select_anchors,objective_text
        anchors=select_anchors(board,player,parent["category"],first,profile=anchor_profile) if parent["category"] in ("connect","semeai") else []
        targets=(sorted(set().union(*(set(points) for points in anchors))) if anchors else
                 infer_targets(board, player, parent["category"], first, prefer_main=True))
        if not targets:
            counts["no-target"] += 1
            continue
        core = tactical_core(board, targets, player)
        if core in core_index:
            counts["duplicate-tactical-core"] += 1
            continue
        core_index.add(core)
        identifier = digest((key, parent["category"], targets, approach, metadata.get("run_name"),
                             metadata.get("steps"), seed, attempt, own_moves))[:24]
        candidate = {"schema": "gostone.puzzle-candidate/1", "id": identifier,
                     "size": 19, "board": board, "to_play": player,
                     "category": parent["category"], "targets": targets,
                     "anchor_groups":anchors,"objective_text":objective_text(parent["category"]),
                     "target_selection":{"method":"two-fighting-anchor-groups" if anchors else "largest-challenged-color-group","review_required":True},
                     "core_fingerprint": core,
                     "parent_id": parent["id"], "parent_family": parent["family"],
                     "geometry_source_category":reference["category"],"unconditioned_shape":unconditioned,
                     "approach": approach, "seed": seed, "attempt": attempt,
                     "requested_own_moves": own_moves, "requested_kyu": [kyu_min, kyu_max],
                     "difficulty": {"kyu": None, "status": "uncalibrated", "requested_band_only": True},
                     "model_steps": metadata.get("steps"), "preference_score": preference,
                     "model_run": metadata.get("run_name", metadata.get("approach")),
                     "reference_stones_fixed": approach != "fresh",
                     "proposal_constraints":proposal_stats,
                     "shape_prior_correction":shape_prior_correction,
                     "shape_fill_mode":shape_fill_mode,
                     "preference_trained": metadata.get("preference_ready", False),
                     "review": "pending", "created_at": time.time(), "model_role": "proposal-only"}
        if proposal_filter:
            reason=proposal_filter(candidate)
            if reason:
                counts[reason]+=1
                continue
        policy = NeuralOrdering(model, parent["category"], player) if model else None
        candidate["verification"] = certify(candidate, own_moves, proof_seconds, proof_nodes, policy=policy,refutation_seconds=refutation_seconds)
        candidate["neural_ordering_calls"] = policy.calls if policy else 0
        from .difficulty import estimate
        candidate["difficulty"] = estimate(root,candidate)
        line = candidate["verification"].get("solution", [])
        pattern = solution_fingerprint(line,player)
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
              "attempts_performed":performed,
              "shape_prior_correction":shape_prior_correction,"shape_fill_mode":shape_fill_mode,
              "saved": saved, "seconds": time.monotonic()-started, "seed": seed,
              "production_ready": False, "approved_puzzles": 0,
              "note": "Candidate count is not a count of correct, novel, human-approved puzzles."}
    atomic_json(root / "experiments" / f"{approach}-{seed}-{time.time_ns()}.json", report)
    return report


class NeuralOrdering:
    """Learned move ordering with a bounded inference cost; never a proof leaf."""
    def __init__(self, model, category, player, max_calls=24):
        self.model, self.category, self.player = model, category, player
        self.max_calls, self.calls, self.cache = max_calls, 0, {}

    def __call__(self, state):
        return self.at_depth(state,None)

    def at_depth(self, state, own_moves):
        key = (state.stones, state.to_play, state.targets, own_moves)
        if key in self.cache:
            return self.cache[key]
        if self.calls >= self.max_calls:
            return {}
        features, _ = encode(state.stones, state.to_play, self.category,
                             input_planes=self.model.config.input_planes,
                             targets=state.targets, goal_player=self.player, own_moves=own_moves)
        with torch.inference_mode():
            _, logits, _ = self.model(torch.from_numpy(features[None]))
        values = logits[0].tolist()
        result = {point: values[point] for point, color in enumerate(state.stones) if not color}
        result[-1] = values[-1]
        self.calls += 1
        self.cache[key] = result
        return result


UNSET = object()


def review(root: Path, identifier: str, rating: str, note="", tags=None, kyu=UNSET):
    if len(identifier) != 24 or any(c not in "0123456789abcdef" for c in identifier):
        raise ValueError("Invalid candidate identifier")
    if rating not in ("good", "bad", "unsure") or len(note) > 4000:
        raise ValueError("Invalid feedback")
    if kyu is not UNSET and kyu is not None and (type(kyu) is not int or not 1 <= kyu <= 30):
        raise ValueError("Kyu must be an integer from 1 through 30")
    candidate = read_json(root / "candidates" / (identifier+".json"))
    if not candidate:
        raise ValueError("Candidate does not exist")
    previous = read_json(root/"reviews"/(identifier+".json"), {})
    result = {"candidate_id": identifier, "rating": rating, "note": note,
              "kyu": previous.get("kyu") if kyu is UNSET else kyu,
              "tags": [str(tag)[:80] for tag in (tags or [])][:12], "updated_at": time.time(),
              "role": "human-quality-feedback; cannot override proof status"}
    atomic_json(root / "reviews" / (identifier+".json"), result)
    from .difficulty import calibrate
    calibrate(root)
    return result
