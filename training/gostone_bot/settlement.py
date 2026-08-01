from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Iterable

import numpy as np

from .board import MAX_BOARD_SIZE, board_offset
from .generate import JAPANESE_KOMI


@dataclass(frozen=True)
class GroupProposal:
    color: str
    stones: tuple[tuple[int, int], ...]
    status: str
    survival: float


@dataclass(frozen=True)
class JapaneseScoreProposal:
    black_territory: int
    white_territory: int
    dame: int
    neutral_by_agreement: int
    black_prisoners: int
    white_prisoners: int
    black_total: float
    white_total: float
    winner: str
    margin: float

    def as_dict(self) -> dict[str, int | float | str]:
        return asdict(self)


@dataclass(frozen=True)
class SettlementProposal:
    groups: tuple[GroupProposal, ...]
    dead_stones: tuple[tuple[int, int], ...]
    uncertain_stones: tuple[tuple[int, int], ...]
    neutral_region_seeds: tuple[tuple[int, int], ...]
    score: JapaneseScoreProposal


def _neighbors(size: int, x: int, y: int):
    if x > 0:
        yield x - 1, y
    if x + 1 < size:
        yield x + 1, y
    if y > 0:
        yield x, y - 1
    if y + 1 < size:
        yield x, y + 1


def _groups(board: np.ndarray) -> list[tuple[int, tuple[tuple[int, int], ...]]]:
    size = int(board.shape[0])
    visited: set[tuple[int, int]] = set()
    result: list[tuple[int, tuple[tuple[int, int], ...]]] = []
    for y in range(size):
        for x in range(size):
            color = int(board[y, x])
            if color == 0 or (x, y) in visited:
                continue
            group: list[tuple[int, int]] = []
            stack = [(x, y)]
            visited.add((x, y))
            while stack:
                point = stack.pop()
                group.append(point)
                for neighbor in _neighbors(size, *point):
                    nx, ny = neighbor
                    if neighbor not in visited and int(board[ny, nx]) == color:
                        visited.add(neighbor)
                        stack.append(neighbor)
            result.append((color, tuple(sorted(group))))
    return result


def _territory_map(
    board: np.ndarray,
    neutral_seeds: set[tuple[int, int]],
) -> tuple[dict[tuple[int, int], int], int, int, int, int]:
    size = int(board.shape[0])
    owners: dict[tuple[int, int], int] = {}
    visited: set[tuple[int, int]] = set()
    black = white = dame = neutral = 0
    for y in range(size):
        for x in range(size):
            if int(board[y, x]) != 0 or (x, y) in visited:
                continue
            region: list[tuple[int, int]] = []
            borders: set[int] = set()
            stack = [(x, y)]
            visited.add((x, y))
            while stack:
                point = stack.pop()
                region.append(point)
                for nx, ny in _neighbors(size, *point):
                    stone = int(board[ny, nx])
                    if stone:
                        borders.add(stone)
                    elif (nx, ny) not in visited:
                        visited.add((nx, ny))
                        stack.append((nx, ny))
            natural_owner = next(iter(borders)) if len(borders) == 1 else 0
            excluded = any(point in neutral_seeds for point in region)
            owner = 0 if excluded else natural_owner
            for point in region:
                owners[point] = owner
            if excluded:
                neutral += len(region)
            elif owner == 1:
                black += len(region)
            elif owner == -1:
                white += len(region)
            else:
                dame += len(region)
    return owners, black, white, dame, neutral


def score_japanese(
    board: np.ndarray,
    *,
    captured_white_by_black: int,
    captured_black_by_white: int,
    dead_stones: Iterable[tuple[int, int]],
    neutral_region_seeds: Iterable[tuple[int, int]],
    komi: float = JAPANESE_KOMI,
) -> JapaneseScoreProposal:
    if board.shape not in ((9, 9), (13, 13), (19, 19)):
        raise ValueError("Japanese scoring requires a 9x9, 13x13, or 19x19 board")
    if captured_white_by_black < 0 or captured_black_by_white < 0:
        raise ValueError("Prisoner counts cannot be negative")
    original = board.astype(np.int8, copy=True)
    dead = set(dead_stones)
    group_by_point = {
        point: set(stones)
        for _, stones in _groups(original)
        for point in stones
    }
    for point in dead:
        x, y = point
        if not (0 <= x < len(board) and 0 <= y < len(board)) or original[y, x] == 0:
            raise ValueError("Dead-stone proposal contains an invalid point")
        if not group_by_point[point].issubset(dead):
            raise ValueError("Dead-stone proposal must contain complete connected groups")
    scored = original.copy()
    for x, y in dead:
        scored[y, x] = 0
    neutral = set(neutral_region_seeds)
    owners, black_territory, white_territory, dame, excluded = _territory_map(scored, neutral)
    dead_black = dead_white = 0
    for x, y in dead:
        color = int(original[y, x])
        if owners.get((x, y), 0) != -color:
            raise ValueError("A proposed dead group is not inside opponent territory")
        if color == 1:
            dead_black += 1
        else:
            dead_white += 1
    black_prisoners = captured_white_by_black + dead_white
    white_prisoners = captured_black_by_white + dead_black
    black_total = float(black_territory + black_prisoners)
    white_total = float(white_territory + white_prisoners + komi)
    if black_total == white_total:
        winner = "jigo"
        margin = 0.0
    elif black_total > white_total:
        winner = "black"
        margin = black_total - white_total
    else:
        winner = "white"
        margin = white_total - black_total
    return JapaneseScoreProposal(
        black_territory,
        white_territory,
        dame,
        excluded,
        black_prisoners,
        white_prisoners,
        black_total,
        white_total,
        winner,
        margin,
    )


