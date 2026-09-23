from __future__ import annotations

import json
import random
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

import numpy as np
import torch
from torch.utils.data import IterableDataset, get_worker_info

from .board import MAX_BOARD_SIZE, PASS_INDEX

REQUIRED_KEYS = (
    "features", "policies", "values", "scores", "ownerships", "ownership_weights",
    "status_targets", "status_weights", "territory_targets", "territory_weights",
    "position_kinds", "board_sizes",
)


def transform_spatial(array: torch.Tensor, symmetry: int) -> torch.Tensor:
    transformed = torch.rot90(array, symmetry % 4, dims=(-2, -1))
    return torch.flip(transformed, dims=(-1,)) if symmetry >= 4 else transformed


def archive_metadata(archive: np.lib.npyio.NpzFile) -> dict[str, object]:
    if "metadata" not in archive:
        return {}
    raw = archive["metadata"]
    value = raw.item() if getattr(raw, "shape", None) == () else raw
    if isinstance(value, bytes): value = value.decode("utf-8")
    try:
        parsed = json.loads(str(value))
    except json.JSONDecodeError:
        return {}
    return parsed if isinstance(parsed, dict) else {}


@dataclass(frozen=True)
class Shard:
    path: Path
    length: int
    split: str


def discover_shards(paths: Iterable[Path], split: str) -> list[Shard]:
    candidates: list[Path] = []
    for path in paths:
        if path.is_file() and path.suffix == ".npz": candidates.append(path)
        elif path.is_dir(): candidates.extend(sorted(path.glob("game-*.npz")))
    shards: list[Shard] = []
    seen: set[Path] = set()
    for path in candidates:
        resolved = path.resolve()
        if resolved in seen: continue
        seen.add(resolved)
        with np.load(path, allow_pickle=False) as archive:
            missing = [key for key in REQUIRED_KEYS if key not in archive]
            if missing: raise ValueError(f"Training archive {path} is missing {', '.join(missing)}")
            metadata = archive_metadata(archive); shard_split = str(metadata.get("split", "train"))
            length = len(archive["features"])
            if any(len(archive[key]) != length for key in REQUIRED_KEYS):
                raise ValueError(f"Training archive {path} contains arrays with different lengths")
        if shard_split == split: shards.append(Shard(resolved, length, shard_split))
    return shards


class StreamingShardDataset(IterableDataset):
    """Loads one compressed game shard at a time instead of the full replay set."""

    def __init__(self, paths: Iterable[Path], split: str, augment: bool, seed: int):
        super().__init__()
        self.shards = discover_shards(paths, split)
        self.augment = augment
        self.seed = seed
        self.epoch = 0

    def __len__(self) -> int:
        return sum(shard.length for shard in self.shards)

    def set_epoch(self, epoch: int) -> None:
        self.epoch = epoch

    def __iter__(self):
        worker = get_worker_info(); worker_id = worker.id if worker else 0; worker_count = worker.num_workers if worker else 1
        rng = random.Random(self.seed + self.epoch * 1_000_003 + worker_id)
        shards = list(self.shards); rng.shuffle(shards)
        for shard_index, shard in enumerate(shards):
            if shard_index % worker_count != worker_id: continue
            with np.load(shard.path, allow_pickle=False) as archive:
                arrays = {key: archive[key] for key in REQUIRED_KEYS}
                order = list(range(shard.length))
                if self.augment: rng.shuffle(order)
                for index in order:
                    features = torch.from_numpy(arrays["features"][index].astype(np.float32))
                    policy = torch.from_numpy(arrays["policies"][index].astype(np.float32))
                    ownership = torch.from_numpy(arrays["ownerships"][index].astype(np.float32))
                    ownership_weight = torch.from_numpy(arrays["ownership_weights"][index].astype(np.float32))
                    status = torch.from_numpy(arrays["status_targets"][index].astype(np.int64))
                    status_weight = torch.from_numpy(arrays["status_weights"][index].astype(np.float32))
                    territory = torch.from_numpy(arrays["territory_targets"][index].astype(np.int64))
                    territory_weight = torch.from_numpy(arrays["territory_weights"][index].astype(np.float32))
                    if self.augment:
                        symmetry = rng.randrange(8)
                        features = transform_spatial(features, symmetry)
                        board_policy = transform_spatial(policy[:PASS_INDEX].reshape(MAX_BOARD_SIZE, MAX_BOARD_SIZE), symmetry).reshape(-1)
                        policy = torch.cat((board_policy, policy[PASS_INDEX:]))
                        ownership = transform_spatial(ownership.reshape(MAX_BOARD_SIZE, MAX_BOARD_SIZE), symmetry).reshape(-1)
                        ownership_weight = transform_spatial(ownership_weight.reshape(MAX_BOARD_SIZE, MAX_BOARD_SIZE), symmetry).reshape(-1)
                        status = transform_spatial(status.reshape(MAX_BOARD_SIZE, MAX_BOARD_SIZE), symmetry).reshape(-1)
                        status_weight = transform_spatial(status_weight.reshape(MAX_BOARD_SIZE, MAX_BOARD_SIZE), symmetry).reshape(-1)
                        territory = transform_spatial(territory.reshape(MAX_BOARD_SIZE, MAX_BOARD_SIZE), symmetry).reshape(-1)
                        territory_weight = transform_spatial(territory_weight.reshape(MAX_BOARD_SIZE, MAX_BOARD_SIZE), symmetry).reshape(-1)
                    yield {
                        "features": features, "policy": policy,
                        "value": torch.tensor(float(arrays["values"][index]), dtype=torch.float32),
                        "score": torch.tensor(float(arrays["scores"][index]), dtype=torch.float32),
                        "ownership": ownership, "ownership_weight": ownership_weight,
                        "status": status, "status_weight": status_weight,
                        "territory": territory, "territory_weight": territory_weight,
                        "board_size": torch.tensor(int(arrays["board_sizes"][index]), dtype=torch.int64),
                        "position_kind": torch.tensor(int(arrays["position_kinds"][index]), dtype=torch.int64),
                    }
