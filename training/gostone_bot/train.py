from __future__ import annotations

import argparse
import json
import os
import random
from pathlib import Path
from collections.abc import Sequence
from typing import Callable

import numpy as np
import onnx
import torch
from torch.nn import functional as F
from torch.utils.data import DataLoader, Dataset

from .board import MAX_BOARD_SIZE, PASS_INDEX
from .generate import JAPANESE_KOMI, STRENGTHS
from .model import GoStoneStudent, StudentConfig

MAX_MODEL_BYTES = 8 * 1024 * 1024


def transform_spatial(array: torch.Tensor, symmetry: int) -> torch.Tensor:
    rotation = symmetry % 4
    transformed = torch.rot90(array, rotation, dims=(-2, -1))
    return torch.flip(transformed, dims=(-1,)) if symmetry >= 4 else transformed


DEFAULT_LOSS_WEIGHTS = {
    "policy": 1.0,
    "value": 0.30,
    "score": 0.20,
    "ownership": 0.45,
    "survival": 0.30,
}


def training_archives(path: Path) -> list[Path]:
    if path.is_file():
        return [path]
    if path.is_dir():
        archives = sorted(path.glob("*.npz"))
        if archives:
            return archives
    raise FileNotFoundError(f"No training archives found at {path}")


def split_training_archives(path: Path) -> tuple[list[Path], list[Path]]:
    """Keep deterministic whole-game teacher data out of gradient updates."""
    archives = training_archives(path)
    if len(archives) < 5:
        return archives, []
    validation = archives[4::5]
    validation_set = set(validation)
    return [archive for archive in archives if archive not in validation_set], validation


class DistillationDataset(Dataset):
    def __init__(self, source: Path | Sequence[Path], augment: bool):
        archives = training_archives(source) if isinstance(source, Path) else list(source)
        if not archives:
            raise ValueError("Training dataset has no archives")
        arrays: dict[str, list[np.ndarray]] = {
            key: []
            for key in (
                "features",
                "policies",
                "values",
                "scores",
                "ownerships",
                "ownership_weights",
            )
        }
        for archive_path in archives:
            with np.load(archive_path) as archive:
                for key in arrays:
                    if key not in archive:
                        raise ValueError(f"Training archive {archive_path} is missing {key}")
                    arrays[key].append(archive[key])
        self.features = np.concatenate(arrays["features"]).astype(np.float32)
        self.policies = np.concatenate(arrays["policies"]).astype(np.float32)
        self.values = np.concatenate(arrays["values"]).astype(np.float32)
        self.scores = np.concatenate(arrays["scores"]).astype(np.float32)
        self.ownerships = np.concatenate(arrays["ownerships"]).astype(np.float32)
        self.ownership_weights = np.concatenate(arrays["ownership_weights"]).astype(np.float32)
        self.augment = augment
        lengths = {len(value) for value in (
            self.features,
            self.policies,
            self.values,
            self.scores,
            self.ownerships,
            self.ownership_weights,
        )}
        if len(lengths) != 1:
            raise ValueError("Training archive arrays have different lengths")

    def __len__(self) -> int:
        return len(self.features)

    def __getitem__(self, index: int):
        features = torch.from_numpy(self.features[index])
        policy = torch.from_numpy(self.policies[index])
        value = torch.tensor(self.values[index])
        score = torch.tensor(self.scores[index])
        ownership = torch.from_numpy(self.ownerships[index])
        ownership_weight = torch.from_numpy(self.ownership_weights[index])
        if self.augment:
            symmetry = random.randrange(8)
            features = transform_spatial(features, symmetry)
            board_policy = transform_spatial(
                policy[:PASS_INDEX].reshape(MAX_BOARD_SIZE, MAX_BOARD_SIZE),
                symmetry,
            ).reshape(-1)
            policy = torch.cat((board_policy, policy[PASS_INDEX:]))
            ownership = transform_spatial(
                ownership.reshape(MAX_BOARD_SIZE, MAX_BOARD_SIZE),
                symmetry,
            ).reshape(-1)
            ownership_weight = transform_spatial(
                ownership_weight.reshape(MAX_BOARD_SIZE, MAX_BOARD_SIZE),
                symmetry,
            ).reshape(-1)
        return features, policy, value, score, ownership, ownership_weight


