from __future__ import annotations

import json
import os
import time
import ctypes
from pathlib import Path
from typing import Any


class StopRequested(Exception):
    def __init__(self, message: str = "Training stop requested"):
        super().__init__(message)
        self.partial_game: Any | None = None


def atomic_json(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def load_json(path: Path, fallback: dict[str, Any] | None = None) -> dict[str, Any]:
    if not path.is_file():
        return dict(fallback or {})
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return dict(fallback or {})
    return value if isinstance(value, dict) else dict(fallback or {})


class RunJournal:
    def __init__(self, run_dir: Path):
        self.run_dir = run_dir
        self.state_path = run_dir / "state.json"
        self.events_path = run_dir / "events.jsonl"
        self.state = load_json(self.state_path)

    def update(self, **changes: Any) -> None:
        self.state.update(changes, updated_at=time.time())
        atomic_json(self.state_path, self.state)

    def event(self, message: str, level: str = "info") -> None:
        entry = {"time": time.time(), "level": level, "message": message}
        self.events_path.parent.mkdir(parents=True, exist_ok=True)
        with self.events_path.open("a", encoding="utf-8") as output:
            output.write(json.dumps(entry, ensure_ascii=False) + "\n")
        self.update(message=message)


class ControlGate:
    def __init__(self, run_dir: Path, journal: RunJournal):
        self.pause_flag = run_dir / "pause.flag"
        self.stop_flag = run_dir / "stop.flag"
        self.journal = journal

    def checkpoint(self) -> None:
        if self.stop_flag.exists():
            raise StopRequested()
        announced = False
        while self.pause_flag.exists():
            if self.stop_flag.exists():
                raise StopRequested()
            if not announced:
                self.journal.update(status="paused", message="Training pausiert – Fortschritt ist gespeichert.")
                announced = True
            time.sleep(1)
        if announced:
            self.journal.update(status="running", message="Training wird fortgesetzt.")


def process_is_alive(pid: int | None) -> bool:
    if not isinstance(pid, int) or pid <= 0:
        return False
    if os.name == "nt":
        process_query_limited_information = 0x1000
        still_active = 259
        handle = ctypes.windll.kernel32.OpenProcess(  # type: ignore[attr-defined]
            process_query_limited_information,
            False,
            pid,
        )
        if not handle:
            return False
        try:
            exit_code = ctypes.c_ulong()
            if not ctypes.windll.kernel32.GetExitCodeProcess(handle, ctypes.byref(exit_code)):  # type: ignore[attr-defined]
                return False
            return exit_code.value == still_active
        finally:
            ctypes.windll.kernel32.CloseHandle(handle)  # type: ignore[attr-defined]
    try:
        os.kill(pid, 0)
    except (OSError, PermissionError):
        return False
    return True
