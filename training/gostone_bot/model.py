from __future__ import annotations

from dataclasses import asdict, dataclass
from os import PathLike
from typing import Any

import torch
from torch import Tensor, nn
from torch.nn import functional as F

from .board import FEATURE_PLANES, MAX_BOARD_SIZE, STRENGTH_PLANE

ARCHITECTURE_VERSION = 5
SCORE_BINS = 41
STATUS_CLASSES = 4  # alive, dead, seki, unsettled
TERRITORY_CLASSES = 3  # black, white, neutral/dame


@dataclass(frozen=True)
class StudentConfig:
    architecture_version: int = ARCHITECTURE_VERSION
    channels: int = 128
    blocks: int = 10
    global_pool_blocks: tuple[int, ...] = (3, 7)
    input_planes: int = FEATURE_PLANES
    board_size: int = MAX_BOARD_SIZE

    def as_dict(self) -> dict[str, Any]:
        value = asdict(self)
        value["global_pool_blocks"] = list(self.global_pool_blocks)
        return value


@dataclass(frozen=True)
class LegacyStudentConfig:
    channels: int = 96
    blocks: int = 10
    input_planes: int = 12
    board_size: int = MAX_BOARD_SIZE


def _group_count(channels: int) -> int:
    for groups in (16, 8, 4, 2):
        if channels % groups == 0:
            return groups
    return 1


class ResidualBlock(nn.Module):
    def __init__(self, channels: int):
        super().__init__()
        groups = _group_count(channels)
        self.norm1 = nn.GroupNorm(groups, channels)
        self.conv1 = nn.Conv2d(channels, channels, 3, padding=1, bias=False)
        self.norm2 = nn.GroupNorm(groups, channels)
        self.conv2 = nn.Conv2d(channels, channels, 3, padding=1, bias=False)

    def forward(self, inputs: Tensor, mask: Tensor) -> Tensor:
        hidden = self.conv1(F.silu(self.norm1(inputs))) * mask
        hidden = self.conv2(F.silu(self.norm2(hidden))) * mask
        return (inputs + hidden) * mask


