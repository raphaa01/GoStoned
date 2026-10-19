from __future__ import annotations

import copy
import math
from pathlib import Path
from typing import Any, Callable

import numpy as np
import torch

from .board import BoardState, PASS_INDEX, padded_policy_index, point_to_gtp
from .data import StreamingShardDataset
from .generate import JAPANESE_KOMI, STRENGTHS
from .model import load_checkpoint_model
from .teacher import KataGoTeacher
from .train import evaluate_model, validation_objective


def _legal_move(model: torch.nn.Module, board: BoardState, strength: float = 1.0) -> str:
    features = torch.from_numpy(board.features(strength, JAPANESE_KOMI)).unsqueeze(0)
    planes = int(getattr(model, "config").input_planes)
    with torch.inference_mode(): policy = model(features[:, :planes])[0][0].cpu().numpy()
    legal: list[tuple[str, int]] = []
    for y in range(board.size):
        for x in range(board.size):
            if board.stones[y, x] != 0: continue
            move = point_to_gtp(x, y, board.size); candidate = copy.deepcopy(board)
            try: candidate.play(move)
            except ValueError: continue
            legal.append((move, padded_policy_index(move, board.size)))
    if board.move_number >= board.size * 2 or board.consecutive_passes:
        legal.append(("pass", PASS_INDEX))
    if not legal: return "pass"
    return max(legal, key=lambda item: float(policy[item[1]]))[0]


def automated_arena(
    candidate_checkpoint: Path,
    baseline_checkpoint: Path,
    teacher: KataGoTeacher,
    visits: int,
    control: Callable[[], None] | None = None,
) -> dict[str, Any]:
    candidate = load_checkpoint_model(candidate_checkpoint); baseline = load_checkpoint_model(baseline_checkpoint)
    wins = losses = draws = 0; games: list[dict[str, Any]] = []
    for size in (9, 13, 19):
        for candidate_color in (1, -1):
            board = BoardState(size); history: list[list[str]] = []
            for _ in range(size * size * 2):
                if control: control()
                model = candidate if board.to_move == candidate_color else baseline
                move = _legal_move(model, board); color = "B" if board.to_move == 1 else "W"
                board.play(move); history.append([color, move])
                if board.consecutive_passes >= 2: break
            result = teacher.analyze(
                moves=history, size=size, komi=JAPANESE_KOMI,
                profile="rank_1d", visits=visits, include_ownership=False,
            )
            side_lead = float((result.get("rootInfo") or {}).get("scoreLead", 0.0))
            black_lead = side_lead if board.to_move == 1 else -side_lead
            candidate_lead = black_lead if candidate_color == 1 else -black_lead
            if candidate_lead > 0.5: wins += 1; outcome = "win"
            elif candidate_lead < -0.5: losses += 1; outcome = "loss"
            else: draws += 1; outcome = "draw"
            games.append({"board_size": size, "candidate_color": "black" if candidate_color == 1 else "white", "moves": len(history), "candidate_lead": candidate_lead, "outcome": outcome})
    total = wins + losses + draws
    return {"games": games, "wins": wins, "losses": losses, "draws": draws, "score": (wins + 0.5 * draws) / max(1, total)}


