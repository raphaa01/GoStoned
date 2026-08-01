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
        self.assertIn("calc(100dvh - 306px)", styles)
        self.assertIn("orientation: landscape", styles)
        self.assertIn('classList.toggle("arena-view-active"', script)
        self.assertIn('const showBlockingOverlay = busy && arenaMode === "human";', script)
        self.assertIn('$("#arena-busy").hidden = !showBlockingOverlay;', script)
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
