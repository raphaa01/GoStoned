from __future__ import annotations

from dataclasses import asdict, dataclass
import numpy as np
import torch
from torch import nn
from torch.nn import functional as F

from .common import CATEGORIES


@dataclass
class Config:
    channels: int = 48
    blocks: int = 4
    size: int = 19
    input_planes: int = 12


class Block(nn.Module):
    def __init__(self, channels):
        super().__init__()
        self.layers = nn.Sequential(nn.Conv2d(channels, channels, 3, padding=1),
                                    nn.GroupNorm(4, channels), nn.SiLU(),
                                    nn.Conv2d(channels, channels, 3, padding=1),
                                    nn.GroupNorm(4, channels))

    def forward(self, x):
        return F.silu(x+self.layers(x))


class PuzzleNet(nn.Module):
    """Conditional spatial denoiser, move prior, and human-preference head.

    None of these outputs establishes a game-theoretic outcome.
    """
    def __init__(self, config: Config | None = None):
        super().__init__()
        self.config = config or Config()
        c = self.config.channels
        self.stem = nn.Conv2d(self.config.input_planes, c, 3, padding=1)
        self.blocks = nn.Sequential(*(Block(c) for _ in range(self.config.blocks)))
        self.board = nn.Conv2d(c, 3, 1)
        self.policy = nn.Conv2d(c, 1, 1)
        self.pass_head = nn.Linear(c, 1)
        self.preference = nn.Sequential(nn.Linear(c, c), nn.SiLU(), nn.Linear(c, 1))

    def forward(self, features):
        hidden = self.blocks(F.silu(self.stem(features)))
        pooled = hidden.mean((2, 3))
        return (self.board(hidden), torch.cat((self.policy(hidden).flatten(1), self.pass_head(pooled)), 1),
                self.preference(pooled).squeeze(1))


def encode(board, to_play: int, category: str, visible=None) -> tuple[np.ndarray, np.ndarray]:
    raw = np.asarray(board, dtype=np.int64).reshape(19, 19)
    target = np.where(raw == 0, 0, np.where(raw == to_play, 1, 2))
    visible = np.ones((19, 19), dtype=bool) if visible is None else visible.reshape(19, 19)
    planes = np.zeros((12, 19, 19), dtype=np.float32)
    for value in range(3):
        planes[value] = (target == value) & visible
    planes[3] = visible
    planes[4] = to_play == 1
    planes[5+CATEGORIES.index(category)] = 1
    return planes, target


def load_model(path, device="cpu"):
    # Only tensors and primitive checkpoint metadata; never unpickle custom classes.
    checkpoint = torch.load(path, map_location=device, weights_only=True)
    if checkpoint.get("schema") != "gostone.puzzle-model/1":
        raise ValueError("Unsupported model checkpoint")
    model = PuzzleNet(Config(**checkpoint["config"])).to(device)
    model.load_state_dict(checkpoint["state_dict"])
    model.eval()
    return model, checkpoint


def checkpoint_metadata(model):
    return {"schema": "gostone.puzzle-model/1", "config": asdict(model.config),
            "state_dict": model.state_dict(), "role": "candidate-proposal-only",
            "production_ready": False, "difficulty_calibrated": False}