def export_onnx(model: GoStoneStudent, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    model.eval()
    sample = torch.zeros(1, model.config.input_planes, MAX_BOARD_SIZE, MAX_BOARD_SIZE)
    sample[:, 4] = 1.0
    torch.onnx.export(
        model,
        sample,
        path,
        input_names=["features"],
        output_names=["policy_logits", "value", "score", "ownership", "survival_logits"],
        dynamic_axes={
            "features": {0: "batch"},
            "policy_logits": {0: "batch"},
            "value": {0: "batch"},
            "score": {0: "batch"},
            "ownership": {0: "batch"},
            "survival_logits": {0: "batch"},
        },
        opset_version=18,
        dynamo=False,
    )
    onnx.checker.check_model(onnx.load(path))
    if path.stat().st_size > MAX_MODEL_BYTES:
        raise RuntimeError(
            f"Exported browser model is {path.stat().st_size} bytes and exceeds the 8 MiB limit"
        )


def _weighted_mean(loss: torch.Tensor, weight: torch.Tensor) -> torch.Tensor:
    return (loss * weight).sum() / weight.sum().clamp_min(1.0)


def _atomic_torch_save(value: object, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    try:
        torch.save(value, temporary)
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


def _losses(
    outputs: tuple[torch.Tensor, torch.Tensor, torch.Tensor, torch.Tensor, torch.Tensor],
    targets: tuple[torch.Tensor, torch.Tensor, torch.Tensor, torch.Tensor, torch.Tensor, torch.Tensor],
) -> dict[str, torch.Tensor]:
    policy_logits, value, score, ownership, survival_logits = outputs
    features, target_policy, target_value, target_score, target_ownership, ownership_weight = targets
    black_stones = features[:, 0].flatten(1)
    white_stones = features[:, 1].flatten(1)
    stone_mask = (black_stones + white_stones).clamp(0.0, 1.0)
    survival_target = (
        black_stones * (1.0 - target_ownership) * 0.5
        + white_stones * (1.0 + target_ownership) * 0.5
    )
    return {
        "policy": -(target_policy * F.log_softmax(policy_logits, dim=1)).sum(dim=1).mean(),
        "value": F.mse_loss(value, target_value),
        "score": F.smooth_l1_loss(score, target_score),
        "ownership": _weighted_mean((ownership - target_ownership).square(), ownership_weight),
        "survival": _weighted_mean(
            F.binary_cross_entropy_with_logits(
                survival_logits,
                survival_target.clamp(0.0, 1.0),
                reduction="none",
            ),
            stone_mask * ownership_weight,
        ),
    }


def evaluate_checkpoint(
    checkpoint: Path,
    archives: Sequence[Path],
    *,
    batch_size: int = 64,
    cpu_threads: int | None = None,
) -> dict[str, float]:
    if not archives:
        raise ValueError("Quality evaluation requires held-out archives")
    saved = torch.load(checkpoint, map_location="cpu", weights_only=True)
    config = StudentConfig(**saved["config"])
    model = GoStoneStudent(config)
    model.load_state_dict(saved["state_dict"], strict=True)
    model.eval()
    torch.set_num_threads(max(1, min(12, cpu_threads or torch.get_num_threads())))
    dataset = DistillationDataset(archives, augment=False)
    loader = DataLoader(dataset, batch_size=min(batch_size, len(dataset)), shuffle=False, num_workers=0)
    totals = {key: 0.0 for key in DEFAULT_LOSS_WEIGHTS}
    examples = 0
    with torch.inference_mode():
        for batch in loader:
            features = batch[0]
            losses = _losses(model(features), batch)
            count = len(features)
            for key, loss in losses.items():
                totals[key] += float(loss) * count
            examples += count
    metrics = {key: value / examples for key, value in totals.items()}
    metrics["composite"] = sum(metrics[key] * weight for key, weight in DEFAULT_LOSS_WEIGHTS.items())
    metrics["positions"] = float(examples)
    return metrics


def train_student(
    *,
    data: Path,
    output_dir: Path,
    epochs: int,
    batch_size: int,
    learning_rate: float,
    channels: int,
    blocks: int,
    seed: int,
    initial_checkpoint: Path | None = None,
    cpu_threads: int | None = None,
    control: Callable[[], None] | None = None,
    on_epoch: Callable[[int, int, dict[str, float]], None] | None = None,
    on_batch: Callable[[int, int, int, int], None] | None = None,
    resume: bool = False,
    loss_weights: dict[str, float] | None = None,
) -> Path:
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    torch.set_num_threads(max(1, min(12, cpu_threads or torch.get_num_threads())))
    train_archives, _ = split_training_archives(data)
    dataset = DistillationDataset(train_archives, augment=True)
    if len(dataset) == 0:
        raise ValueError("Training dataset is empty")
    config = StudentConfig(channels=channels, blocks=blocks)
    model = GoStoneStudent(config)
    optimizer = torch.optim.AdamW(model.parameters(), lr=learning_rate, weight_decay=1e-4)
    output_dir.mkdir(parents=True, exist_ok=True)
    progress_checkpoint = output_dir / "training-progress.pt"
    start_epoch = 0
    start_batch = 0
    effective_weights = {**DEFAULT_LOSS_WEIGHTS, **(loss_weights or {})}
    if resume and progress_checkpoint.is_file():
        saved = torch.load(progress_checkpoint, map_location="cpu", weights_only=True)
        if saved.get("config") != config.as_dict():
            raise RuntimeError("Saved training architecture does not match this run")
        model.load_state_dict(saved["state_dict"])
        optimizer.load_state_dict(saved["optimizer"])
        start_epoch = int(saved.get("epoch_index", saved.get("completed_epochs", 0)))
        start_batch = int(saved.get("completed_batches_in_epoch", 0))
    elif initial_checkpoint is not None:
        if not initial_checkpoint.is_file():
            raise RuntimeError("The selected base model checkpoint no longer exists")
        saved = torch.load(initial_checkpoint, map_location="cpu", weights_only=True)
        if saved.get("config") != config.as_dict():
            raise RuntimeError("Base model architecture does not match this run")
        model.load_state_dict(saved["state_dict"], strict=True)
        print(f"continuing from base model: {initial_checkpoint}", flush=True)
    print(f"student parameters: {model.parameter_count:,}; positions: {len(dataset):,}", flush=True)
    for epoch in range(start_epoch, epochs):
        epoch_seed = seed + epoch * 10_007
        random.seed(epoch_seed)
        np.random.seed(epoch_seed)
        torch.manual_seed(epoch_seed)
        generator = torch.Generator().manual_seed(epoch_seed)
        loader = DataLoader(
            dataset,
            batch_size=min(batch_size, len(dataset)),
            shuffle=True,
            num_workers=0,
            generator=generator,
        )
        model.train()
        totals = {key: 0.0 for key in ("loss", "policy", "value", "score", "ownership", "survival")}
        batches = 0
        total_batches = len(loader)
        for batch_index, batch in enumerate(loader):
            if epoch == start_epoch and batch_index < start_batch:
                continue
            if control:
                control()
            features = batch[0]
            optimizer.zero_grad(set_to_none=True)
            losses = _losses(model(features), batch)
            loss = sum(losses[key] * effective_weights[key] for key in DEFAULT_LOSS_WEIGHTS)
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 5.0)
            optimizer.step()
            for key, metric in (("loss", loss), *losses.items()):
                totals[key] += float(metric.detach())
            batches += 1
            _atomic_torch_save(
                {
                    "config": config.as_dict(),
                    "state_dict": model.state_dict(),
                    "optimizer": optimizer.state_dict(),
                    "epoch_index": epoch,
                    "completed_epochs": epoch,
                    "completed_batches_in_epoch": batch_index + 1,
                    "loss_weights": effective_weights,
                },
                progress_checkpoint,
            )
            if on_batch:
                on_batch(epoch + 1, epochs, batch_index + 1, total_batches)
        metrics = {key: value / batches for key, value in totals.items()}
        _atomic_torch_save(
            {
                "config": config.as_dict(),
                "state_dict": model.state_dict(),
                "optimizer": optimizer.state_dict(),
                "epoch_index": epoch + 1,
                "completed_epochs": epoch + 1,
                "completed_batches_in_epoch": 0,
                "loss_weights": effective_weights,
            },
            progress_checkpoint,
        )
        start_batch = 0
        print(
            f"epoch {epoch + 1}/{epochs}: loss={metrics['loss']:.4f}, "
            f"policy={metrics['policy']:.4f}, ownership={metrics['ownership']:.4f}, "
            f"survival={metrics['survival']:.4f}",
            flush=True,
        )
        if on_epoch:
            on_epoch(epoch + 1, epochs, metrics)
    checkpoint = output_dir / "gostone-japanese-v1.pt"
    _atomic_torch_save({"config": config.as_dict(), "state_dict": model.state_dict()}, checkpoint)
    onnx_path = output_dir / "gostone-japanese-v1.onnx"
    export_onnx(model, onnx_path)
    metadata = {
        "format": 2,
        "model": "GoStoneJapaneseStudent",
        "rules": "japanese",
        "komi": JAPANESE_KOMI,
        "config": config.as_dict(),
        "parameters": model.parameter_count,
        "onnx_bytes": onnx_path.stat().st_size,
        "max_onnx_bytes": MAX_MODEL_BYTES,
        "outputs": {
            "policy_logits": "362 move logits including pass",
            "value": "win value from side-to-move perspective",
            "score": "score lead divided by board area, side-to-move perspective",
            "ownership": "per-point ownership: -1 Black, +1 White",
            "survival_logits": "per-stone survival confidence for group settlement",
        },
        "strength_input": {
            "feature_plane": 7,
            "range": [0.0, 1.0],
            "profiles": [
                {"name": profile.name, "nominal_elo": profile.nominal_elo, "value": profile.normalized}
                for profile in STRENGTHS
            ],
            "status": "nominal targets; requires calibration league before publication",
        },
        "settlement": {
            "authority": "proposal only; both players must accept",
            "dead_threshold": 0.25,
            "alive_threshold": 0.75,
            "uncertain_between_thresholds": True,
        },
    }
    (output_dir / "gostone-japanese-v1.json").write_text(
        json.dumps(metadata, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"checkpoint: {checkpoint}", flush=True)
    print(f"browser model: {onnx_path} ({onnx_path.stat().st_size / 1024 / 1024:.2f} MiB)", flush=True)
    return onnx_path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Train the compact Japanese-rules GoStone model")
    parser.add_argument("--data", type=Path, default=Path("training/gostone_bot/data/teacher-v2.npz"))
    parser.add_argument("--output-dir", type=Path, default=Path("training/gostone_bot/artifacts/japanese-v1"))
    parser.add_argument("--epochs", type=int, default=20)
    parser.add_argument("--batch-size", type=int, default=64)
    parser.add_argument("--learning-rate", type=float, default=3e-4)
    parser.add_argument("--channels", type=int, default=96)
    parser.add_argument("--blocks", type=int, default=10)
    parser.add_argument("--cpu-threads", type=int)
    parser.add_argument("--seed", type=int, default=20260801)
    parser.add_argument("--initial-checkpoint", type=Path)
    parser.add_argument("--resume", action="store_true")
    return parser.parse_args()


if __name__ == "__main__":
    arguments = parse_args()
    train_student(
        data=arguments.data,
        output_dir=arguments.output_dir,
        epochs=arguments.epochs,
        batch_size=arguments.batch_size,
        learning_rate=arguments.learning_rate,
        channels=arguments.channels,
        blocks=arguments.blocks,
        cpu_threads=arguments.cpu_threads,
        seed=arguments.seed,
        initial_checkpoint=arguments.initial_checkpoint,
        resume=arguments.resume,
    )
