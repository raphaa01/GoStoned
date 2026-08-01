from __future__ import annotations

import argparse
import json
import random
from pathlib import Path
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


def training_archives(path: Path) -> list[Path]:
    if path.is_file():
        return [path]
    if path.is_dir():
        archives = sorted(path.glob("*.npz"))
        if archives:
            return archives
    raise FileNotFoundError(f"No training archives found at {path}")


class DistillationDataset(Dataset):
    def __init__(self, path: Path, augment: bool):
        archives = training_archives(path)
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
    cpu_threads: int | None = None,
    control: Callable[[], None] | None = None,
    on_epoch: Callable[[int, int, dict[str, float]], None] | None = None,
    resume: bool = False,
) -> Path:
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    torch.set_num_threads(max(1, min(12, cpu_threads or torch.get_num_threads())))
    dataset = DistillationDataset(data, augment=True)
    if len(dataset) == 0:
        raise ValueError("Training dataset is empty")
    loader = DataLoader(dataset, batch_size=min(batch_size, len(dataset)), shuffle=True, num_workers=0)
    config = StudentConfig(channels=channels, blocks=blocks)
    model = GoStoneStudent(config)
    optimizer = torch.optim.AdamW(model.parameters(), lr=learning_rate, weight_decay=1e-4)
    output_dir.mkdir(parents=True, exist_ok=True)
    progress_checkpoint = output_dir / "training-progress.pt"
    start_epoch = 0
    if resume and progress_checkpoint.is_file():
        saved = torch.load(progress_checkpoint, map_location="cpu")
        if saved.get("config") != config.as_dict():
            raise RuntimeError("Saved training architecture does not match this run")
        model.load_state_dict(saved["state_dict"])
        optimizer.load_state_dict(saved["optimizer"])
        start_epoch = int(saved.get("completed_epochs", 0))
    print(f"student parameters: {model.parameter_count:,}; positions: {len(dataset):,}", flush=True)
    for epoch in range(start_epoch, epochs):
        model.train()
        totals = {key: 0.0 for key in ("loss", "policy", "value", "score", "ownership", "survival")}
        batches = 0
        for features, target_policy, target_value, target_score, target_ownership, ownership_weight in loader:
            if control:
                control()
            optimizer.zero_grad(set_to_none=True)
            policy_logits, value, score, ownership, survival_logits = model(features)
            policy_loss = -(target_policy * F.log_softmax(policy_logits, dim=1)).sum(dim=1).mean()
            value_loss = F.mse_loss(value, target_value)
            score_loss = F.smooth_l1_loss(score, target_score)
            ownership_loss = _weighted_mean((ownership - target_ownership).square(), ownership_weight)
            black_stones = features[:, 0].flatten(1)
            white_stones = features[:, 1].flatten(1)
            stone_mask = (black_stones + white_stones).clamp(0.0, 1.0)
            # KataGo ownership is -1 for Black and +1 for White. A stone's
            # survival target is high when ownership agrees with its color.
            survival_target = (
                black_stones * (1.0 - target_ownership) * 0.5
                + white_stones * (1.0 + target_ownership) * 0.5
            )
            survival_weight = stone_mask * ownership_weight
            survival_loss = _weighted_mean(
                F.binary_cross_entropy_with_logits(
                    survival_logits,
                    survival_target.clamp(0.0, 1.0),
                    reduction="none",
                ),
                survival_weight,
            )
            loss = (
                policy_loss
                + 0.30 * value_loss
                + 0.20 * score_loss
                + 0.45 * ownership_loss
                + 0.30 * survival_loss
            )
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 5.0)
            optimizer.step()
            for key, metric in (
                ("loss", loss),
                ("policy", policy_loss),
                ("value", value_loss),
                ("score", score_loss),
                ("ownership", ownership_loss),
                ("survival", survival_loss),
            ):
                totals[key] += float(metric.detach())
            batches += 1
        metrics = {key: value / batches for key, value in totals.items()}
        torch.save(
            {
                "config": config.as_dict(),
                "state_dict": model.state_dict(),
                "optimizer": optimizer.state_dict(),
                "completed_epochs": epoch + 1,
            },
            progress_checkpoint,
        )
        print(
            f"epoch {epoch + 1}/{epochs}: loss={metrics['loss']:.4f}, "
            f"policy={metrics['policy']:.4f}, ownership={metrics['ownership']:.4f}, "
            f"survival={metrics['survival']:.4f}",
            flush=True,
        )
        if on_epoch:
            on_epoch(epoch + 1, epochs, metrics)
    checkpoint = output_dir / "gostone-japanese-v1.pt"
    torch.save({"config": config.as_dict(), "state_dict": model.state_dict()}, checkpoint)
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
        resume=arguments.resume,
    )
