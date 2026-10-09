from __future__ import annotations

import os
import json
import tempfile
import threading
import unittest
from pathlib import Path

from .control_center import RunManager, STATIC_DIR
from .runtime import RunJournal, atomic_json, load_json, process_is_alive


class ControlCenterTests(unittest.TestCase):
    def test_an_older_stopped_run_can_be_selected_after_a_smoke_test(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            serious = root / "runs" / "serious"
            smoke = root / "runs" / "smoke"
            serious.mkdir(parents=True)
            smoke.mkdir(parents=True)
            atomic_json(serious / "state.json", {"status": "stopped", "positions": 8465})
            atomic_json(serious / "config.json", {"preset": {"id": "serious", "games": 72, "epochs": 30}})
            atomic_json(smoke / "state.json", {"status": "completed"})
            atomic_json(smoke / "config.json", {"preset": {"id": "smoke", "games": 3, "epochs": 1}})
            atomic_json(root / "current.json", {"run_dir": str(smoke.resolve())})
            manager = RunManager(root)

            selected = manager.select("serious")

            self.assertEqual(selected["status"], "stopped")
            self.assertEqual(selected["positions"], 8465)
            runs = {run["id"]: run for run in manager.runs()}
            self.assertTrue(runs["serious"]["selected"])
            self.assertTrue(runs["serious"]["resumable"])

    def test_quality_rejected_run_adds_epochs_and_keeps_its_checkpoint(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            run_dir = root / "runs" / "candidate"
            run_dir.mkdir(parents=True)
            atomic_json(
                run_dir / "config.json",
                {"preset": {"id": "serious", "epochs": 20}, "adaptive_loss_weights": {"survival": 0.6}},
            )
            atomic_json(run_dir / "state.json", {"status": "quality_rejected"})
            atomic_json(root / "current.json", {"run_dir": str(run_dir.resolve())})
            manager = RunManager(root)

            def fake_launch(path: Path) -> int:
                self.assertEqual(path, run_dir)
                RunJournal(path).update(status="running", pid=os.getpid())
                return os.getpid()

            manager._launch = fake_launch  # type: ignore[method-assign]
            resumed = manager.resume()

            self.assertEqual(resumed["status"], "running")
            config = load_json(run_dir / "config.json")
            self.assertEqual(config["preset"]["epochs"], 25)
            self.assertEqual(config["adaptive_loss_weights"]["survival"], 0.6)

    def test_start_pause_resume_and_stop_are_file_backed(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            manager = RunManager(Path(temporary))

            def fake_launch(run_dir: Path) -> int:
                RunJournal(run_dir).update(status="running", pid=os.getpid())
                return os.getpid()

            manager._launch = fake_launch  # type: ignore[method-assign]
            started = manager.start("smoke", 4)
            self.assertEqual(started["status"], "running")
            run_dir = Path(str(started["run_dir"]))
            manager.pause()
            self.assertTrue((run_dir / "pause.flag").exists())
            RunJournal(run_dir).update(status="paused", pid=os.getpid())
            manager.resume()
            self.assertFalse((run_dir / "pause.flag").exists())
            RunJournal(run_dir).update(status="running", pid=os.getpid())
            manager.stop()
            self.assertTrue((run_dir / "stop.flag").exists())

    def test_static_control_center_is_self_contained(self) -> None:
        for name in ("index.html", "styles.css", "app.js"):
            content = (STATIC_DIR / name).read_text(encoding="utf-8")
            self.assertNotIn("https://", content)
            self.assertNotIn("http://", content)

    def test_ai_arena_is_english_compact_and_has_selectable_scoring(self) -> None:
        html = (STATIC_DIR / "index.html").read_text(encoding="utf-8")
        styles = (STATIC_DIR / "styles.css").read_text(encoding="utf-8")
        script = (STATIC_DIR / "app.js").read_text(encoding="utf-8")

        self.assertIn('<html lang="en">', html)
        self.assertIn("AI vs AI", html)
        self.assertIn('id="arena-settlement-evaluator"', html)
        self.assertNotIn("Bot", html)
        self.assertIn(".arena-view-active", styles)
        self.assertIn("height: 100dvh", styles)
        self.assertIn("calc(100dvh - 374px)", styles)
        self.assertIn("orientation: landscape", styles)
        self.assertIn("orientation: portrait) and (max-height: 520px)", styles)
        self.assertIn("orientation: landscape) and (max-height: 260px)", styles)
        self.assertIn("overscroll-behavior-y: contain", styles)
        self.assertIn("grid-template-rows: auto auto", styles)
        self.assertIn('classList.toggle("arena-view-active"', script)
        self.assertIn('const showBlockingOverlay = busy && arenaMode === "human";', script)
        self.assertIn('$("#arena-busy").hidden = !showBlockingOverlay;', script)
        self.assertIn('const activeModelMatch = arenaMode === "match"', script)
        self.assertNotIn('`${turn} computing`', script)
        self.assertIn("settlement_evaluator:", script)

    def test_current_process_is_detected_without_signaling_it(self) -> None:
        self.assertTrue(process_is_alive(os.getpid()))

    def test_parallel_atomic_writers_do_not_share_a_temporary_file(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "state.json"
            errors: list[Exception] = []

            def writer(number: int) -> None:
                try:
                    for sequence in range(30):
                        atomic_json(path, {"writer": number, "sequence": sequence})
                except Exception as error:  # pragma: no cover - assertion captures unexpected failure
                    errors.append(error)

            threads = [threading.Thread(target=writer, args=(number,)) for number in range(3)]
            for thread in threads:
                thread.start()
            for thread in threads:
                thread.join()
            self.assertEqual(errors, [])
            self.assertIn(load_json(path)["writer"], {0, 1, 2})

    def test_journal_reloads_external_progress_before_merging(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            run_dir = Path(directory)
            journal = RunJournal(run_dir)
            journal.update(status="starting", positions=0)
            atomic_json(run_dir / "state.json", {"status": "running", "positions": 42})
            journal.update(message="weiter")
            state = load_json(run_dir / "state.json")
            self.assertEqual(state["positions"], 42)
            self.assertEqual(state["message"], "weiter")

    def test_real_run_gets_next_version_fresh_seed_and_latest_base(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            prior = root / "runs" / "prior"
            artifact = prior / "artifact"
            artifact.mkdir(parents=True)
            (artifact / "gostone-japanese-v1.pt").write_bytes(b"checkpoint")
            (artifact / "gostone-japanese-v1.onnx").write_bytes(b"onnx")
            (artifact / "gostone-japanese-v1.json").write_text(
                json.dumps({"rules": "japanese", "komi": 6.5}), encoding="utf-8"
            )
            atomic_json(
                prior / "config.json",
                {"created_at": 1, "preset": {"id": "short"}, "model_version": 4},
            )
            manager = RunManager(root)

            def fake_launch(run_dir: Path) -> int:
                RunJournal(run_dir).update(status="running", pid=os.getpid())
                return os.getpid()

            manager._launch = fake_launch  # type: ignore[method-assign]
            started = manager.start("short", 4)
            config = load_json(Path(str(started["run_dir"])) / "config.json")
            self.assertEqual(config["model_version"], 5)
            self.assertEqual(config["base_model_version"], 4)
            self.assertEqual(config["base_model_checkpoint"], str((artifact / "gostone-japanese-v1.pt").resolve()))
            self.assertNotEqual(config["seed"], 20260801)
            self.assertEqual(started["preset_name"], "GoStone AI v5")


if __name__ == "__main__":
    unittest.main()
