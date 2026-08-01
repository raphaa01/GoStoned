from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path

from .control_center import RunManager, STATIC_DIR
from .runtime import RunJournal, process_is_alive


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


if __name__ == "__main__":
    unittest.main()
