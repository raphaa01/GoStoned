from __future__ import annotations

import hashlib
import os
from pathlib import Path
import random
import re
import time

import numpy as np
import torch
from torch.nn import functional as F

from .common import atomic_json, digest, read_json, records, transform_point
from .model import Config, PuzzleNet, checkpoint_metadata, encode, load_model
from .rules import State


def split_records(rows):
    """Same board family always stays in one split, before any augmentation."""
    train, validation = [], []
    for row in rows:
        bucket = int(hashlib.sha256(row.get("split_group", row["family"]).encode()).hexdigest()[:8], 16) % 5
        (validation if bucket == 0 else train).append(row)
    if not train or not validation:
        raise ValueError("At least two independent train/validation families are required")
    return train, validation


def samples(rows):
    result = []
    for row in rows:
        for line in row["solutions"]:
            state = State.setup(19, row["board"], row["to_play"], row.get("targets", ()))
            for index, move in enumerate(line):
                remaining_own = sum((j % 2 == 0) for j in range(index,len(line)))
                result.append((list(state.stones), state.to_play, row["category"], move, row["family"],
                               sorted(state.targets), row["to_play"], remaining_own))
                state = state.play(move)
    return result


def batch(items, count, rng, augment=True, input_planes=12, local_mask=False):
    features, labels, moves, masks = [], [], [], []
    for index in rng.integers(len(items), size=count):
        board, player, category, move, _, targets, goal_player, own_moves = items[index]
        if augment:
            sym = int(rng.integers(8))
            new_board = [0]*361
            for p, c in enumerate(board):
                new_board[transform_point(p, 19, sym)] = c
            board, move = new_board, transform_point(move, 19, sym)
            targets = [transform_point(point, 19, sym) for point in targets]
            if rng.random() < .5:
                board, player = [3-c if c else 0 for c in board], 3-player
                goal_player = 3-goal_player
        visible = rng.random((19, 19)) > rng.uniform(.05, .8)
        if local_mask and rng.random() < .25:
            # Learn to compose an entire tactical shape from an empty context,
            # rather than always reconstructing around an unchanged stone core.
            occupied = np.argwhere(np.asarray(board).reshape(19, 19) != 0)
            low = np.maximum(0, occupied.min(0)-1)
            high = np.minimum(18, occupied.max(0)+1)
            visible = np.ones((19, 19), dtype=bool)
            visible[low[0]:high[0]+1, low[1]:high[1]+1] = False
            targets = []
        elif local_mask and rng.random() < .7:
            yy, xx = np.mgrid[:19, :19]
            radius = int(rng.integers(2, 5))
            region = abs(xx-move % 19)+abs(yy-move//19) <= radius
            visible = ~(region & (rng.random((19, 19)) < .75))
            visible[move//19, move % 19] = False
        planes, target = encode(board, player, category, visible, input_planes=input_planes,
                                targets=targets, goal_player=goal_player, own_moves=own_moves)
        features.append(planes)
        labels.append(target)
        moves.append(move)
        masks.append(~visible)
    return (torch.from_numpy(np.stack(features)), torch.from_numpy(np.stack(labels)),
            torch.tensor(moves), torch.from_numpy(np.stack(masks)))


def evaluate(model, items, device="cpu"):
    rng = np.random.default_rng(8192)
    total_loss, correct1, correct5, total = 0., 0, 0, 0
    with torch.inference_mode():
        for _ in range(8):
            x, target, moves, mask = batch(items, 16, rng, augment=False, input_planes=model.config.input_planes)
            x, target, moves, mask = (t.to(device) for t in (x, target, moves, mask))
            board_logits, policy, _ = model(x)
            loss = F.cross_entropy(board_logits, target, reduction="none")
            total_loss += float(loss[mask].mean())
            # Policy is measured on a fully visible board, not a corrupted one.
            x[:, :3] = F.one_hot(target, 3).permute(0, 3, 1, 2).float()
            x[:, 3] = 1
            _, policy, _ = model(x)
            occupied = target.flatten(1) != 0
            policy[:, :361] = policy[:, :361].masked_fill(occupied, -1e9)
            correct1 += int((policy.argmax(1) == moves).sum())
            correct5 += int((policy.topk(5, 1).indices == moves[:, None]).any(1).sum())
            total += len(moves)
    return {"masked_cross_entropy": total_loss/8, "reference_move_top1": correct1/total,
            "reference_move_top5": correct5/total, "evaluated_samples": total,
            "note": "Historical move imitation only; not proof success, puzzle quality or Kyu calibration."}


def feedback_examples(root: Path, training_families: set[str], input_planes=12):
    examples = []
    directory = root / "reviews"
    if not directory.exists():
        return examples
    for path in directory.glob("*.json"):
        review = read_json(path)
        candidate = read_json(root / "candidates" / (review["candidate_id"]+".json"))
        if not candidate or candidate.get("parent_family") not in training_families:
            continue
        if review.get("rating") not in ("good", "bad"):
            continue
        # Aesthetic feedback trains only the preference head, never truth labels.
        planes, _ = encode(candidate["board"], candidate["to_play"], candidate["category"],
                           input_planes=input_planes, targets=candidate.get("targets", ()),
                           own_moves=candidate.get("requested_own_moves"))
        examples.append((planes, float(review["rating"] == "good")))
    return examples


def train(root: Path, name="joint", steps=500, channels=48, blocks=4, batch_size=16,
          resume: Path | None = None, seed=2026, device="cpu", use_feedback=True, run_name=None):
    if name not in ("joint", "denoise") or not 1 <= steps <= 1000000 or not 1 <= batch_size <= 256:
        raise ValueError("Invalid training settings")
    if not 8 <= channels <= 256 or channels % 4 or not 1 <= blocks <= 20:
        raise ValueError("Invalid model dimensions")
    run_name = run_name or name
    if not re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}", run_name):
        raise ValueError("Invalid training run name")
    torch.set_num_threads(min(4, os.cpu_count() or 1))
    torch.manual_seed(seed)
    random.seed(seed)
    rng = np.random.default_rng(seed)
    rows = records(root)
    training, validation = split_records(rows)
    training_samples, validation_samples = samples(training), samples(validation)
    if resume:
        model, previous = load_model(resume, device)
        if previous.get("corpus_hash") != digest(rows):
            before = previous.get("record_hashes", {})
            after = {row["id"]: digest(row) for row in rows}
            if not before or any(after.get(identifier) != value for identifier, value in before.items()):
                raise ValueError("Existing corpus records changed. Start a new run; additive reviewed data is supported after a current-format checkpoint.")
            if set(previous["training_families"]) & {r["family"] for r in validation} or set(previous["validation_families"]) & {r["family"] for r in training}:
                raise ValueError("New data would contaminate the held-out family split")
        if previous.get("approach") != name:
            raise ValueError("Cannot resume with a different training objective")
    else:
        model, previous = PuzzleNet(Config(channels, blocks)).to(device), {}
    optimizer = torch.optim.AdamW(model.parameters(), lr=0.0005, weight_decay=0.0001)
    if previous.get("optimizer"):
        optimizer.load_state_dict(previous["optimizer"])
    if previous.get("numpy_rng"):
        rng.bit_generator.state = previous["numpy_rng"]
    if previous.get("torch_rng") is not None:
        torch.set_rng_state(previous["torch_rng"].cpu())
    if model.config.input_planes == 12 and any(r["category"] == "tesuji" for r in rows):
        raise ValueError("Legacy checkpoints cannot learn the new tesuji category. Start a new named run.")
    feedback = feedback_examples(root, {r["family"] for r in training}, model.config.input_planes) if use_feedback else []
    positive_feedback = sum(label == 1.0 for _, label in feedback)
    negative_feedback = len(feedback)-positive_feedback
    preference_ready = positive_feedback >= 3 and negative_feedback >= 3
    output = root / "models" / run_name
    if output.joinpath("checkpoint.pt").exists() and resume is None:
        raise ValueError("A checkpoint already exists in this run. Resume it or choose a different run name.")
    output.mkdir(parents=True, exist_ok=True)
    from .corpus import training_manifest
    atomic_json(output / "corpus-manifest.json", training_manifest(root, training, validation))
    started, completed = time.monotonic(), int(previous.get("steps", 0))
    baseline = evaluate(model.eval(), validation_samples, device)
    history = []
    best = read_json(output / "best-metrics.json")

    def save(status):
        nonlocal best
        model.eval()
        metrics = evaluate(model, validation_samples, device)
        checkpoint = checkpoint_metadata(model)
        checkpoint.update(approach=name, run_name=run_name, steps=completed, corpus_hash=digest(rows),
                          record_hashes={row["id"]: digest(row) for row in rows},
                          optimizer=optimizer.state_dict(), numpy_rng=rng.bit_generator.state,
                          torch_rng=torch.get_rng_state(), validation=metrics,
                          training_families=sorted({r["family"] for r in training}),
                          validation_families=sorted({r["family"] for r in validation}),
                          feedback_examples=len(feedback))
        checkpoint.update(preference_ready=preference_ready,
                          positive_feedback=positive_feedback,negative_feedback=negative_feedback)
        checkpoint["masking_strategy"] = "mixed-local-and-unseeded" if model.config.input_planes >= 15 else "global"
        checkpoint["depth_condition_labels"] = "historical reference length; not forced minimum-depth labels"
        temporary = output / "checkpoint.tmp"
        torch.save(checkpoint, temporary)
        os.replace(temporary, output / "checkpoint.pt")
        # Preserve intermediate evidence. A later update must not erase the
        # ability to compare or return to an earlier trained model.
        torch.save(checkpoint, output / f"checkpoint-{completed}.pt")
        score = [metrics["reference_move_top1"], -metrics["masked_cross_entropy"]] if name == "joint" else [-metrics["masked_cross_entropy"]]
        if best is None or score > best["score"]:
            torch.save(checkpoint, output / "best.tmp")
            os.replace(output / "best.tmp", output / "best.pt")
            best = {"step": completed, "score": score, "validation": metrics}
            atomic_json(output / "best-metrics.json", best)
        report = {"status": status, "approach": name, "run_name": run_name, "steps": completed,
                  "seconds_this_run": time.monotonic()-started,
                  "parameters": sum(p.numel() for p in model.parameters()),
                  "training_records": len(training), "validation_records": len(validation),
                  "total_corpus_records": len(rows), "feature_version": checkpoint["feature_version"],
                  "training_samples": len(training_samples), "validation_samples": len(validation_samples),
                  "baseline": baseline, "validation": metrics, "history": history[-100:],
                  "best_validation_checkpoint": best,
                  "feedback_examples": len(feedback), "production_ready": False,
                  "preference_ready": preference_ready,
                  "warning": "Research checkpoint; generating good new puzzles has to be measured separately."}
        atomic_json(output / "report.json", report)
        print(f"{name}: step {completed}, held-out top1={metrics['reference_move_top1']:.3f}, shape CE={metrics['masked_cross_entropy']:.3f}", flush=True)
        model.train()
        return report

    model.train()
    report = None
    try:
        for index in range(steps):
            if (root / "stop-training.flag").exists():
                report = save("stopped")
                break
            x, target, moves, mask = batch(training_samples, batch_size, rng, input_planes=model.config.input_planes,
                                          local_mask=model.config.input_planes >= 15)
            x, target, moves, mask = (t.to(device) for t in (x, target, moves, mask))
            board_logits, policy, _ = model(x)
            shape_loss = F.cross_entropy(board_logits, target, reduction="none")
            # Balance empty vs stones, otherwise predicting an empty board wins.
            weights = torch.where(target == 0, .35, 3.0)
            loss = (shape_loss*weights)[mask].mean()
            if name == "joint":
                full = x.clone()
                full[:, :3] = F.one_hot(target, 3).permute(0, 3, 1, 2).float()
                full[:, 3] = 1
                _, move_logits, _ = model(full)
                move_logits[:, :361] = move_logits[:, :361].masked_fill(target.flatten(1) != 0, -1e9)
                loss = loss + .7*F.cross_entropy(move_logits, moves)
            if feedback:
                chosen = rng.integers(len(feedback), size=min(8, len(feedback)))
                fx = torch.from_numpy(np.stack([feedback[i][0] for i in chosen])).to(device)
                fy = torch.tensor([feedback[i][1] for i in chosen], device=device)
                _, _, preference = model(fx)
                loss = loss + .2*F.binary_cross_entropy_with_logits(preference, fy)
            optimizer.zero_grad(set_to_none=True)
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            optimizer.step()
            completed += 1
            if index % 25 == 0:
                history.append({"step": completed, "loss": float(loss.detach())})
                atomic_json(output / "progress.json", {"step": completed, "requested_steps": steps,
                            "elapsed_seconds": time.monotonic()-started, "last_loss": history[-1]["loss"]})
            if (index+1) % 250 == 0:
                save("running")
        if report is None:
            report = save("completed")
    except KeyboardInterrupt:
        report = save("interrupted")
    return report
