from __future__ import annotations

import os
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


if __name__ == "__main__":
    unittest.main()