def _active_map(values: np.ndarray, size: int) -> np.ndarray:
    flattened = np.asarray(values, dtype=np.float32).reshape(-1)
    if flattened.size == size * size:
        return flattened.reshape(size, size)
    if flattened.size != MAX_BOARD_SIZE * MAX_BOARD_SIZE:
        raise ValueError("Settlement output has an invalid spatial size")
    offset = board_offset(size)
    return flattened.reshape(MAX_BOARD_SIZE, MAX_BOARD_SIZE)[
        offset : offset + size,
        offset : offset + size,
    ]


def propose_settlement(
    board: np.ndarray,
    *,
    survival_logits: np.ndarray,
    ownership: np.ndarray,
    captured_white_by_black: int,
    captured_black_by_white: int,
    komi: float = JAPANESE_KOMI,
    dead_threshold: float = 0.25,
    alive_threshold: float = 0.75,
) -> SettlementProposal:
    size = int(board.shape[0])
    survival = 1.0 / (1.0 + np.exp(-np.clip(_active_map(survival_logits, size), -30, 30)))
    ownership_map = _active_map(ownership, size)
    groups: list[GroupProposal] = []
    candidate_dead: set[tuple[int, int]] = set()
    uncertain: set[tuple[int, int]] = set()
    for color, stones in _groups(board):
        probability = float(np.mean([survival[y, x] for x, y in stones]))
        if probability <= dead_threshold:
            status = "dead"
            candidate_dead.update(stones)
        elif probability >= alive_threshold:
            status = "alive"
        else:
            status = "uncertain"
            uncertain.update(stones)
        groups.append(GroupProposal("black" if color == 1 else "white", stones, status, probability))

    # Only keep dead groups that become opponent territory. Ambiguous captures
    # are deliberately returned as uncertain rather than forcing a bad score.
    changed = True
    while changed and candidate_dead:
        changed = False
        scored = board.copy()
        for x, y in candidate_dead:
            scored[y, x] = 0
        owners, *_ = _territory_map(scored, set())
        for color, stones in _groups(board):
            if not set(stones).issubset(candidate_dead):
                continue
            if any(owners.get(point, 0) != -color for point in stones):
                candidate_dead.difference_update(stones)
                uncertain.update(stones)
                changed = True

    scored = board.copy()
    for x, y in candidate_dead:
        scored[y, x] = 0
    _, _, _, _, _ = _territory_map(scored, set())
    neutral_seeds: list[tuple[int, int]] = []
    visited: set[tuple[int, int]] = set()
    for y in range(size):
        for x in range(size):
            if scored[y, x] != 0 or (x, y) in visited:
                continue
            region: list[tuple[int, int]] = []
            borders: set[int] = set()
            stack = [(x, y)]
            visited.add((x, y))
            while stack:
                point = stack.pop()
                region.append(point)
                for nx, ny in _neighbors(size, *point):
                    stone = int(scored[ny, nx])
                    if stone:
                        borders.add(stone)
                    elif (nx, ny) not in visited:
                        visited.add((nx, ny))
                        stack.append((nx, ny))
            if len(borders) == 1:
                confidence = float(np.mean([abs(ownership_map[py, px]) for px, py in region]))
                if confidence < 0.35:
                    neutral_seeds.append(region[0])

    score = score_japanese(
        board,
        captured_white_by_black=captured_white_by_black,
        captured_black_by_white=captured_black_by_white,
        dead_stones=candidate_dead,
        neutral_region_seeds=neutral_seeds,
        komi=komi,
    )
    normalized_groups = tuple(
        GroupProposal(
            group.color,
            group.stones,
            "uncertain" if set(group.stones).intersection(uncertain) else group.status,
            group.survival,
        )
        for group in groups
    )
    return SettlementProposal(
        normalized_groups,
        tuple(sorted(candidate_dead)),
        tuple(sorted(uncertain)),
        tuple(sorted(neutral_seeds)),
        score,
    )
