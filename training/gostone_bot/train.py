from __future__ import annotations

import argparse
import copy
import json
import math
import os
import random
import time
from pathlib import Path
from typing import Callable, Iterable

import numpy as np
import onnx
import torch
from torch import nn
from torch.nn import functional as F
from torch.utils.data import DataLoader

from .board import MAX_BOARD_SIZE
from .data import StreamingShardDataset
from .generate import JAPANESE_KOMI, STRENGTHS
from .model import GoStoneStudent, SCORE_BINS, StudentConfig, load_checkpoint_model

MAX_MODEL_BYTES = 15 * 1024 * 1024


def _weighted_mean(loss: torch.Tensor, weight: torch.Tensor) -> torch.Tensor:
    return (loss * weight).sum() / weight.sum().clamp_min(1.0)


def _atomic_torch_save(value: object, path: Path) -> None:
    temporary = path.with_name(f".{path.name}.{os.getpid()}.{time.time_ns()}.tmp")
    try:
        torch.save(value, temporary)
        for attempt in range(12):
            try:
                temporary.replace(path); return
            except PermissionError:
                if attempt == 11: raise
                time.sleep(0.02 * (attempt + 1))
    finally:
        temporary.unlink(missing_ok=True)


def _forward(model: nn.Module, features: torch.Tensor):
    input_planes = int(getattr(model, "config").input_planes)
    outputs = model(features[:, :input_planes])
    if len(outputs) >= 9:
        return outputs
    policy, value, score, ownership, survival = outputs
    score_stdev = torch.full_like(score, 0.25)
    territory = torch.stack((-ownership, ownership, 1.0 - ownership.abs()), dim=1)
    status = torch.stack((survival, -survival, torch.full_like(survival, -10.0), torch.zeros_like(survival)), dim=1)
    score_logits = torch.zeros(score.shape[0], SCORE_BINS, device=score.device)
    return policy, value, score, ownership, survival, score_stdev, territory, status, score_logits


def _batch_losses(model: nn.Module, batch: dict[str, torch.Tensor]) -> tuple[torch.Tensor, dict[str, torch.Tensor]]:
    policy, value, score, ownership, survival, score_stdev, territory, status, score_logits = _forward(model, batch["features"])
    policy_loss = -(batch["policy"] * F.log_softmax(policy, dim=1)).sum(dim=1).mean()
    value_loss = F.mse_loss(value, batch["value"])
    score_regression = F.smooth_l1_loss(score, batch["score"])
    score_index = ((batch["score"] + 1.0) * 0.5 * (SCORE_BINS - 1)).round().long().clamp(0, SCORE_BINS - 1)
    score_distribution = F.cross_entropy(score_logits, score_index)
    score_calibration = (batch["score"] - score).abs().sub(score_stdev).abs().mean()
    ownership_loss = _weighted_mean((ownership - batch["ownership"]).square(), batch["ownership_weight"])
    status_loss = _weighted_mean(
        F.cross_entropy(status, batch["status"], reduction="none"), batch["status_weight"]
    )
    territory_loss = _weighted_mean(
        F.cross_entropy(territory, batch["territory"], reduction="none"), batch["territory_weight"]
    )
    survival_target = (batch["status"] == 0).float() + (batch["status"] == 2).float() + 0.5 * (batch["status"] == 3).float()
    survival_loss = _weighted_mean(
        F.binary_cross_entropy_with_logits(survival, survival_target, reduction="none"), batch["status_weight"]
    )
    loss = (
        policy_loss + 0.25 * value_loss + 0.20 * score_regression + 0.08 * score_distribution
        + 0.04 * score_calibration + 0.40 * ownership_loss + 0.30 * status_loss
        + 0.20 * territory_loss + 0.10 * survival_loss
    )
    return loss, {
        "loss": loss, "policy": policy_loss, "value": value_loss,
        "score": score_regression, "score_distribution": score_distribution,
        "calibration": score_calibration, "ownership": ownership_loss,
        "status": status_loss, "territory": territory_loss, "survival": survival_loss,
    }


