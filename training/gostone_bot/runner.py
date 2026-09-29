from __future__ import annotations

import argparse
import json
import os
import threading
import time
import traceback
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import numpy as np

from .download_teacher import download_teacher
from .data import archive_metadata
from .generate import generate_game_samples, save_game_archive, split_for_game
from .presets import TrainingPreset
from .runtime import ControlGate, RunJournal, StopRequested, load_json
from .teacher import KataGoTeacher
from .train import MAX_MODEL_BYTES, train_student
from .validation import run_promotion_gate


def _count_positions(data_dirs: list[Path]) -> int:
    total = 0; seen: set[Path] = set()
    for data_dir in data_dirs:
        for path in sorted(data_dir.glob("game-*.npz")):
            resolved = path.resolve()
            if resolved in seen: continue
            seen.add(resolved)
            with np.load(path, allow_pickle=False) as archive: total += len(archive["features"])
    return total


def _completed_game_indices(data_dir: Path) -> set[int]:
    completed: set[int] = set()
    for path in data_dir.glob("game-*.npz"):
        with np.load(path, allow_pickle=False) as archive:
            if archive_metadata(archive).get("partial") is True: continue
        completed.add(int(path.stem.split("-")[-1]))
    return completed


def _overall(phase: str, phase_progress: float) -> float:
    starts = {"setup": 0.0, "data": 0.03, "training": 0.73, "export": 0.94, "validation": 0.96}
    widths = {"setup": 0.03, "data": 0.70, "training": 0.21, "export": 0.02, "validation": 0.04}
    return min(1.0, starts.get(phase, 0.0) + widths.get(phase, 0.0) * phase_progress)


