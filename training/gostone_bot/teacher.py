from __future__ import annotations

import json
import queue
import subprocess
import threading
import uuid
from collections import deque
from pathlib import Path
from typing import Any

TEACHER_FILENAME = "b18c384nbt-humanv0.bin.gz"
TEACHER_SHA256 = "637746e44f0efe00ad1245a50aa9bbf0716efe364c43965ead97bd6835d84ab5"
TEACHER_URL = (
    "https://github.com/lightvector/KataGo/releases/download/v1.15.0/"
    f"{TEACHER_FILENAME}"
)
DEFAULT_IMAGE = "newproject-katago:latest"


def repository_root() -> Path:
    return Path(__file__).resolve().parents[2]


def default_cache_dir() -> Path:
    return repository_root() / ".cache" / "gostone-bot-training"


class KataGoTeacher:
    def __init__(
        self,
        human_model: Path,
        image: str = DEFAULT_IMAGE,
    ) -> None:
        if not human_model.is_file():
            raise FileNotFoundError(
                f"Missing KataGo human teacher model: {human_model}. "
                "Run npm run bot:teacher:download first."
            )
        mount = f"{human_model.resolve()}:/models/human.bin.gz:ro"
        command = [
            "docker",
            "run",
            "--rm",
            "-i",
            "-v",
            mount,
            "--entrypoint",
            "/opt/katago/katago",
            image,
            "analysis",
            "-model",
            "/opt/katago/model.bin.gz",
            "-human-model",
            "/models/human.bin.gz",
            "-config",
            "/opt/katago/analysis.cfg",
        ]
        self._process = subprocess.Popen(
            command,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            bufsize=1,
        )
        self._stderr_tail: deque[str] = deque(maxlen=80)
        self._responses: queue.Queue[dict[str, Any]] = queue.Queue()
        threading.Thread(target=self._drain_stderr, daemon=True).start()
        threading.Thread(target=self._drain_stdout, daemon=True).start()

    def _drain_stderr(self) -> None:
        assert self._process.stderr is not None
        for line in self._process.stderr:
            self._stderr_tail.append(line.rstrip())

    def _drain_stdout(self) -> None:
        assert self._process.stdout is not None
        for line in self._process.stdout:
            try:
                self._responses.put(json.loads(line))
            except json.JSONDecodeError:
                continue

    def analyze(
        self,
        *,
        moves: list[list[str]],
        size: int,
        komi: float,
        profile: str,
        visits: int,
    ) -> dict[str, Any]:
        if self._process.poll() is not None:
            details = "\n".join(self._stderr_tail)
            raise RuntimeError(f"KataGo teacher stopped unexpectedly.\n{details}")
        query_id = f"student:{uuid.uuid4().hex}"
        query = {
            "id": query_id,
            "moves": moves,
            "rules": "chinese",
            "komi": komi,
            "boardXSize": size,
            "boardYSize": size,
            "analyzeTurns": [len(moves)],
            "maxVisits": max(1, visits),
            "analysisPVLen": 4,
            "includePolicy": True,
            "overrideSettings": {
                "humanSLProfile": profile,
                "ignorePreRootHistory": False,
                "rootNumSymmetriesToSample": 1,
            },
        }
        assert self._process.stdin is not None
        self._process.stdin.write(json.dumps(query, separators=(",", ":")) + "\n")
        self._process.stdin.flush()
        while True:
            try:
                result = self._responses.get(timeout=180)
            except queue.Empty as error:
                details = "\n".join(self._stderr_tail)
                raise TimeoutError(f"KataGo teacher query exceeded 180 seconds.\n{details}") from error
            if result.get("id") != query_id or result.get("isDuringSearch") is True:
                continue
            if "error" in result:
                raise RuntimeError(f"KataGo rejected training position: {result['error']}")
            return result

    def close(self) -> None:
        if self._process.poll() is not None:
            return
        if self._process.stdin is not None:
            self._process.stdin.close()
        try:
            self._process.wait(timeout=15)
        except subprocess.TimeoutExpired:
            self._process.terminate()
            try:
                self._process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self._process.kill()
                self._process.wait(timeout=5)

    def __enter__(self) -> "KataGoTeacher":
        return self

    def __exit__(self, *_: object) -> None:
        self.close()