def evaluate_model(model: nn.Module, dataset: StreamingShardDataset, batch_size: int = 64) -> dict[str, float]:
    if len(dataset) == 0: return {"positions": 0.0}
    model.eval(); loader = DataLoader(dataset, batch_size=min(batch_size, len(dataset)), num_workers=0)
    totals = {key: 0.0 for key in (
        "policy_loss", "policy_top1", "value_mse", "score_mae", "score_mae_points",
        "ownership_mse", "status_accuracy", "territory_accuracy", "seki_false_positive",
        "settlement_coverage", "covered_status_accuracy", "calibration_error",
    )}
    counts = {key: 0.0 for key in totals}; board_sizes: set[int] = set()
    status_confusion = torch.zeros(4, 4, dtype=torch.float64)
    with torch.inference_mode():
        for batch in loader:
            policy, value, score, ownership, _, score_stdev, territory, status, _ = _forward(model, batch["features"])
            batch_count = len(value); board_sizes.update(int(item) for item in batch["board_size"])
            policy_each = -(batch["policy"] * F.log_softmax(policy, dim=1)).sum(dim=1)
            totals["policy_loss"] += float(policy_each.sum()); counts["policy_loss"] += batch_count
            totals["policy_top1"] += float((policy.argmax(1) == batch["policy"].argmax(1)).sum()); counts["policy_top1"] += batch_count
            totals["value_mse"] += float((value - batch["value"]).square().sum()); counts["value_mse"] += batch_count
            score_error = (score - batch["score"]).abs()
            totals["score_mae"] += float(score_error.sum()); counts["score_mae"] += batch_count
            totals["score_mae_points"] += float((score_error * batch["board_size"].float().square()).sum()); counts["score_mae_points"] += batch_count
            totals["calibration_error"] += float((score_error - score_stdev).abs().sum()); counts["calibration_error"] += batch_count
            ownership_weight = batch["ownership_weight"]
            totals["ownership_mse"] += float(((ownership - batch["ownership"]).square() * ownership_weight).sum()); counts["ownership_mse"] += float(ownership_weight.sum())
            status_weight = batch["status_weight"]; status_prediction = status.argmax(1)
            totals["status_accuracy"] += float(((status_prediction == batch["status"]) * status_weight).sum()); counts["status_accuracy"] += float(status_weight.sum())
            flat_target = batch["status"].reshape(-1); flat_prediction = status_prediction.reshape(-1); flat_weight = status_weight.reshape(-1).double()
            encoded = flat_target * 4 + flat_prediction
            status_confusion += torch.bincount(encoded, weights=flat_weight, minlength=16).reshape(4, 4)
            territory_weight = batch["territory_weight"]; territory_prediction = territory.argmax(1)
            totals["territory_accuracy"] += float(((territory_prediction == batch["territory"]) * territory_weight).sum()); counts["territory_accuracy"] += float(territory_weight.sum())
            non_seki = (batch["status"] != 2) & (status_weight > 0)
            totals["seki_false_positive"] += float(((status_prediction == 2) & non_seki).sum()); counts["seki_false_positive"] += float(non_seki.sum())
            confidence = F.softmax(status, dim=1).amax(1); covered = (confidence >= 0.75) & (status_weight > 0)
            totals["settlement_coverage"] += float(covered.sum()); counts["settlement_coverage"] += float((status_weight > 0).sum())
            totals["covered_status_accuracy"] += float(((status_prediction == batch["status"]) & covered).sum()); counts["covered_status_accuracy"] += float(covered.sum())
    metrics = {key: totals[key] / max(1.0, counts[key]) for key in totals}
    for class_index, name in enumerate(("alive", "dead", "seki", "unsettled")):
        true_positive = float(status_confusion[class_index, class_index])
        metrics[f"{name}_precision"] = true_positive / max(1.0, float(status_confusion[:, class_index].sum()))
        metrics[f"{name}_recall"] = true_positive / max(1.0, float(status_confusion[class_index, :].sum()))
    metrics["positions"] = float(len(dataset)); metrics["board_sizes"] = float(len(board_sizes))
    return metrics


def validation_objective(metrics: dict[str, float]) -> float:
    if not metrics.get("positions"): return math.inf
    return (
        metrics["policy_loss"] + 1.5 * metrics["score_mae"] + metrics["ownership_mse"]
        + (1.0 - metrics["status_accuracy"]) + 0.5 * (1.0 - metrics["territory_accuracy"])
        + metrics["seki_false_positive"]
    )


def export_onnx(model: GoStoneStudent, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True); model.eval()
    sample = torch.zeros(1, model.config.input_planes, MAX_BOARD_SIZE, MAX_BOARD_SIZE); sample[:, 4] = 1.0
    torch.onnx.export(
        model, sample, path, input_names=["features"],
        output_names=[
            "policy_logits", "value", "score", "ownership", "survival_logits",
            "score_stdev", "territory_logits", "status_logits", "score_logits",
        ],
        dynamic_axes={name: {0: "batch"} for name in (
            "features", "policy_logits", "value", "score", "ownership", "survival_logits",
            "score_stdev", "territory_logits", "status_logits", "score_logits",
        )},
        opset_version=18, dynamo=False,
    )
    onnx.checker.check_model(onnx.load(path))
    if path.stat().st_size > MAX_MODEL_BYTES:
        raise RuntimeError(f"Exported browser model is {path.stat().st_size} bytes and exceeds the 15 MiB limit")