def run_promotion_gate(
    *, candidate_checkpoint: Path, baseline_checkpoint: Path | None,
    data_paths: list[Path], seed: int, batch_size: int,
    teacher: KataGoTeacher | None, arena_visits: int,
    control: Callable[[], None] | None = None,
    fresh_data_paths: list[Path] | None = None,
    replay_data_paths: list[Path] | None = None,
    require_improvement: bool = False,
    legacy_baseline_checkpoint: Path | None = None,
) -> dict[str, Any]:
    test_data = StreamingShardDataset(data_paths, "test", augment=False, seed=seed)
    candidate = load_checkpoint_model(candidate_checkpoint)
    candidate_metrics = evaluate_model(candidate, test_data, batch_size)
    reasons: list[str] = []
    if candidate_metrics.get("positions", 0) <= 0: reasons.append("locked test split is empty")
    if candidate_metrics.get("board_sizes", 0) < 3: reasons.append("locked test split does not cover all board sizes")
    if any(not math.isfinite(float(value)) for value in candidate_metrics.values()): reasons.append("candidate metrics contain non-finite values")
    baseline_metrics: dict[str, float] | None = None; arena: dict[str, Any] | None = None
    fresh_test: dict[str, Any] | None = None
    replay_retention: dict[str, Any] | None = None
    legacy_baseline_metrics: dict[str, float] | None = None
    legacy_arena: dict[str, Any] | None = None
    if baseline_checkpoint is None or not baseline_checkpoint.is_file():
        reasons.append("comparison model is unavailable")
    else:
        baseline = load_checkpoint_model(baseline_checkpoint)
        baseline_metrics = evaluate_model(baseline, test_data, batch_size)
        candidate_objective = validation_objective(candidate_metrics); baseline_objective = validation_objective(baseline_metrics)
        objective_limit = 0.99 if require_improvement else 1.02
        if candidate_objective > baseline_objective * objective_limit:
            reasons.append(
                "composite test objective did not improve by at least one percent"
                if require_improvement
                else "composite test objective did not beat the comparison model"
            )
        if candidate_metrics.get("value_mse", math.inf) > baseline_metrics.get("value_mse", math.inf) * 1.05:
            reasons.append("win-value error regressed by more than five percent")
        if candidate_metrics.get("score_mae_points", math.inf) > baseline_metrics.get("score_mae_points", math.inf) * 1.05:
            reasons.append("score error regressed by more than five percent")
        if candidate_metrics.get("dead_precision", 0.0) + 0.02 < baseline_metrics.get("dead_precision", 0.0):
            reasons.append("dead-group precision regressed")
        if candidate_metrics.get("alive_precision", 0.0) + 0.02 < baseline_metrics.get("alive_precision", 0.0):
            reasons.append("alive-group precision regressed")
        if candidate_metrics.get("seki_false_positive", 1.0) > max(0.03, baseline_metrics.get("seki_false_positive", 1.0)):
            reasons.append("seki false-positive rate is too high")
        if require_improvement:
            candidate_rank_gain = candidate_metrics.get("rank_conditioning_gain", -math.inf)
            baseline_rank_gain = baseline_metrics.get("rank_conditioning_gain", -math.inf)
            if candidate_rank_gain < max(0.05, baseline_rank_gain - 0.01):
                reasons.append("rank-conditioned policy separation regressed")
            for profile in STRENGTHS:
                key = f"policy_top1_elo_{profile.nominal_elo}"
                if key not in candidate_metrics or key not in baseline_metrics:
                    reasons.append(f"locked Elo coverage is missing for {profile.nominal_elo}")
                elif candidate_metrics[key] + 0.03 < baseline_metrics[key]:
                    reasons.append(f"policy accuracy regressed at nominal {profile.nominal_elo} Elo")

            fresh_paths = fresh_data_paths or []
            fresh_dataset = StreamingShardDataset(fresh_paths, "test", augment=False, seed=seed)
            fresh_candidate = evaluate_model(candidate, fresh_dataset, batch_size)
            fresh_baseline = evaluate_model(baseline, fresh_dataset, batch_size)
            fresh_test = {"candidate": fresh_candidate, "baseline": fresh_baseline}
            if not fresh_candidate.get("positions"):
                reasons.append("fresh locked test split is empty")
            elif validation_objective(fresh_candidate) > validation_objective(fresh_baseline) * 0.99:
                reasons.append("new-curriculum test objective did not improve by at least one percent")

            replay_paths = replay_data_paths or []
            replay_dataset = StreamingShardDataset(replay_paths, "test", augment=False, seed=seed)
            replay_candidate = evaluate_model(candidate, replay_dataset, batch_size)
            replay_baseline = evaluate_model(baseline, replay_dataset, batch_size)
            replay_retention = {"candidate": replay_candidate, "baseline": replay_baseline}
            if not replay_candidate.get("positions"):
                reasons.append("V5 replay retention split is empty")
            else:
                if validation_objective(replay_candidate) > validation_objective(replay_baseline) * 1.01:
                    reasons.append("V5 replay objective regressed by more than one percent")
                if replay_candidate.get("policy_loss", math.inf) > replay_baseline.get("policy_loss", math.inf) * 1.02:
                    reasons.append("V5 replay policy regressed by more than two percent")
                if replay_candidate.get("value_mse", math.inf) > replay_baseline.get("value_mse", math.inf) * 1.05:
                    reasons.append("V5 replay win-value error regressed by more than five percent")
                if replay_candidate.get("score_mae_points", math.inf) > replay_baseline.get("score_mae_points", math.inf) * 1.05:
                    reasons.append("V5 replay score error regressed by more than five percent")
                for metric, label in (
                    ("status_accuracy", "group-status accuracy"),
                    ("territory_accuracy", "territory accuracy"),
                    ("alive_precision", "alive-group precision"),
                    ("dead_precision", "dead-group precision"),
                ):
                    if replay_candidate.get(metric, 0.0) + 0.02 < replay_baseline.get(metric, 0.0):
                        reasons.append(f"V5 replay {label} regressed")
                if (
                    replay_candidate.get("rank_conditioning_gain", -math.inf) + 0.01
                    < replay_baseline.get("rank_conditioning_gain", -math.inf)
                ):
                    reasons.append("V5 replay rank conditioning regressed")
        if teacher is not None:
            arena = automated_arena(candidate_checkpoint, baseline_checkpoint, teacher, arena_visits, control)
            arena_threshold = 0.60 if require_improvement else 0.40
            if float(arena["score"]) < arena_threshold:
                reasons.append(
                    f"color-swapped KataGo-scored arena result is below {round(arena_threshold * 100)} percent"
                )
        if require_improvement:
            if legacy_baseline_checkpoint is None or not legacy_baseline_checkpoint.is_file():
                reasons.append("V4 comparison model is unavailable")
            else:
                legacy_baseline = load_checkpoint_model(legacy_baseline_checkpoint)
                legacy_baseline_metrics = evaluate_model(legacy_baseline, test_data, batch_size)
                if (
                    validation_objective(candidate_metrics)
                    > validation_objective(legacy_baseline_metrics) * 0.99
                ):
                    reasons.append("composite test objective did not improve over V4")
                if teacher is not None:
                    legacy_arena = automated_arena(
                        candidate_checkpoint,
                        legacy_baseline_checkpoint,
                        teacher,
                        arena_visits,
                        control,
                    )
                    if float(legacy_arena["score"]) < 0.60:
                        reasons.append("direct V4 arena result is below 60 percent")
    return {
        "approved": not reasons,
        "candidate": candidate_metrics,
        "baseline": baseline_metrics,
        "arena": arena,
        "fresh_test": fresh_test,
        "replay_retention": replay_retention,
        "legacy_baseline": legacy_baseline_metrics,
        "legacy_arena": legacy_arena,
        "reasons": reasons,
        "test_split_locked": True,
        "improvement_required": require_improvement,
    }
