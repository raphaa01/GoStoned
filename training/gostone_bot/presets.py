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
    epochs: int
    batch_size: int = 64
    channels: int = 96
    blocks: int = 10
    board_sizes: tuple[int, ...] = (9, 13, 19)
    ensure_endgame: bool = False

    def to_public_dict(self) -> dict[str, object]:
        return asdict(self)


PRESETS = {
    preset.id: preset
    for preset in (
        TrainingPreset(
            "smoke",
            "System Check",
            "Verifies KataGo, pause/resume, every model head, and the 8 MiB export.",
            "about 2–5 minutes",
            "Technical validation only — not playing strength",
            games=3,
            max_moves=8,
            normal_visits=1,
            endgame_visits=1,
            epochs=1,
            batch_size=8,
        ),
        TrainingPreset(
            "short",
            "Focused Session",
            "First compact learning run across every board size with deeper endgame labels.",
            "about 4–12 hours",
            "Experimental — do not publish yet",
            games=18,
            max_moves=55,
            normal_visits=1,
            endgame_visits=8,
            epochs=8,
            ensure_endgame=True,
        ),
        TrainingPreset(
            "overnight",
            "Overnight",
            "More rank and endgame positions for a locally testable AI model.",
            "about 8–20 hours",
            "Pilot quality — Elo is not calibrated yet",
            games=24,
            max_moves=120,
            normal_visits=1,
            endgame_visits=12,
            epochs=18,
            ensure_endgame=True,
        ),
        TrainingPreset(
            "serious",
            "Deep Training",
            "Large CPU run with complete 19×19 endgames and stronger KataGo searches.",
            "about 3–7 days in stages",
            "Best local foundation — match testing is still required",
            games=72,
            max_moves=220,
            normal_visits=2,
            endgame_visits=30,
            epochs=30,
            ensure_endgame=True,
        ),
    )
}


def resolve_preset(preset_id: str, cpu_threads: int) -> tuple[TrainingPreset, int]:
    if preset_id not in PRESETS:
        raise ValueError("Unknown training preset")
    if not isinstance(cpu_threads, int) or not 1 <= cpu_threads <= 10:
        raise ValueError("CPU threads must be between 1 and 10")
    return PRESETS[preset_id], cpu_threads