def _ema_update(ema: dict[str, torch.Tensor], model: nn.Module, decay: float = 0.999) -> None:
    for key, value in model.state_dict().items():
        if not value.is_floating_point(): ema[key] = value.detach().clone()
        else: ema[key].mul_(decay).add_(value.detach(), alpha=1.0 - decay)


def train_student(
    *, data: Path | Iterable[Path], output_dir: Path, epochs: int, batch_size: int,
    learning_rate: float, channels: int, blocks: int, seed: int,
    initial_checkpoint: Path | None = None, cpu_threads: int | None = None,
    control: Callable[[], None] | None = None,
    on_epoch: Callable[[int, int, dict[str, float]], None] | None = None,
    resume: bool = False, min_epochs: int = 5, early_stopping_patience: int = 6,
) -> Path:
    random.seed(seed); np.random.seed(seed); torch.manual_seed(seed)
    torch.set_num_threads(max(1, min(12, cpu_threads or torch.get_num_threads())))
    paths = [data] if isinstance(data, Path) else list(data)
    train_data = StreamingShardDataset(paths, "train", augment=True, seed=seed)
    validation_data = StreamingShardDataset(paths, "validation", augment=False, seed=seed)
    test_data = StreamingShardDataset(paths, "test", augment=False, seed=seed)
    if len(train_data) == 0: raise ValueError("Training dataset contains no train split")
    config = StudentConfig(channels=channels, blocks=blocks)
    model = GoStoneStudent(config); optimizer = torch.optim.AdamW(model.parameters(), lr=learning_rate, weight_decay=2e-4)
    warmup = max(1, min(3, epochs // 10))
    scheduler = torch.optim.lr_scheduler.LambdaLR(
        optimizer,
        lambda epoch: (epoch + 1) / warmup if epoch < warmup else 0.05 + 0.95 * 0.5 * (1 + math.cos(math.pi * (epoch - warmup) / max(1, epochs - warmup))),
    )
    output_dir.mkdir(parents=True, exist_ok=True); progress = output_dir / "training-progress.pt"
    start_epoch = 0; best_objective = math.inf; epochs_without_improvement = 0; best_state = None
    ema = {key: value.detach().clone() for key, value in model.state_dict().items()}
    if resume and progress.is_file():
        saved = torch.load(progress, map_location="cpu", weights_only=True)
        if saved.get("config") != config.as_dict(): raise RuntimeError("Saved training architecture does not match this run")
        model.load_state_dict(saved["state_dict"]); optimizer.load_state_dict(saved["optimizer"])
        if "scheduler" in saved: scheduler.load_state_dict(saved["scheduler"])
        ema = saved.get("ema_state", ema); best_state = saved.get("best_state")
        best_objective = float(saved.get("best_objective", math.inf)); epochs_without_improvement = int(saved.get("epochs_without_improvement", 0))
        start_epoch = int(saved.get("completed_epochs", 0))
    elif initial_checkpoint is not None:
        base = torch.load(initial_checkpoint, map_location="cpu", weights_only=True)
        if base.get("config") != config.as_dict(): raise RuntimeError("Base model architecture does not match V5")
        model.load_state_dict(base["state_dict"], strict=True)
        ema = {key: value.detach().clone() for key, value in model.state_dict().items()}
        print(f"continuing from base model: {initial_checkpoint}", flush=True)
    print(f"student parameters: {model.parameter_count:,}; train={len(train_data):,}; validation={len(validation_data):,}; test={len(test_data):,}", flush=True)
    completed_epochs = start_epoch
    for epoch in range(start_epoch, epochs):
        train_data.set_epoch(epoch); model.train(); loader = DataLoader(train_data, batch_size=min(batch_size, len(train_data)), num_workers=0)
        totals: dict[str, float] = {}; batches = 0
        for batch in loader:
            if control: control()
            optimizer.zero_grad(set_to_none=True); loss, batch_metrics = _batch_losses(model, batch)
            loss.backward(); torch.nn.utils.clip_grad_norm_(model.parameters(), 3.0); optimizer.step(); _ema_update(ema, model)
            for key, metric in batch_metrics.items(): totals[key] = totals.get(key, 0.0) + float(metric.detach())
            batches += 1
        scheduler.step(); completed_epochs = epoch + 1
        metrics = {key: value / max(1, batches) for key, value in totals.items()}; metrics["learning_rate"] = optimizer.param_groups[0]["lr"]
        evaluation_model = copy.deepcopy(model); evaluation_model.load_state_dict(ema); validation = evaluate_model(evaluation_model, validation_data, batch_size)
        objective = validation_objective(validation)
        if objective < best_objective - 1e-4:
            best_objective = objective; epochs_without_improvement = 0
            best_state = {key: value.detach().clone() for key, value in ema.items()}
        else: epochs_without_improvement += 1
        metrics.update({f"validation_{key}": value for key, value in validation.items()})
        _atomic_torch_save({
            "config": config.as_dict(), "state_dict": model.state_dict(), "optimizer": optimizer.state_dict(),
            "scheduler": scheduler.state_dict(), "ema_state": ema, "best_state": best_state,
            "best_objective": best_objective, "epochs_without_improvement": epochs_without_improvement,
            "completed_epochs": completed_epochs,
        }, progress)
        print(f"epoch {completed_epochs}/{epochs}: loss={metrics['loss']:.4f}, validation={objective:.4f}, patience={epochs_without_improvement}/{early_stopping_patience}", flush=True)
        if on_epoch: on_epoch(completed_epochs, epochs, metrics)
        if len(validation_data) and completed_epochs >= min_epochs and epochs_without_improvement >= early_stopping_patience:
            print("early stopping: validation objective stopped improving", flush=True); break

    if best_state is not None: model.load_state_dict(best_state)
    else: model.load_state_dict(ema)
    checkpoint = output_dir / "gostone-japanese-v1.pt"
    _atomic_torch_save({"config": config.as_dict(), "state_dict": model.state_dict()}, checkpoint)
    onnx_path = output_dir / "gostone-japanese-v1.onnx"; export_onnx(model, onnx_path)
    validation_metrics = evaluate_model(model, validation_data, batch_size); test_metrics = evaluate_model(model, test_data, batch_size)
    metadata = {
        "format": 5, "architecture_version": 5, "model": "GoStoneJapaneseStudent", "rules": "japanese", "komi": JAPANESE_KOMI,
        "config": config.as_dict(), "parameters": model.parameter_count, "onnx_bytes": onnx_path.stat().st_size,
        "max_onnx_bytes": MAX_MODEL_BYTES, "completed_epochs": completed_epochs,
        "validation_metrics": validation_metrics, "test_metrics": test_metrics,
        "outputs": {
            "policy_logits": "rank-conditioned 362 move logits including pass", "value": "side-to-move win value",
            "score": "expected side-to-move score lead divided by board area", "score_stdev": "forecast uncertainty",
            "ownership": "fixed-color ownership: -1 Black, +1 White", "territory_logits": "Black, White, neutral/dame",
            "status_logits": "alive, dead, seki, unsettled", "survival_logits": "compatibility survival confidence",
        },
        "strength_input": {"feature_plane": 7, "policy_only": True, "profiles": [
            {"name": item.name, "nominal_elo": item.nominal_elo, "value": item.normalized} for item in STRENGTHS
        ]},
        "settlement": {"authority": "proposal-only", "requires_player_agreement": True},
    }
    (output_dir / "gostone-japanese-v1.json").write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")
    print(f"browser model: {onnx_path} ({onnx_path.stat().st_size / 1024 / 1024:.2f} MiB)", flush=True)
    return onnx_path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Train GoStone V5")
    parser.add_argument("--data", type=Path, default=Path("training/gostone_bot/data/teacher-v5")); parser.add_argument("--output-dir", type=Path, default=Path("training/gostone_bot/artifacts/japanese-v5"))
    parser.add_argument("--epochs", type=int, default=40); parser.add_argument("--batch-size", type=int, default=64); parser.add_argument("--learning-rate", type=float, default=3e-4)
    parser.add_argument("--channels", type=int, default=128); parser.add_argument("--blocks", type=int, default=10); parser.add_argument("--cpu-threads", type=int)
    parser.add_argument("--seed", type=int, default=20260909); parser.add_argument("--initial-checkpoint", type=Path); parser.add_argument("--resume", action="store_true")
    return parser.parse_args()


if __name__ == "__main__":
    arguments = parse_args()
    train_student(data=arguments.data, output_dir=arguments.output_dir, epochs=arguments.epochs, batch_size=arguments.batch_size, learning_rate=arguments.learning_rate, channels=arguments.channels, blocks=arguments.blocks, cpu_threads=arguments.cpu_threads, seed=arguments.seed, initial_checkpoint=arguments.initial_checkpoint, resume=arguments.resume)
