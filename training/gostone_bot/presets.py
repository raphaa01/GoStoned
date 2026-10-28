from __future__ import annotations

from dataclasses import asdict, dataclass


@dataclass(frozen=True)
class TrainingPreset:
    id: str
    name: str
    description: str
    estimated_duration: str
    quality: str
    games: int
    max_moves: int
    normal_visits: int
    endgame_visits: int
    hard_visits: int
    settlement_samples: int
    epochs: int
    min_epochs: int
    early_stopping_patience: int
    parallel_games: int
    batch_size: int = 64
    channels: int = 128
    blocks: int = 10
    board_sizes: tuple[int, ...] = (9, 13, 19)
    ensure_endgame: bool = False

    def to_public_dict(self) -> dict[str, object]:
        return asdict(self)


PRESETS = {
    preset.id: preset
    for preset in (
        TrainingPreset(
            "smoke", "System Check",
            "Verifies the V5 data contract, all model heads, pause/resume, and ONNX export.",
            "about 3–8 minutes", "Technical validation only — does not create V5",
            games=3, max_moves=6, normal_visits=1, endgame_visits=1, hard_visits=1,
            settlement_samples=1, epochs=1, min_epochs=1, early_stopping_patience=1,
            parallel_games=2, batch_size=8, channels=32, blocks=2,
        ),
        TrainingPreset(
            "short", "Focused V5 Session",
            "A complete split-aware V5 run with targeted settlement positions and a promotion gate.",
            "about 12–30 hours", "Experimental candidate — automatic tests included",
            games=30, max_moves=90, normal_visits=1, endgame_visits=32, hard_visits=64,
            settlement_samples=8, epochs=30, min_epochs=8, early_stopping_patience=5,
            parallel_games=2, ensure_endgame=True,
        ),
        TrainingPreset(
            "overnight", "Extended Training",
            "Twice the fresh games, deeper settlement labels, and more replay optimization.",
            "about 1–3 days", "Strong local candidate — automatic tests included",
            games=60, max_moves=160, normal_visits=1, endgame_visits=64, hard_visits=128,
            settlement_samples=12, epochs=50, min_epochs=12, early_stopping_patience=7,
            parallel_games=3, ensure_endgame=True,
        ),
        TrainingPreset(
            "serious", "Week-long Deep Training",
            "Maximum local curriculum with 256-visit tactical labels and full replay from V5 onward.",
            "about 3–7 days", "Best local candidate under the 15 MiB browser budget",
            games=120, max_moves=260, normal_visits=1, endgame_visits=96, hard_visits=256,
            settlement_samples=16, epochs=80, min_epochs=18, early_stopping_patience=10,
            parallel_games=4, ensure_endgame=True,
        ),
    )
}


def resolve_preset(preset_id: str, cpu_threads: int) -> tuple[TrainingPreset, int]:
    if preset_id not in PRESETS: raise ValueError("Unknown training preset")
    if not isinstance(cpu_threads, int) or not 1 <= cpu_threads <= 10:
        raise ValueError("CPU threads must be between 1 and 10")
    return PRESETS[preset_id], cpu_threads
