from __future__ import annotations

import json
import queue
import subprocess
import threading
import time
import uuid
from collections import deque
from pathlib import Path
from typing import Any, Callable

TEACHER_FILENAME = "b18c384nbt-humanv0.bin.gz"
TEACHER_SHA256 = "637746e44f0efe00ad1245a50aa9bbf0716efe364c43965ead97bd6835d84ab5"
TEACHER_URL = (
    "https://github.com/lightvector/KataGo/releases/download/v1.15.0/"
    f"{TEACHER_FILENAME}"
)
DEFAULT_IMAGE = "newproject-katago:latest"
MAX_QUERY_ATTEMPTS = 3


class TeacherRetry(RuntimeError):
    """The shared KataGo process was unhealthy and the query may be retried."""


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
        on_retry: Callable[[str], None] | None = None,
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
        self._command = command
        self._on_retry = on_retry
        self._lifecycle_lock = threading.Lock()
        self._generation = 0
        self._closed = False
        self._stderr_tail: deque[str] = deque(maxlen=80)
        self._pending: dict[str, queue.Queue[dict[str, Any]]] = {}
        self._pending_lock = threading.Lock()
        self._write_lock = threading.Lock()
        self._start_process()

    def _start_process(self) -> None:
        process = subprocess.Popen(
            self._command,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            bufsize=1,
        )
        self._process = process
        threading.Thread(target=self._drain_stderr, args=(process,), daemon=True).start()
        threading.Thread(target=self._drain_stdout, args=(process,), daemon=True).start()

    def _drain_stderr(self, process: subprocess.Popen[str]) -> None:
        assert process.stderr is not None
        for line in process.stderr:
            self._stderr_tail.append(line.rstrip())

    def _drain_stdout(self, process: subprocess.Popen[str]) -> None:
        assert process.stdout is not None
        for line in process.stdout:
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

    def _submit(self, query: dict[str, Any]) -> tuple[str, queue.Queue[dict[str, Any]], int]:
        with self._lifecycle_lock:
            if self._closed or self._process.poll() is not None:
                details = "\n".join(self._stderr_tail)
                raise TeacherRetry(f"KataGo teacher stopped unexpectedly.\n{details}")
            generation = self._generation
            query_id = str(query["id"])
            response_queue: queue.Queue[dict[str, Any]] = queue.Queue(maxsize=1)
            with self._pending_lock:
                self._pending[query_id] = response_queue
            try:
                assert self._process.stdin is not None
                with self._write_lock:
                    self._process.stdin.write(json.dumps(query, separators=(",", ":")) + "\n")
                    self._process.stdin.flush()
            except BaseException as error:
                with self._pending_lock:
                    self._pending.pop(query_id, None)
                raise TeacherRetry(f"KataGo teacher input failed: {error}") from error
        return query_id, response_queue, generation

    def _receive(
        self,
        query_id: str,
        response_queue: queue.Queue[dict[str, Any]],
        generation: int,
        timeout: float = 600.0,
    ) -> dict[str, Any]:
        deadline = time.monotonic() + timeout
        try:
            while True:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    details = "\n".join(self._stderr_tail)
                    raise TeacherRetry(f"KataGo teacher query exceeded {timeout:.0f} seconds.\n{details}")
                try:
                    result = response_queue.get(timeout=min(1.0, remaining))
                    break
                except queue.Empty:
                    if self._process.poll() is not None:
                        details = "\n".join(self._stderr_tail)
                        raise TeacherRetry(f"KataGo teacher stopped unexpectedly.\n{details}")
        finally:
            with self._pending_lock:
                self._pending.pop(query_id, None)
        if result.get("_teacher_restart"):
            raise TeacherRetry(str(result.get("error", "KataGo teacher restarted")))
        if "error" in result:
            raise RuntimeError(f"KataGo rejected training position: {result['error']}")
        return result

    def _restart(self, expected_generation: int, reason: str) -> None:
        with self._lifecycle_lock:
            if self._closed or self._generation != expected_generation:
                return
            if self._on_retry is not None:
                self._on_retry(reason.splitlines()[0])
            with self._pending_lock:
                pending = list(self._pending.values())
                self._pending.clear()
            for response_queue in pending:
                try:
                    response_queue.put_nowait({"_teacher_restart": True, "error": reason})
                except queue.Full:
                    pass
            process = self._process
            if process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=5)
            self._generation += 1
            self._stderr_tail.clear()
            self._start_process()

    def _run_with_retries(self, requests: list[dict[str, Any]]) -> list[dict[str, Any]]:
        last_error: TeacherRetry | None = None
        for attempt in range(MAX_QUERY_ATTEMPTS):
            adjusted = []
            for request in requests:
                item = dict(request)
                item["visits"] = max(1, int(item["visits"]) // (2 ** attempt))
                adjusted.append(item)
            generation = self._generation
            try:
                submitted = [self._submit(self._query(**request)) for request in adjusted]
                return [self._receive(query_id, response_queue, query_generation) for query_id, response_queue, query_generation in submitted]
            except TeacherRetry as error:
                last_error = error
                self._restart(generation, f"KataGo retry {attempt + 1}/{MAX_QUERY_ATTEMPTS}: {error}")
        assert last_error is not None
        raise RuntimeError(f"KataGo teacher failed after {MAX_QUERY_ATTEMPTS} attempts: {last_error}")

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
        return self._run_with_retries([{
            "moves": moves, "size": size, "komi": komi, "profile": profile,
            "visits": visits, "include_ownership": include_ownership,
        }])[0]

    def analyze_many(self, requests: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """Submit a batch before waiting so KataGo can batch neural evaluations."""
        if not requests:
            return []
        return self._run_with_retries(requests)

    def close(self) -> None:
        with self._lifecycle_lock:
            self._closed = True
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
