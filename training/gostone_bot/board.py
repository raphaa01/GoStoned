from __future__ import annotations

from dataclasses import dataclass, field
from typing import Iterable

import numpy as np

MAX_BOARD_SIZE = 19
PASS_INDEX = MAX_BOARD_SIZE * MAX_BOARD_SIZE
STRENGTH_PLANE = 7
FEATURE_PLANES = 23
GTP_COLUMNS = "ABCDEFGHJKLMNOPQRST"


def board_offset(size: int) -> int:
    if size not in (9, 13, 19):
        raise ValueError(f"Unsupported board size: {size}")
    return (MAX_BOARD_SIZE - size) // 2


def gtp_to_point(move: str, size: int) -> tuple[int, int] | None:
    if move.lower() == "pass":
        return None
    if len(move) < 2:
        raise ValueError(f"Invalid GTP move: {move}")
    column = move[0].upper()
    if column not in GTP_COLUMNS[:size]:
        raise ValueError(f"Invalid GTP column for {size}x{size}: {move}")
    row_number = int(move[1:])
    if row_number < 1 or row_number > size:
        raise ValueError(f"Invalid GTP row for {size}x{size}: {move}")
    return GTP_COLUMNS.index(column), size - row_number


def point_to_gtp(x: int, y: int, size: int) -> str:
    if not (0 <= x < size and 0 <= y < size):
        raise ValueError(f"Point is outside {size}x{size}: {(x, y)}")
    return f"{GTP_COLUMNS[x]}{size - y}"


def policy_to_padded(policy: Iterable[float], size: int) -> np.ndarray:
    source = np.asarray(list(policy), dtype=np.float32)
    if source.shape != (size * size + 1,):
        raise ValueError(f"Expected {size * size + 1} policy entries, got {source.shape}")
    result = np.zeros(PASS_INDEX + 1, dtype=np.float32)
    offset = board_offset(size)
    for y in range(size):
        for x in range(size):
            value = source[y * size + x]
            if value > 0:
                result[(y + offset) * MAX_BOARD_SIZE + x + offset] = value
    result[PASS_INDEX] = max(0.0, float(source[-1]))
    total = float(result.sum())
    if total <= 0:
        raise ValueError("Teacher policy contains no legal probability mass")
    return result / total


def spatial_to_padded(values: Iterable[float], size: int, fill: float = 0.0) -> np.ndarray:
    source = np.asarray(list(values), dtype=np.float32)
    if source.shape != (size * size,):
        raise ValueError(f"Expected {size * size} spatial entries, got {source.shape}")
    result = np.full(PASS_INDEX, fill, dtype=np.float32)
    offset = board_offset(size)
    for y in range(size):
        start = (y + offset) * MAX_BOARD_SIZE + offset
        result[start : start + size] = source[y * size : (y + 1) * size]
    return result


def padded_policy_index(move: str, size: int) -> int:
    point = gtp_to_point(move, size)
    if point is None:
        return PASS_INDEX
    offset = board_offset(size)
    x, y = point
    return (y + offset) * MAX_BOARD_SIZE + x + offset


