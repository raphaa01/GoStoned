from __future__ import annotations

from dataclasses import asdict, dataclass

import torch
from torch import Tensor, nn
from torch.nn import functional as F

from .board import FEATURE_PLANES, MAX_BOARD_SIZE


@dataclass(frozen=True)
class StudentConfig:
    channels: int = 64
    blocks: int = 10
    input_planes: int = FEATURE_PLANES
    board_size: int = MAX_BOARD_SIZE

    def as_dict(self) -> dict[str, int]:
        return asdict(self)


class ResidualBlock(nn.Module):
    def __init__(self, channels: int):
        super().__init__()
        self.conv1 = nn.Conv2d(channels, channels, kernel_size=3, padding=1, bias=False)
        self.norm1 = nn.BatchNorm2d(channels)
        self.conv2 = nn.Conv2d(channels, channels, kernel_size=3, padding=1, bias=False)
        self.norm2 = nn.BatchNorm2d(channels)

    def forward(self, inputs: Tensor, mask: Tensor) -> Tensor:
        hidden = F.relu(self.norm1(self.conv1(inputs)))
        hidden = self.norm2(self.conv2(hidden))
        return F.relu(inputs + hidden) * mask


class GoStoneStudent(nn.Module):
    """Small rank-conditioned policy/value network for browser inference."""

    def __init__(self, config: StudentConfig = StudentConfig()):
        super().__init__()
        self.config = config
        self.stem = nn.Sequential(
            nn.Conv2d(config.input_planes, config.channels, kernel_size=3, padding=1, bias=False),
            nn.BatchNorm2d(config.channels),
            nn.ReLU(),
        )
        self.blocks = nn.ModuleList(ResidualBlock(config.channels) for _ in range(config.blocks))
        self.policy_board = nn.Conv2d(config.channels, 1, kernel_size=1)
        self.policy_pass = nn.Linear(config.channels, 1)
        self.value_head = nn.Sequential(
            nn.Linear(config.channels, config.channels),
            nn.ReLU(),
            nn.Linear(config.channels, 1),
            nn.Tanh(),
        )

    def _masked_average(self, hidden: Tensor, mask: Tensor) -> Tensor:
        return (hidden * mask).sum(dim=(2, 3)) / mask.sum(dim=(2, 3)).clamp_min(1.0)

    def forward(self, features: Tensor) -> tuple[Tensor, Tensor]:
        mask = features[:, 4:5]
        hidden = self.stem(features) * mask
        for block in self.blocks:
            hidden = block(hidden, mask)
        pooled = self._masked_average(hidden, mask)
        board_logits = self.policy_board(hidden).flatten(1)
        legal_mask = mask.flatten(1) > 0
        board_logits = board_logits.masked_fill(~legal_mask, -10_000.0)
        pass_logit = self.policy_pass(pooled)
        policy_logits = torch.cat((board_logits, pass_logit), dim=1)
        value = self.value_head(pooled).squeeze(1)
        return policy_logits, value

    @property
    def parameter_count(self) -> int:
        return sum(parameter.numel() for parameter in self.parameters())
