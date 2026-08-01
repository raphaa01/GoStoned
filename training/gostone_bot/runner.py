from __future__ import annotations

import argparse
import json
import os
import traceback
from pathlib import Path

import numpy as np

from .download_teacher import download_teacher
from .generate import generate_game_samples, save_game_archive
from .presets import TrainingPreset
from .runtime import ControlGate, RunJournal, StopRequested, load_json
from .teacher import KataGoTeacher
from .train import MAX_MODEL_BYTES, train_student


def _count_positions(data_dir: Path) -> int:
    total = 0
    for path in sorted(data_dir.glob("*.npz")):
        with np.load(path) as archive:
            total += len(archive["features"])
    return total


def _overall(phase: str, phase_progress: float) -> float:
    starts = {"setup": 0.0, "data": 0.03, "training": 0.82, "export": 0.97, "validation": 0.99}
    widths = {"setup": 0.03, "data": 0.79, "training": 0.15, "export": 0.02, "validation": 0.01}
    return min(1.0, starts.get(phase, 0.0) + widths.get(phase, 0.0) * phase_progress)


def run(run_dir: Path) -> None:
    config = load_json(run_dir / "config.json")
    preset_data = config.get("preset")
    if not isinstance(preset_data, dict):
        raise ValueError("Run configuration is missing its preset")
    preset = TrainingPreset(**preset_data)
    cpu_threads = int(config.get("cpu_threads", 6))
    journal = RunJournal(run_dir)
    gate = ControlGate(run_dir, journal)
    data_dir = run_dir / "data"
    artifact_dir = run_dir / "artifact"
    data_dir.mkdir(parents=True, exist_ok=True)
    journal.update(
        status="running",
        pid=os.getpid(),
        phase="setup",
        phase_progress=0.0,
        overall_progress=0.0,
        rules="japanese",
        komi=6.5,
        preset_name=str(config.get("display_name", preset.name)),
        target_games=preset.games,
        completed_games=len(list(data_dir.glob("game-*.npz"))),
        target_epochs=preset.epochs,
        completed_epochs=int(journal.state.get("completed_epochs", 0)),
        model_limit_bytes=MAX_MODEL_BYTES,
        error=None,
        traceback=None,
    )
    try:
        gate.checkpoint()
        journal.event("Verifying the KataGo teacher model.")
        human_model = download_teacher()
        journal.update(phase_progress=1.0, overall_progress=_overall("setup", 1.0))

        existing = sorted(data_dir.glob("game-*.npz"))
        completed_games = len(existing)
        positions = _count_positions(data_dir)
        journal.event(
            f"Dataset generation starts at game {completed_games + 1} of {preset.games}."
            if completed_games < preset.games
            else "The dataset is complete; model training will resume."
        )
        journal.update(phase="data", positions=positions)
        with KataGoTeacher(human_model=human_model) as teacher:
            for game_index in range(completed_games, preset.games):
                current_position = 0

                def on_position(position: int, limit: int, size: int, visits: int) -> None:
                    nonlocal current_position
                    current_position = position
                    game_fraction = position / max(1, limit)
                    data_fraction = (game_index + game_fraction) / preset.games
                    journal.update(
                        status="running",
                        phase="data",
                        phase_progress=data_fraction,
                        overall_progress=_overall("data", data_fraction),
                        current_game=game_index + 1,
                        current_position=position,
                        current_board_size=size,
                        current_visits=visits,
                        positions=positions + position,
                        message=f"KataGo is evaluating {size}×{size} position {position}.",
                    )

                try:
                    game = generate_game_samples(
                        teacher=teacher,
                        game_index=game_index,
                        board_sizes=tuple(preset.board_sizes),
                        normal_visits=preset.normal_visits,
                        endgame_visits=preset.endgame_visits,
                        max_moves=preset.max_moves,
                        seed=int(config.get("seed", 20260801)),
                        ensure_endgame=preset.ensure_endgame,
                        control=gate.checkpoint,
                        on_position=on_position,
                    )
                except StopRequested as error:
                    if error.partial_game is not None and error.partial_game.positions:
                        game = error.partial_game
                        save_game_archive(
                            data_dir / f"game-{game_index:05d}.npz",
                            game,
                            {"game_index": game_index, "partial": True, "moves": game.moves},
                        )
                    raise
                save_game_archive(
                    data_dir / f"game-{game_index:05d}.npz",
                    game,
                    {"game_index": game_index, "partial": False, "moves": game.moves},
                )
                positions += game.positions
                journal.event(
                    f"Game {game_index + 1}/{preset.games} saved: "
                    f"{game.positions} training positions."
                )
                journal.update(completed_games=game_index + 1, positions=positions)

        gate.checkpoint()
        journal.event(f"AI training starts with {positions} positions.")
        base_checkpoint_raw = config.get("base_model_checkpoint")
        base_checkpoint = Path(base_checkpoint_raw) if isinstance(base_checkpoint_raw, str) else None
        if base_checkpoint is not None:
            journal.event(
                f"{config.get('display_name', 'New AI model')} continues learning from "
                f"GoStone AI v{config.get('base_model_version')}."
            )

        def on_epoch(epoch: int, total: int, metrics: dict[str, float]) -> None:
            fraction = epoch / total
            journal.update(
                status="running",
                phase="training",
                phase_progress=fraction,
                overall_progress=_overall("training", fraction),
                completed_epochs=epoch,
                metrics=metrics,
                message=f"Epoch {epoch}/{total} completed.",
            )

        journal.update(phase="training", phase_progress=0.0, overall_progress=_overall("training", 0.0))
        model_path = train_student(
            data=data_dir,
            output_dir=artifact_dir,
            epochs=preset.epochs,
            batch_size=preset.batch_size,
            learning_rate=3e-4,
            channels=preset.channels,
            blocks=preset.blocks,
            cpu_threads=cpu_threads,
            seed=int(config.get("seed", 20260801)),
            initial_checkpoint=base_checkpoint,
            control=gate.checkpoint,
            on_epoch=on_epoch,
            resume=True,
        )
        journal.update(phase="export", phase_progress=1.0, overall_progress=_overall("export", 1.0))
        journal.event("The ONNX model was exported and structurally verified.")
        gate.checkpoint()
        metadata_path = artifact_dir / "gostone-japanese-v1.json"
        metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
        if metadata.get("rules") != "japanese" or model_path.stat().st_size > MAX_MODEL_BYTES:
            raise RuntimeError("Final model did not satisfy the Japanese-rules 8 MiB contract")
        metadata.update(
            display_name=config.get("display_name"),
            model_version=config.get("model_version"),
            training_seed=config.get("seed"),
            base_model_version=config.get("base_model_version"),
        )
        metadata_path.write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")
        journal.update(
            status="completed",
            phase="validation",
            phase_progress=1.0,
            overall_progress=1.0,
            artifact=str(model_path.resolve()),
            artifact_bytes=model_path.stat().st_size,
            metadata=str(metadata_path.resolve()),
            message="Training completed. The AI model and metadata are ready.",
        )
        journal.event("Training completed successfully.")
    except StopRequested:
        journal.update(
            status="stopped",
            pid=None,
            message="Stopped safely. Saved games and epochs are preserved.",
        )
        journal.event("Training stopped safely.", "warning")
    except BaseException as error:
        journal.update(
            status="failed",
            pid=None,
            error=str(error),
            traceback=traceback.format_exc(limit=20),
            message=f"Training failed: {error}",
        )
        journal.event(f"Training failed: {error}", "error")
        raise
    finally:
        if journal.state.get("status") not in ("running", "paused"):
            journal.update(pid=None)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run one resumable GoStone local training session")
    parser.add_argument("--run-dir", type=Path, required=True)
    return parser.parse_args()


if __name__ == "__main__":
    arguments = parse_args()
    run(arguments.run_dir.resolve())