@dataclass
class BoardState:
    size: int
    stones: np.ndarray = field(init=False)
    to_move: int = 1
    move_number: int = 0
    consecutive_passes: int = 0
    captured_white_by_black: int = 0
    captured_black_by_white: int = 0
    last_move: tuple[int, int] | None = None
    ko_point: tuple[int, int] | None = None
    previous_stones: list[np.ndarray] = field(default_factory=list)

    def __post_init__(self) -> None:
        board_offset(self.size)
        self.stones = np.zeros((self.size, self.size), dtype=np.int8)

    def _neighbors(self, x: int, y: int):
        if x > 0: yield x - 1, y
        if x + 1 < self.size: yield x + 1, y
        if y > 0: yield x, y - 1
        if y + 1 < self.size: yield x, y + 1

    def _group(self, x: int, y: int) -> tuple[set[tuple[int, int]], set[tuple[int, int]]]:
        color = int(self.stones[y, x])
        if color == 0:
            return set(), set()
        group = {(x, y)}
        liberties: set[tuple[int, int]] = set()
        stack = [(x, y)]
        while stack:
            current_x, current_y = stack.pop()
            for neighbor_x, neighbor_y in self._neighbors(current_x, current_y):
                neighbor = int(self.stones[neighbor_y, neighbor_x])
                if neighbor == 0:
                    liberties.add((neighbor_x, neighbor_y))
                elif neighbor == color and (neighbor_x, neighbor_y) not in group:
                    group.add((neighbor_x, neighbor_y)); stack.append((neighbor_x, neighbor_y))
        return group, liberties

    def play(self, move: str) -> None:
        point = gtp_to_point(move, self.size)
        before = self.stones.copy()
        if point is None:
            self.previous_stones = ([before] + self.previous_stones)[:2]
            self.consecutive_passes += 1; self.move_number += 1
            self.last_move = None; self.ko_point = None; self.to_move *= -1
            return
        x, y = point
        if self.ko_point == point:
            raise ValueError(f"Move violates simple ko: {move}")
        if self.stones[y, x] != 0:
            raise ValueError(f"Teacher returned an occupied move: {move}")
        self.stones[y, x] = self.to_move
        captured_points: list[tuple[int, int]] = []
        checked: set[tuple[int, int]] = set()
        for neighbor_x, neighbor_y in self._neighbors(x, y):
            if self.stones[neighbor_y, neighbor_x] != -self.to_move or (neighbor_x, neighbor_y) in checked:
                continue
            group, liberties = self._group(neighbor_x, neighbor_y); checked.update(group)
            if not liberties:
                captured_points.extend(group)
                for group_x, group_y in group: self.stones[group_y, group_x] = 0
        own_group, own_liberties = self._group(x, y)
        if not own_liberties and not captured_points:
            self.stones[:, :] = before
            raise ValueError(f"Teacher returned a suicide move: {move}")
        if self.to_move == 1: self.captured_white_by_black += len(captured_points)
        else: self.captured_black_by_white += len(captured_points)
        self.ko_point = captured_points[0] if len(captured_points) == 1 and len(own_group) == 1 and len(own_liberties) == 1 else None
        self.previous_stones = ([before] + self.previous_stones)[:2]
        self.consecutive_passes = 0; self.move_number += 1; self.last_move = (x, y); self.to_move *= -1

    def features(self, strength: float, komi: float) -> np.ndarray:
        if not 0.0 <= strength <= 1.0:
            raise ValueError("strength must be between 0 and 1")
        features = np.zeros((FEATURE_PLANES, MAX_BOARD_SIZE, MAX_BOARD_SIZE), dtype=np.float32)
        offset = board_offset(self.size); area = np.s_[offset : offset + self.size, offset : offset + self.size]
        features[0][area] = self.stones == 1; features[1][area] = self.stones == -1
        features[2][area] = float(self.to_move == 1); features[3][area] = float(self.to_move == -1)
        features[4][area] = 1.0; features[5][area] = np.clip(komi / 20.0, -1.0, 1.0)
        features[6][area] = min(1.0, self.move_number / max(1, self.size * self.size))
        features[STRENGTH_PLANE][area] = strength
        board_area = self.size * self.size
        features[8][area] = min(1.0, self.captured_white_by_black / board_area)
        features[9][area] = min(1.0, self.captured_black_by_white / board_area)
        features[10][area] = min(1.0, self.consecutive_passes / 2.0)
        if self.last_move is not None:
            x, y = self.last_move; features[11, y + offset, x + offset] = 1.0
        if self.ko_point is not None:
            x, y = self.ko_point; features[12, y + offset, x + offset] = 1.0
        seen: set[tuple[int, int]] = set()
        for y in range(self.size):
            for x in range(self.size):
                if self.stones[y, x] == 0 or (x, y) in seen: continue
                group, liberties = self._group(x, y); seen.update(group)
                color_offset = 0 if self.stones[y, x] == 1 else 1
                liberty_bucket = 0 if len(liberties) == 1 else 1 if len(liberties) == 2 else 2
                for group_x, group_y in group:
                    features[13 + liberty_bucket * 2 + color_offset, group_y + offset, group_x + offset] = 1.0
        for history_index, previous in enumerate(self.previous_stones[:2]):
            features[19 + history_index * 2][area] = previous == 1
            features[20 + history_index * 2][area] = previous == -1
        return features
