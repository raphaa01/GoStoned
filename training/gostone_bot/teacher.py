from __future__ import annotations

import json
import queue
import subprocess
import threading
import time
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
        cpu_threads: int | None = None,
    ) -> None:
        if not human_model.is_file():
            raise FileNotFoundError(
                f"Missing KataGo human teacher model: {human_model}. "
                "Run npm run bot:teacher:download first."
            )
        mount = f"{human_model.resolve()}:/models/human.bin.gz:ro"
        analysis_config = repository_root() / "docker" / "katago" / "analysis.cfg"
        config_mount = f"{analysis_config.resolve()}:/models/analysis.cfg:ro"
        command = [
            "docker",
            "run",
            "--rm",
            "-i",
        ]
        if cpu_threads is not None:
            command.extend(("--cpus", str(max(1, cpu_threads))))
        command.extend([
            "-v",
            mount,
            "-v",
            config_mount,
            "--entrypoint",
            "/opt/katago/katago",
            image,
            "analysis",
            "-model",
            "/opt/katago/model.bin.gz",
            "-human-model",
            "/models/human.bin.gz",
            "-config",
            "/models/analysis.cfg",
        ])
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
        self._pending: dict[str, queue.Queue[dict[str, Any]]] = {}
        self._pending_lock = threading.Lock()
        self._write_lock = threading.Lock()
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
                result = json.loads(line)
            except json.JSONDecodeError:
                continue
            if result.get("isDuringSearch") is True:
                continue
            query_id = result.get("id")
            if not isinstance(query_id, str):
                continue
            with self._pending_lock:
                response_queue = self._pending.get(query_id)
            if response_queue is not None:
                response_queue.put(result)

    def _submit(self, query: dict[str, Any]) -> tuple[str, queue.Queue[dict[str, Any]]]:
        if self._process.poll() is not None:
            details = "\n".join(self._stderr_tail)
            raise RuntimeError(f"KataGo teacher stopped unexpectedly.\n{details}")
        query_id = str(query["id"])
        response_queue: queue.Queue[dict[str, Any]] = queue.Queue(maxsize=1)
        with self._pending_lock:
            self._pending[query_id] = response_queue
        try:
            assert self._process.stdin is not None
            with self._write_lock:
                self._process.stdin.write(json.dumps(query, separators=(",", ":")) + "\n")
                self._process.stdin.flush()
        except BaseException:
            with self._pending_lock:
                self._pending.pop(query_id, None)
            raise
        return query_id, response_queue

    def _receive(
        self,
        query_id: str,
        response_queue: queue.Queue[dict[str, Any]],
        timeout: float = 600.0,
    ) -> dict[str, Any]:
        deadline = time.monotonic() + timeout
        try:
            while True:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    details = "\n".join(self._stderr_tail)
                    raise TimeoutError(f"KataGo teacher query exceeded {timeout:.0f} seconds.\n{details}")
                try:
                    result = response_queue.get(timeout=min(1.0, remaining))
                    break
                except queue.Empty:
                    if self._process.poll() is not None:
                        details = "\n".join(self._stderr_tail)
                        raise RuntimeError(f"KataGo teacher stopped unexpectedly.\n{details}")
        finally:
            with self._pending_lock:
                self._pending.pop(query_id, None)
        if "error" in result:
            raise RuntimeError(f"KataGo rejected training position: {result['error']}")
        return result

    @staticmethod
    def _query(
        *, moves: list[list[str]], size: int, komi: float, profile: str,
        visits: int, include_ownership: bool,
    ) -> dict[str, Any]:
        return {
            "id": f"student:{uuid.uuid4().hex}",
            "moves": moves,
            "rules": "japanese",
            "komi": komi,
            "boardXSize": size,
            "boardYSize": size,
            "analyzeTurns": [len(moves)],
            "maxVisits": max(1, visits),
            "analysisPVLen": 4,
            "includePolicy": True,
            "includeOwnership": include_ownership,
            "includeOwnershipStdev": include_ownership,
            "overrideSettings": {
                "humanSLProfile": profile,
                "ignorePreRootHistory": False,
                "rootNumSymmetriesToSample": 1,
            },
        }

    def analyze(
        self,
        *,
        moves: list[list[str]],
        size: int,
        komi: float,
        profile: str,
        visits: int,
        include_ownership: bool = True,
    ) -> dict[str, Any]:
        query = self._query(
            moves=moves, size=size, komi=komi, profile=profile,
            visits=visits, include_ownership=include_ownership,
        )
        query_id, response_queue = self._submit(query)
        return self._receive(query_id, response_queue)

    def analyze_many(self, requests: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """Submit a batch before waiting so KataGo can batch neural evaluations."""
        submitted: list[tuple[str, queue.Queue[dict[str, Any]]]] = []
        for request in requests:
            query = self._query(**request)
            submitted.append(self._submit(query))
        return [self._receive(query_id, response_queue) for query_id, response_queue in submitted]

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
