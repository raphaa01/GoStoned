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

    def to_public_dict(self) -> dict[str, object]:
        return asdict(self)


PRESETS = {
    preset.id: preset
    for preset in (
        TrainingPreset(
            "smoke",
            "Systemtest",
            "Prüft KataGo, Pause/Fortsetzen, alle Ausgaben und den 8-MB-Export.",
            "ca. 2–5 Minuten",
            "Nur Techniktest – nicht spielstark",
            games=3,
            max_moves=8,
            normal_visits=1,
            endgame_visits=1,
            epochs=1,
            batch_size=8,
        ),
        TrainingPreset(
            "short",
            "Ein paar Stunden",
            "Erster kleiner Lernlauf mit allen Brettgrößen und tieferen Endspielbewertungen.",
            "ca. 2–6 Stunden",
            "Experimentell – noch nicht veröffentlichen",
            games=9,
            max_moves=55,
            normal_visits=1,
            endgame_visits=8,
            epochs=8,
        ),
        TrainingPreset(
            "overnight",
            "Über Nacht",
            "Mehr Rang- und Endspielpositionen für einen ersten lokal testbaren Bot.",
            "ca. 8–20 Stunden",
            "Pilotqualität – Elo noch unkalibriert",
            games=24,
            max_moves=120,
            normal_visits=1,
            endgame_visits=12,
            epochs=18,
        ),
        TrainingPreset(
            "serious",
            "Intensivtraining",
            "Großer CPU-Lauf mit vollständigen 19x19-Endspielen und stärkerer KataGo-Suche.",
            "ca. 3–7 Tage in Etappen",
            "Beste lokale Basis – weiterhin Testpartien erforderlich",
            games=72,
            max_moves=220,
            normal_visits=2,
            endgame_visits=30,
            epochs=30,
        ),
    )
}


def resolve_preset(preset_id: str, cpu_threads: int) -> tuple[TrainingPreset, int]:
    if preset_id not in PRESETS:
        raise ValueError("Unknown training preset")
    if not isinstance(cpu_threads, int) or not 1 <= cpu_threads <= 10:
        raise ValueError("CPU threads must be between 1 and 10")
    return PRESETS[preset_id], cpu_threads