def run(run_dir: Path) -> None:
    config = load_json(run_dir / "config.json"); preset_data = config.get("preset")
    if not isinstance(preset_data, dict): raise ValueError("Run configuration is missing its preset")
    preset = TrainingPreset(**preset_data); cpu_threads = int(config.get("cpu_threads", 6))
    journal = RunJournal(run_dir); gate = ControlGate(run_dir, journal)
    data_dir = run_dir / "data"; artifact_dir = run_dir / "artifact"; data_dir.mkdir(parents=True, exist_ok=True)
    replay_dirs = [Path(value) for value in config.get("replay_data_dirs", []) if isinstance(value, str) and Path(value).is_dir()]
    data_paths = [*replay_dirs, data_dir]
    journal.update(
        status="running", pid=os.getpid(), phase="setup", phase_progress=0.0, overall_progress=0.0,
        rules="japanese", komi=6.5, preset_name=str(config.get("display_name", preset.name)),
        target_games=preset.games, completed_games=len(_completed_game_indices(data_dir)),
        target_epochs=preset.epochs, completed_epochs=int(journal.state.get("completed_epochs", 0)),
        model_limit_bytes=MAX_MODEL_BYTES, replay_runs=len(replay_dirs), error=None, traceback=None,
    )
    try:
        gate.checkpoint(); journal.event("Verifying the KataGo teacher model and V5 data contract.")
        human_model = download_teacher(); journal.update(phase_progress=1.0, overall_progress=_overall("setup", 1.0))
        existing_indices = _completed_game_indices(data_dir)
        missing_indices = [index for index in range(preset.games) if index not in existing_indices]
        fresh_positions = _count_positions([data_dir]); replay_positions = _count_positions(replay_dirs)
        parallel_games = min(preset.parallel_games, max(1, cpu_threads // 2))
        journal.event(
            f"Generating {len(missing_indices)} missing game shards with {parallel_games} parallel games; "
            f"{replay_positions} replay positions are available."
        )
        journal.update(phase="data", positions=fresh_positions, replay_positions=replay_positions)
        progress_lock = threading.Lock(); live_positions: dict[int, int] = {}; last_status = [0.0]

        with KataGoTeacher(human_model=human_model, cpu_threads=cpu_threads) as teacher:
            def generate_one(game_index: int):
                def on_position(position: int, limit: int, size: int, visits: int) -> None:
                    with progress_lock:
                        live_positions[game_index] = position
                        now = time.monotonic()
                        if now - last_status[0] < 0.4: return
                        last_status[0] = now
                        completed = len(existing_indices)
                        fraction = (completed + sum(min(1.0, value / max(1, preset.max_moves)) for value in live_positions.values())) / preset.games
                        journal.update(
                            status="running", phase="data", phase_progress=min(1.0, fraction), overall_progress=_overall("data", min(1.0, fraction)),
                            current_game=game_index + 1, current_position=position, current_board_size=size,
                            current_visits=visits, positions=fresh_positions + sum(live_positions.values()),
                            message=f"KataGo is batching {len(live_positions)} games; {size}×{size}, {visits} visits.",
                        )
                try:
                    game = generate_game_samples(
                        teacher=teacher, game_index=game_index, board_sizes=tuple(preset.board_sizes),
                        normal_visits=preset.normal_visits, endgame_visits=preset.endgame_visits,
                        hard_visits=preset.hard_visits, settlement_samples=preset.settlement_samples,
                        max_moves=preset.max_moves, seed=int(config.get("seed", 20260909)),
                        ensure_endgame=preset.ensure_endgame, control=gate.checkpoint, on_position=on_position,
                    )
                    return game_index, game, False
                except StopRequested as error:
                    return game_index, error.partial_game, True

            stop_seen = False
            with ThreadPoolExecutor(max_workers=min(parallel_games, max(1, len(missing_indices)))) as executor:
                futures = [executor.submit(generate_one, index) for index in missing_indices]
                for future in as_completed(futures):
                    game_index, game, partial = future.result()
                    with progress_lock: live_positions.pop(game_index, None)
                    if game is not None and game.positions:
                        save_game_archive(data_dir / f"game-{game_index:05d}.npz", game, {
                            "game_index": game_index, "partial": partial, "moves": game.moves,
                            "split": split_for_game(game_index, len(preset.board_sizes), preset.id == "smoke"),
                            "seed": config.get("seed"), "normal_visits": preset.normal_visits,
                            "settlement_visits": preset.endgame_visits, "hard_visits": preset.hard_visits,
                        })
                        if not partial: existing_indices.add(game_index)
                        fresh_positions = _count_positions([data_dir])
                        journal.event(f"Game {game_index + 1}/{preset.games} saved: {game.positions} positions ({'partial' if partial else 'complete'}).")
                        journal.update(completed_games=len(existing_indices), positions=fresh_positions)
                    stop_seen |= partial
            if stop_seen: raise StopRequested()

        gate.checkpoint(); total_positions = _count_positions(data_paths)
        journal.event(f"AI training starts with {fresh_positions} fresh and {total_positions - fresh_positions} replay positions.")
        base_raw = config.get("base_model_checkpoint"); base_checkpoint = Path(base_raw) if isinstance(base_raw, str) else None
        if base_checkpoint is not None:
            journal.event(f"This version continues from GoStone AI v{config.get('base_model_version')} with full V5+ replay.")

        def on_epoch(epoch: int, total: int, metrics: dict[str, float]) -> None:
            fraction = epoch / total
            journal.update(
                status="running", phase="training", phase_progress=fraction, overall_progress=_overall("training", fraction),
                completed_epochs=epoch, metrics=metrics,
                message=f"Epoch {epoch}/{total}; validation objective and early stopping are active.",
            )

        journal.update(phase="training", phase_progress=0.0, overall_progress=_overall("training", 0.0), total_training_positions=total_positions)
        model_path = train_student(
            data=data_paths, output_dir=artifact_dir, epochs=preset.epochs, batch_size=preset.batch_size,
            learning_rate=3e-4, channels=preset.channels, blocks=preset.blocks,
            min_epochs=preset.min_epochs, early_stopping_patience=preset.early_stopping_patience,
            cpu_threads=cpu_threads, seed=int(config.get("seed", 20260909)), initial_checkpoint=base_checkpoint,
            control=gate.checkpoint, on_epoch=on_epoch, resume=True,
        )
        journal.update(phase="export", phase_progress=1.0, overall_progress=_overall("export", 1.0)); journal.event("ONNX export passed structural and 15 MiB validation.")
        gate.checkpoint(); metadata_path = artifact_dir / "gostone-japanese-v1.json"
        metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
        if metadata.get("rules") != "japanese" or model_path.stat().st_size > MAX_MODEL_BYTES:
            raise RuntimeError("Final model did not satisfy the Japanese-rules 15 MiB contract")

        technical = preset.id == "smoke"; promotion = {"approved": True, "technical_test": True, "reasons": []}
        journal.update(phase="validation", phase_progress=0.0, overall_progress=_overall("validation", 0.0))
        if not technical:
            baseline_raw = config.get("comparison_model_checkpoint")
            baseline = Path(baseline_raw) if isinstance(baseline_raw, str) else None
            journal.event("Running locked test metrics and the color-swapped 9×9/13×13/19×19 arena.")
            with KataGoTeacher(human_model=human_model, cpu_threads=cpu_threads) as teacher:
                promotion = run_promotion_gate(
                    candidate_checkpoint=artifact_dir / "gostone-japanese-v1.pt", baseline_checkpoint=baseline,
                    data_paths=data_paths, seed=int(config.get("seed", 20260909)), batch_size=preset.batch_size,
                    teacher=teacher, arena_visits=min(128, preset.hard_visits), control=gate.checkpoint,
                )
        metadata.update(
            display_name=config.get("display_name"), model_version=config.get("model_version"), training_seed=config.get("seed"),
            base_model_version=config.get("base_model_version"), replay_model_versions=config.get("replay_model_versions", []),
            fresh_positions=fresh_positions, total_training_positions=total_positions, promotion_gate=promotion,
        )
        metadata_path.write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")
        approved = bool(promotion.get("approved"))
        reasons = promotion.get("reasons", [])
        first_reason = str(reasons[0]) if isinstance(reasons, list) and reasons else "quality thresholds were not met"
        message = "Training completed and promotion gate passed." if approved else f"Training completed; Arena access is enabled, but promotion failed: {first_reason}."
        journal.update(
            status="completed", phase="validation", phase_progress=1.0, overall_progress=1.0,
            artifact=str(model_path.resolve()), artifact_bytes=model_path.stat().st_size, metadata=str(metadata_path.resolve()),
            promotion_approved=approved, promotion_reasons=reasons, message=message,
        )
        journal.event(message, "info" if approved else "warning")
    except StopRequested:
        journal.update(status="stopped", pid=None, message="Stopped safely. Saved games and epochs are preserved."); journal.event("Training stopped safely.", "warning")
    except BaseException as error:
        journal.update(status="failed", pid=None, error=str(error), traceback=traceback.format_exc(limit=20), message=f"Training failed: {error}")
        journal.event(f"Training failed: {error}", "error"); raise
    finally:
        if journal.state.get("status") not in ("running", "paused"): journal.update(pid=None)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run one resumable GoStone V5 training session"); parser.add_argument("--run-dir", type=Path, required=True); return parser.parse_args()


if __name__ == "__main__":
    run(parse_args().run_dir.resolve())
