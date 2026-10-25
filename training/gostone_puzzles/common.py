from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import tempfile
from contextlib import contextmanager

ROOT = Path(__file__).resolve().parent
CATEGORIES = ("life", "kill", "ko", "semeai", "connect", "oiotoshi", "cut", "tesuji")


def default_root() -> Path:
    override = os.environ.get("GOSTONE_PUZZLE_HOME")
    if override:
        return Path(override).resolve()
    return (Path(os.environ.get("LOCALAPPDATA", str(Path.home() / ".local/share")))
            / "GoStone" / "PuzzleAI")


def digest(value) -> str:
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def read_json(path: Path, fallback=None):
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else fallback


def atomic_json(path: Path, value) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    handle, name = tempfile.mkstemp(prefix=".write-", suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(handle, "w", encoding="utf-8") as stream:
            json.dump(value, stream, ensure_ascii=False, indent=2, allow_nan=False)
            stream.write("\n")
        os.replace(name, path)
    finally:
        Path(name).unlink(missing_ok=True)


def records(root: Path) -> list[dict]:
    path = root / "data/corpus.json"
    data = read_json(path, {"records": []})
    return data["records"]


def transform_point(point: int, size: int, symmetry: int) -> int:
    x, y = point % size, point // size
    if symmetry >= 4:
        x = size - 1 - x
    for _ in range(symmetry % 4):
        x, y = size - 1 - y, x
    return y * size + x


def canonical(board: list[int] | tuple[int, ...], size: int, to_play: int) -> str:
    """Full-board symmetry and color normalized. Never invent a new board edge."""
    variants = []
    for sym in range(8):
        result = [0] * len(board)
        for point, color in enumerate(board):
            result[transform_point(point, size, sym)] = 0 if not color else 1 if color == to_play else 2
        variants.append(bytes(result))
    return hashlib.sha256(min(variants)).hexdigest()


def relative_pattern(points: list[tuple[int, int]], colors: list[int], ordered=True) -> str:
    """Translation/symmetry normalized move footprint, retaining move order and roles."""
    if not points:
        return ""
    variants = []
    for sym in range(8):
        transformed = []
        for x, y in points:
            if sym >= 4:
                x = -x
            for _ in range(sym % 4):
                x, y = -y, x
            transformed.append((x, y))
        left, top = min(x for x, _ in transformed), min(y for _, y in transformed)
        entries = tuple((x-left, y-top, c) for (x, y), c in zip(transformed, colors))
        variants.append(entries if ordered else tuple(sorted(entries)))
    return digest(min(variants))


def tactical_core(board, targets, player, radius=2):
    points = [p for p, c in enumerate(board) if c and any(
        abs(p % 19-q % 19)+abs(p//19-q//19) <= radius for q in targets)]
    return relative_pattern([(p % 19, p//19) for p in points],
                            [1 if board[p] == player else 2 for p in points], ordered=False)


def solution_fingerprint(moves, player):
    moves = [move for move in moves if move["move"] >= 0]
    # One normalized point cannot distinguish any one-move tasks. Use board
    # and tactical-core hashes for those, not a universal false duplicate.
    if len(moves) < 3:
        return None
    return relative_pattern([(m["move"] % 19,m["move"]//19) for m in moves],
                            [1 if m["color"] == player else 2 for m in moves])


@contextmanager
def workspace_lock(root: Path):
    """One CLI writer per workspace, including commands started by other UI instances."""
    path=root/"writer.lock"
    root.mkdir(parents=True,exist_ok=True)
    try:
        handle=os.open(path,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600)
    except FileExistsError as error:
        raise ValueError(f"Another job owns {path}. If a process crashed, inspect its PID before removing this lock.") from error
    with os.fdopen(handle,"w",encoding="utf-8") as stream:
        json.dump({"pid":os.getpid(),"purpose":"gostone-puzzle-ai-writer"},stream)
    try:
        yield
    finally:
        path.unlink(missing_ok=True)
