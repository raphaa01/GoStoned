from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import threading
import time
import webbrowser
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

from .arena import ArenaService
from .presets import PRESETS, resolve_preset
from .runtime import RunJournal, atomic_json, load_json, process_is_alive
from .teacher import default_cache_dir, repository_root

HOST = "127.0.0.1"
DEFAULT_PORT = 4173
ACTIVE_STATUSES = {"starting", "running", "paused", "stopping"}
STATIC_DIR = Path(__file__).with_name("control_center_static")


class RunManager:
    def __init__(self, root: Path):
        self.root = root
        self.runs_dir = root / "runs"
        self.current_path = root / "current.json"
        self._lock = threading.RLock()

    def _current_dir(self) -> Path | None:
        current = load_json(self.current_path)
        raw = current.get("run_dir")
        if not isinstance(raw, str):
            return None
        path = Path(raw)
        return path if path.is_dir() else None

    def _launch(self, run_dir: Path) -> int:
        command = [
            sys.executable,
            "-m",
            "training.gostone_bot.runner",
            "--run-dir",
            str(run_dir),
        ]
        environment = os.environ.copy()
        environment["PYTHONUNBUFFERED"] = "1"
        creation_flags = 0
        start_new_session = os.name != "nt"
        if os.name == "nt":
            creation_flags = (
                getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
                | getattr(subprocess, "CREATE_NO_WINDOW", 0)
            )
        process = subprocess.Popen(
            command,
            cwd=repository_root(),
            env=environment,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            creationflags=creation_flags,
            start_new_session=start_new_session,
        )
        journal = RunJournal(run_dir)
        journal.update(status="starting", pid=process.pid, message="Trainingsprozess startet.")
        return process.pid

    def status(self) -> dict[str, object]:
        with self._lock:
            run_dir = self._current_dir()
            if run_dir is None:
                return {
                    "status": "idle",
                    "phase": "idle",
                    "overall_progress": 0.0,
                    "message": "Bereit für ein neues lokales Training.",
                }
            state = load_json(run_dir / "state.json", {"status": "idle"})
            pid = state.get("pid")
            if state.get("status") in ACTIVE_STATUSES and not process_is_alive(pid if isinstance(pid, int) else None):
                journal = RunJournal(run_dir)
                journal.update(
                    status="failed",
                    pid=None,
                    message="Der Trainingsprozess wurde unerwartet beendet. Fortsetzen ist möglich.",
                )
                state = journal.state
            if (run_dir / "stop.flag").exists() and state.get("status") in ACTIVE_STATUSES:
                state = {
                    **state,
                    "status": "stopping",
                    "message": "Sicherer Stopp angefordert; aktueller Arbeitsschritt wird gespeichert.",
                }
            elif (run_dir / "pause.flag").exists() and state.get("status") in {"running", "starting"}:
                state = {
                    **state,
                    "message": "Pause angefordert; aktuelle KataGo-Abfrage wird beendet.",
                }
            return {**state, "run_dir": str(run_dir.resolve())}

    def start(self, preset_id: str, cpu_threads: int) -> dict[str, object]:
        with self._lock:
            current = self.status()
            if current.get("status") in ACTIVE_STATUSES:
                raise RuntimeError("Es läuft bereits ein Training.")
            preset, threads = resolve_preset(preset_id, cpu_threads)
            run_id = time.strftime("%Y%m%d-%H%M%S") + f"-{preset.id}"
            run_dir = self.runs_dir / run_id
            suffix = 1
            while run_dir.exists():
                run_dir = self.runs_dir / f"{run_id}-{suffix}"
                suffix += 1
            run_dir.mkdir(parents=True)
            atomic_json(
                run_dir / "config.json",
                {
                    "preset": preset.to_public_dict(),
                    "cpu_threads": threads,
                    "seed": 20260801,
                    "created_at": time.time(),
                    "rules": "japanese",
                    "model_limit_bytes": 8 * 1024 * 1024,
                },
            )
            journal = RunJournal(run_dir)
            journal.update(
                status="starting",
                phase="setup",
                phase_progress=0.0,
                overall_progress=0.0,
                preset_id=preset.id,
                preset_name=preset.name,
                cpu_threads=threads,
                message="Lokales Training wird vorbereitet.",
                started_at=time.time(),
            )
            atomic_json(self.current_path, {"run_dir": str(run_dir.resolve())})
            self._launch(run_dir)
            return self.status()

    def pause(self) -> dict[str, object]:
        with self._lock:
            run_dir = self._current_dir()
            state = self.status()
            if run_dir is None or state.get("status") not in {"running", "starting"}:
                raise RuntimeError("Nur ein laufendes Training kann pausiert werden.")
            (run_dir / "pause.flag").touch()
            return self.status()

    def resume(self) -> dict[str, object]:
        with self._lock:
            run_dir = self._current_dir()
            if run_dir is None:
                raise RuntimeError("Es gibt keinen Trainingslauf zum Fortsetzen.")
            state = self.status()
            (run_dir / "pause.flag").unlink(missing_ok=True)
            if state.get("status") in {"stopped", "failed"}:
                (run_dir / "stop.flag").unlink(missing_ok=True)
                self._launch(run_dir)
            elif state.get("status") != "paused":
                raise RuntimeError("Dieser Trainingslauf kann gerade nicht fortgesetzt werden.")
            return self.status()

    def stop(self) -> dict[str, object]:
        with self._lock:
            run_dir = self._current_dir()
            state = self.status()
            if run_dir is None or state.get("status") not in ACTIVE_STATUSES:
                raise RuntimeError("Es läuft kein Training, das gestoppt werden kann.")
            (run_dir / "stop.flag").touch()
            return self.status()

    def logs(self, limit: int = 200) -> list[dict[str, object]]:
        run_dir = self._current_dir()
        if run_dir is None:
            return []
        path = run_dir / "events.jsonl"
        if not path.is_file():
            return []
        lines = path.read_text(encoding="utf-8", errors="replace").splitlines()[-max(1, min(limit, 500)) :]
        result: list[dict[str, object]] = []
        for line in lines:
            try:
                value = json.loads(line)
            except json.JSONDecodeError:
                continue
            if isinstance(value, dict):
                result.append(value)
        return result