class GlobalPoolResidualBlock(nn.Module):
    """Compact KataGo-style block that communicates across the whole board."""

    def __init__(self, channels: int):
        super().__init__()
        groups = _group_count(channels)
        pooled_channels = max(16, channels // 4)
        self.norm1 = nn.GroupNorm(groups, channels)
        self.local = nn.Conv2d(channels, channels, 3, padding=1, bias=False)
        self.pool = nn.Conv2d(channels, pooled_channels, 1, bias=False)
        self.broadcast = nn.Linear(pooled_channels * 2, channels)
        self.norm2 = nn.GroupNorm(groups, channels)
        self.output = nn.Conv2d(channels, channels, 3, padding=1, bias=False)

    def forward(self, inputs: Tensor, mask: Tensor) -> Tensor:
        activated = F.silu(self.norm1(inputs)) * mask
        local = self.local(activated)
        pooled_map = self.pool(activated)
        count = mask.sum(dim=(2, 3)).clamp_min(1.0)
        mean = (pooled_map * mask).sum(dim=(2, 3)) / count
        masked = pooled_map.masked_fill(mask <= 0, torch.finfo(pooled_map.dtype).min)
        maximum = masked.amax(dim=(2, 3))
        global_bias = self.broadcast(torch.cat((mean, maximum), dim=1))[:, :, None, None]
        hidden = self.output(F.silu(self.norm2(local + global_bias))) * mask
        return (inputs + hidden) * mask


class GoStoneStudent(nn.Module):
    """V5 network for playing, score forecasting, and settlement proposals."""

    def __init__(self, config: StudentConfig = StudentConfig()):
        super().__init__()
        if config.architecture_version != ARCHITECTURE_VERSION:
            raise ValueError(f"Unsupported GoStone architecture v{config.architecture_version}")
        self.config = config
        # Strength is removed from the shared trunk. Final scoring must not
        # change when a different nominal bot strength is requested.
        trunk_planes = config.input_planes - 1
        groups = _group_count(config.channels)
        self.stem = nn.Sequential(
            nn.Conv2d(trunk_planes, config.channels, 5, padding=2, bias=False),
            nn.GroupNorm(groups, config.channels),
            nn.SiLU(),
        )
        global_indices = set(config.global_pool_blocks)
        self.blocks = nn.ModuleList(
            GlobalPoolResidualBlock(config.channels) if index in global_indices else ResidualBlock(config.channels)
            for index in range(config.blocks)
        )
        self.policy_style = nn.Sequential(nn.Linear(1, 32), nn.SiLU(), nn.Linear(32, config.channels * 2))
        self.policy_rank = nn.Sequential(nn.Linear(1, 32), nn.SiLU())
        self.policy_board = nn.Conv2d(config.channels, 1, 1)
        self.policy_pass = nn.Linear(config.channels + 32, 1)
        self.value_head = nn.Sequential(
            nn.Linear(config.channels, config.channels), nn.SiLU(), nn.Linear(config.channels, 1), nn.Tanh()
        )
        self.score_distribution = nn.Sequential(
            nn.Linear(config.channels, config.channels), nn.SiLU(), nn.Linear(config.channels, SCORE_BINS)
        )
        self.ownership_head = nn.Conv2d(config.channels, 1, 1)
        self.territory_head = nn.Conv2d(config.channels, TERRITORY_CLASSES, 1)
        self.status_head = nn.Conv2d(config.channels, STATUS_CLASSES, 1)
        self.register_buffer("score_bin_values", torch.linspace(-1.0, 1.0, SCORE_BINS), persistent=False)

    @staticmethod
    def _masked_average(hidden: Tensor, mask: Tensor) -> Tensor:
        return (hidden * mask).sum(dim=(2, 3)) / mask.sum(dim=(2, 3)).clamp_min(1.0)

    def forward(
        self, features: Tensor
    ) -> tuple[Tensor, Tensor, Tensor, Tensor, Tensor, Tensor, Tensor, Tensor, Tensor]:
        mask = features[:, 4:5]
        strength = (features[:, STRENGTH_PLANE : STRENGTH_PLANE + 1] * mask).sum(dim=(2, 3))
        strength = strength / mask.sum(dim=(2, 3)).clamp_min(1.0)
        trunk_features = torch.cat(
            (features[:, :STRENGTH_PLANE], features[:, STRENGTH_PLANE + 1 :]), dim=1
        )
        hidden = self.stem(trunk_features) * mask
        for block in self.blocks:
            hidden = block(hidden, mask)
        pooled = self._masked_average(hidden, mask)

        style = self.policy_style(strength)
        scale, bias = style.chunk(2, dim=1)
        styled = hidden * (1.0 + 0.15 * torch.tanh(scale)[:, :, None, None])
        styled = (styled + 0.15 * bias[:, :, None, None]) * mask
        board_logits = self.policy_board(styled).flatten(1)
        legal_mask = mask.flatten(1) > 0
        board_logits = board_logits.masked_fill(~legal_mask, -10_000.0)
        pass_logit = self.policy_pass(torch.cat((pooled, self.policy_rank(strength)), dim=1))
        policy_logits = torch.cat((board_logits, pass_logit), dim=1)

        value = self.value_head(pooled).squeeze(1)
        score_logits = self.score_distribution(pooled)
        probabilities = F.softmax(score_logits, dim=1)
        score = (probabilities * self.score_bin_values).sum(dim=1)
        variance = (probabilities * (self.score_bin_values[None, :] - score[:, None]).square()).sum(dim=1)
        score_stdev = variance.clamp_min(1e-6).sqrt()
        ownership = torch.tanh(self.ownership_head(hidden)).flatten(1) * mask.flatten(1)
        territory_logits = self.territory_head(hidden).flatten(2)
        status_logits = self.status_head(hidden).flatten(2)
        survival_logits = status_logits[:, 0] + status_logits[:, 2] - status_logits[:, 1]
        survival_logits = survival_logits.masked_fill(~legal_mask, 0.0)
        return (
            policy_logits, value, score, ownership, survival_logits,
            score_stdev, territory_logits, status_logits, score_logits,
        )

    @property
    def parameter_count(self) -> int:
        return sum(parameter.numel() for parameter in self.parameters())


class LegacyResidualBlock(nn.Module):
    def __init__(self, channels: int):
        super().__init__()
        self.conv1 = nn.Conv2d(channels, channels, 3, padding=1, bias=False)
        self.norm1 = nn.BatchNorm2d(channels)
        self.conv2 = nn.Conv2d(channels, channels, 3, padding=1, bias=False)
        self.norm2 = nn.BatchNorm2d(channels)

    def forward(self, inputs: Tensor, mask: Tensor) -> Tensor:
        hidden = F.relu(self.norm1(self.conv1(inputs)))
        hidden = self.norm2(self.conv2(hidden))
        return F.relu(inputs + hidden) * mask


class LegacyGoStoneStudent(nn.Module):
    """Read-only V1–V4 loader for validation and the comparison arena."""

    def __init__(self, config: LegacyStudentConfig):
        super().__init__()
        self.config = config
        self.stem = nn.Sequential(
            nn.Conv2d(config.input_planes, config.channels, 3, padding=1, bias=False),
            nn.BatchNorm2d(config.channels), nn.ReLU(),
        )
        self.blocks = nn.ModuleList(LegacyResidualBlock(config.channels) for _ in range(config.blocks))
        self.policy_board = nn.Conv2d(config.channels, 1, 1)
        self.policy_pass = nn.Linear(config.channels, 1)
        self.value_head = nn.Sequential(nn.Linear(config.channels, config.channels), nn.ReLU(), nn.Linear(config.channels, 1), nn.Tanh())
        self.score_head = nn.Sequential(nn.Linear(config.channels, config.channels), nn.ReLU(), nn.Linear(config.channels, 1), nn.Tanh())
        self.ownership_head = nn.Conv2d(config.channels, 1, 1)
        self.survival_head = nn.Conv2d(config.channels, 1, 1)

    def forward(self, features: Tensor) -> tuple[Tensor, Tensor, Tensor, Tensor, Tensor]:
        mask = features[:, 4:5]
        hidden = self.stem(features) * mask
        for block in self.blocks:
            hidden = block(hidden, mask)
        pooled = GoStoneStudent._masked_average(hidden, mask)
        board = self.policy_board(hidden).flatten(1).masked_fill(mask.flatten(1) <= 0, -10_000.0)
        return (
            torch.cat((board, self.policy_pass(pooled)), dim=1),
            self.value_head(pooled).squeeze(1), self.score_head(pooled).squeeze(1),
            torch.tanh(self.ownership_head(hidden)).flatten(1) * mask.flatten(1),
            self.survival_head(hidden).flatten(1).masked_fill(mask.flatten(1) <= 0, 0.0),
        )


def load_checkpoint_model(checkpoint: str | bytes | PathLike[str] | dict[str, Any]) -> nn.Module:
    saved = torch.load(checkpoint, map_location="cpu", weights_only=True) if not isinstance(checkpoint, dict) else checkpoint
    raw = saved.get("config")
    state = saved.get("state_dict")
    if not isinstance(raw, dict) or not isinstance(state, dict):
        raise ValueError("The AI checkpoint is incomplete")
    if int(raw.get("architecture_version", 0)) >= ARCHITECTURE_VERSION:
        config = StudentConfig(
            architecture_version=int(raw["architecture_version"]), channels=int(raw["channels"]),
            blocks=int(raw["blocks"]),
            global_pool_blocks=tuple(int(value) for value in raw.get("global_pool_blocks", (3, 7))),
            input_planes=int(raw["input_planes"]), board_size=int(raw["board_size"]),
        )
        model: nn.Module = GoStoneStudent(config)
    else:
        config = LegacyStudentConfig(**{key: int(raw[key]) for key in ("channels", "blocks", "input_planes", "board_size")})
        model = LegacyGoStoneStudent(config)
    model.load_state_dict(state, strict=True)
    model.eval()
    return model
