from __future__ import annotations

import argparse
import json
import random
from pathlib import Path

import numpy as np
import onnx
import torch
from torch.nn import functional as F
from torch.utils.data import DataLoader, Dataset

from .board import MAX_BOARD_SIZE, PASS_INDEX
from .model import GoStoneStudent, StudentConfig


def transform_spatial(array: torch.Tensor, symmetry: int) -> torch.Tensor:
    rotation = symmetry % 4
    transformed = torch.rot90(array, rotation, dims=(-2, -1))
    return torch.flip(transformed, dims=(-1,)) if symmetry >= 4 else transformed


class DistillationDataset(Dataset):
    def __init__(self, path: Path, augment: bool):
        archive = np.load(path)
        self.features = archive["features"].astype(np.float32)
        self.policies = archive["policies"].astype(np.float32)
        self.values = archive["values"].astype(np.float32)
        self.augment = augment
        if not (len(self.features) == len(self.policies) == len(self.values)):
            raise ValueError("Training archive arrays have different lengths")

    def __len__(self) -> int:
        return len(self.features)

    def __getitem__(self, index: int):
        features = torch.from_numpy(self.features[index])
        policy = torch.from_numpy(self.policies[index])
        value = torch.tensor(self.values[index])
        if self.augment:
            symmetry = random.randrange(8)
            features = transform_spatial(features, symmetry)
            board_policy = policy[:PASS_INDEX].reshape(MAX_BOARD_SIZE, MAX_BOARD_SIZE)
            board_policy = transform_spatial(board_policy, symmetry).reshape(-1)
            policy = torch.cat((board_policy, policy[PASS_INDEX:]))
        return features, policy, value


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
        output_names=["policy_logits", "value"],
        dynamic_axes={"features": {0: "batch"}, "policy_logits": {0: "batch"}, "value": {0: "batch"}},
        opset_version=18,
        dynamo=False,
    )
    onnx.checker.check_model(onnx.load(path))


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
) -> Path:
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    torch.set_num_threads(min(10, max(1, torch.get_num_threads())))
    dataset = DistillationDataset(data, augment=True)
    if len(dataset) == 0:
        raise ValueError("Training dataset is empty")
    loader = DataLoader(dataset, batch_size=min(batch_size, len(dataset)), shuffle=True, num_workers=0)
    config = StudentConfig(channels=channels, blocks=blocks)
    model = GoStoneStudent(config)
    optimizer = torch.optim.AdamW(model.parameters(), lr=learning_rate, weight_decay=1e-4)
    print(f"student parameters: {model.parameter_count:,}")
    for epoch in range(epochs):
        model.train()
        total_loss = 0.0
        total_policy = 0.0
        total_value = 0.0
        batches = 0
        for features, target_policy, target_value in loader:
            optimizer.zero_grad(set_to_none=True)
            policy_logits, value = model(features)
            policy_loss = -(target_policy * F.log_softmax(policy_logits, dim=1)).sum(dim=1).mean()
            value_loss = F.mse_loss(value, target_value)
            loss = policy_loss + 0.35 * value_loss
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 5.0)
            optimizer.step()
            total_loss += float(loss.detach())
            total_policy += float(policy_loss.detach())
            total_value += float(value_loss.detach())
            batches += 1
        print(
            f"epoch {epoch + 1}/{epochs}: loss={total_loss / batches:.4f}, "
            f"policy={total_policy / batches:.4f}, value={total_value / batches:.4f}"
        )
    output_dir.mkdir(parents=True, exist_ok=True)
    checkpoint = output_dir / "gostone-student-v1.pt"
    torch.save({"config": config.as_dict(), "state_dict": model.state_dict()}, checkpoint)
    onnx_path = output_dir / "gostone-student-v1.onnx"
    export_onnx(model, onnx_path)
    metadata = {
        "format": 1,
        "model": "GoStoneStudent",
        "config": config.as_dict(),
        "parameters": model.parameter_count,
        "onnx_bytes": onnx_path.stat().st_size,
        "strength_input": {
            "feature_plane": 7,
            "range": [0.0, 1.0],
            "nominal_elos": [600, 900, 1200, 1500, 1800, 2100],
        },
    }
    (output_dir / "gostone-student-v1.json").write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")
    print(f"checkpoint: {checkpoint}")
    print(f"browser model: {onnx_path} ({onnx_path.stat().st_size / 1024 / 1024:.2f} MiB)")
    if onnx_path.stat().st_size > 8 * 1024 * 1024:
        raise RuntimeError("Exported browser model exceeds the 8 MiB limit")
    return onnx_path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Train the compact GoStone student model")
    parser.add_argument("--data", type=Path, default=Path("training/gostone_bot/data/teacher-v1.npz"))
    parser.add_argument("--output-dir", type=Path, default=Path("training/gostone_bot/artifacts/v1"))
    parser.add_argument("--epochs", type=int, default=20)
    parser.add_argument("--batch-size", type=int, default=64)
    parser.add_argument("--learning-rate", type=float, default=3e-4)
    parser.add_argument("--channels", type=int, default=64)
    parser.add_argument("--blocks", type=int, default=10)
    parser.add_argument("--seed", type=int, default=20260801)
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
        seed=arguments.seed,
    )