class ControlHandler(BaseHTTPRequestHandler):
    server_version = "GoStoneTraining/1"

    @property
    def manager(self) -> RunManager:
        return self.server.manager  # type: ignore[attr-defined]

    @property
    def arena(self) -> ArenaService:
        return self.server.arena  # type: ignore[attr-defined]

    def log_message(self, format: str, *args: object) -> None:
        return

    def _json(self, value: object, status: HTTPStatus = HTTPStatus.OK) -> None:
        body = json.dumps(value, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(body)

    def _static(self, name: str, content_type: str) -> None:
        path = STATIC_DIR / name
        if not path.is_file():
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        body = path.read_bytes()
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header(
            "Content-Security-Policy",
            "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'",
        )
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        path = urlparse(self.path).path
        if path in ("/", "/index.html"):
            self._static("index.html", "text/html; charset=utf-8")
        elif path == "/styles.css":
            self._static("styles.css", "text/css; charset=utf-8")
        elif path == "/app.js":
            self._static("app.js", "text/javascript; charset=utf-8")
        elif path == "/api/status":
            self._json(self.manager.status())
        elif path == "/api/presets":
            self._json([preset.to_public_dict() for preset in PRESETS.values()])
        elif path == "/api/logs":
            self._json(self.manager.logs())
        elif path == "/api/arena/models":
            self._json(self.arena.models())
        else:
            self.send_error(HTTPStatus.NOT_FOUND)

    def _read_json(self) -> dict[str, object]:
        if self.headers.get("Content-Type", "").split(";", 1)[0].strip().lower() != "application/json":
            raise ValueError("Anfrage muss JSON verwenden.")
        length = int(self.headers.get("Content-Length", "0"))
        if length < 0 or length > 4096:
            raise ValueError("Anfrage ist zu groß.")
        value = json.loads(self.rfile.read(length) or b"{}")
        if not isinstance(value, dict):
            raise ValueError("Ungültige Anfrage.")
        return value

    def do_POST(self) -> None:
        path = urlparse(self.path).path
        try:
            body = self._read_json()
            if path == "/api/start":
                allowed = {"preset_id", "cpu_threads"}
                if set(body) != allowed:
                    raise ValueError("Startparameter sind unvollständig oder unbekannt.")
                result = self.manager.start(str(body["preset_id"]), int(body["cpu_threads"]))
            elif path == "/api/pause":
                if body:
                    raise ValueError("Pause akzeptiert keine Parameter.")
                result = self.manager.pause()
            elif path == "/api/resume":
                if body:
                    raise ValueError("Fortsetzen akzeptiert keine Parameter.")
                result = self.manager.resume()
            elif path == "/api/stop":
                if body:
                    raise ValueError("Stop akzeptiert keine Parameter.")
                result = self.manager.stop()
            elif path == "/api/arena/start":
                if set(body) != {"model_id", "board_size", "elo", "human_color"}:
                    raise ValueError("Arena-Startparameter sind unvollständig oder unbekannt.")
                result = self.arena.start(
                    str(body["model_id"]),
                    int(body["board_size"]),
                    int(body["elo"]),
                    str(body["human_color"]),
                )
            elif path == "/api/arena/move":
                if set(body) not in ({"session_id", "x", "y"}, {"session_id", "pass"}):
                    raise ValueError("Arena-Zugparameter sind unvollständig oder unbekannt.")
                if "pass" in body:
                    if body["pass"] is not True:
                        raise ValueError("Pass muss ausdrücklich bestätigt werden.")
                    move = "pass"
                    result = self.arena.move(str(body["session_id"]), move)
                else:
                    result = self.arena.move_point(
                        str(body["session_id"]),
                        int(body["x"]),
                        int(body["y"]),
                    )
            else:
                self.send_error(HTTPStatus.NOT_FOUND)
                return
            self._json(result)
        except (TypeError, ValueError, RuntimeError, json.JSONDecodeError) as error:
            self._json({"ok": False, "error": str(error)}, HTTPStatus.BAD_REQUEST)


class ControlServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, address: tuple[str, int], manager: RunManager):
        super().__init__(address, ControlHandler)
        self.manager = manager
        self.arena = ArenaService(manager.runs_dir)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Start the local GoStone Training Lab")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--no-browser", action="store_true")
    return parser.parse_args()


if __name__ == "__main__":
    arguments = parse_args()
    manager = RunManager(default_cache_dir() / "control-center")
    server = ControlServer((HOST, arguments.port), manager)
    url = f"http://{HOST}:{arguments.port}"
    print(f"GoStone Training Lab läuft auf {url}")
    print("Dieses Fenster kann minimiert werden. Mit Strg+C wird nur die Bedienseite beendet.")
    if not arguments.no_browser:
        threading.Timer(0.6, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever(poll_interval=0.5)
    except KeyboardInterrupt:
        print("\nTraining Lab wurde geschlossen. Ein laufender Trainingsprozess arbeitet weiter.")
    finally:
        server.server_close()
