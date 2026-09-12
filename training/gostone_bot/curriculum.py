from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from .board import BoardState, MAX_BOARD_SIZE, board_offset

ENDGAME = 1 << 0
KO = 1 << 1
ATARI = 1 << 2
FALSE_EYE = 1 << 3
SNAPBACK = 1 << 4
DAME = 1 << 5
SEKI = 1 << 6
DEAD_INVASION = 1 << 7
TERMINAL_WINDOW = 1 << 8

TAG_NAMES = {
    ENDGAME: "endgame",
    KO: "ko",
    ATARI: "atari",
    FALSE_EYE: "false_eye",
    SNAPBACK: "snapback",
    DAME: "dame",
    SEKI: "seki",
    DEAD_INVASION: "dead_invasion",
    TERMINAL_WINDOW: "terminal_window",
}

ALIVE, DEAD, SEKI_STATUS, UNSETTLED = range(4)
BLACK_TERRITORY, WHITE_TERRITORY, NEUTRAL = range(3)


def _neighbors(x: int, y: int, size: int):
    if x > 0: yield x - 1, y
    if x + 1 < size: yield x + 1, y
    if y > 0: yield x, y - 1
    if y + 1 < size: yield x, y + 1


def _empty_regions(stones: np.ndarray):
    size = len(stones)
    unseen = {(x, y) for y in range(size) for x in range(size) if stones[y, x] == 0}
    while unseen:
        start = unseen.pop(); region = {start}; stack = [start]; borders: set[int] = set()
        while stack:
            x, y = stack.pop()
            for nx, ny in _neighbors(x, y, size):
                color = int(stones[ny, nx])
                if color:
                    borders.add(color)
                elif (nx, ny) in unseen:
                    unseen.remove((nx, ny)); region.add((nx, ny)); stack.append((nx, ny))
        yield region, borders


def position_tags(board: BoardState) -> int:
    tags = 0
    if board.move_number >= int(board.size * board.size * 0.45): tags |= ENDGAME
    if board.ko_point is not None: tags |= KO
    groups: list[tuple[set[tuple[int, int]], set[tuple[int, int]], int]] = []
    seen: set[tuple[int, int]] = set()
    for y in range(board.size):
        for x in range(board.size):
            if board.stones[y, x] == 0 or (x, y) in seen: continue
            group, liberties = board._group(x, y); seen.update(group)
            color = int(board.stones[y, x])
            groups.append((group, liberties, color))
            if len(liberties) == 1:
                tags |= ATARI
                liberty = next(iter(liberties))
                lx, ly = liberty
                adjacent_enemy_atari = False
                for nx, ny in _neighbors(lx, ly, board.size):
                    if board.stones[ny, nx] != -board.stones[y, x]: continue
                    enemy, enemy_liberties = board._group(nx, ny)
                    adjacent_enemy_atari |= len(enemy) == 1 and len(enemy_liberties) == 1
                if len(group) == 1 and adjacent_enemy_atari: tags |= SNAPBACK
            if len(group) <= 4 and len(liberties) <= 2:
                opponent_neighbors = sum(
                    board.stones[ny, nx] == -color
                    for gx, gy in group for nx, ny in _neighbors(gx, gy, board.size)
                )
                if opponent_neighbors >= len(group): tags |= DEAD_INVASION
    for region, borders in _empty_regions(board.stones):
        if tags & ENDGAME and borders == {-1, 1} and len(region) <= 8: tags |= DAME
    for y in range(board.size):
        for x in range(board.size):
            if board.stones[y, x] != 0: continue
            adjacent = [int(board.stones[ny, nx]) for nx, ny in _neighbors(x, y, board.size)]
            colors = {color for color in adjacent if color}
            if len(colors) != 1 or not adjacent: continue
            color = next(iter(colors)); opposing_diagonals = 0
            for dx, dy in ((-1, -1), (1, -1), (-1, 1), (1, 1)):
                nx, ny = x + dx, y + dy
                if 0 <= nx < board.size and 0 <= ny < board.size and board.stones[ny, nx] == -color:
                    opposing_diagonals += 1
            edge = x in (0, board.size - 1) or y in (0, board.size - 1)
            if opposing_diagonals >= (1 if edge else 2): tags |= FALSE_EYE
    return tags


@dataclass(frozen=True)
class SettlementLabels:
    status_targets: np.ndarray
    status_weights: np.ndarray
    territory_targets: np.ndarray
    territory_weights: np.ndarray
    tags: int


def settlement_labels(
    board: BoardState,
    ownership_padded: np.ndarray,
    confidence_padded: np.ndarray,
) -> SettlementLabels:
    offset = board_offset(board.size)
    ownership = ownership_padded.reshape(MAX_BOARD_SIZE, MAX_BOARD_SIZE)[offset : offset + board.size, offset : offset + board.size]
    confidence = confidence_padded.reshape(MAX_BOARD_SIZE, MAX_BOARD_SIZE)[offset : offset + board.size, offset : offset + board.size]
    status = np.full((MAX_BOARD_SIZE, MAX_BOARD_SIZE), UNSETTLED, dtype=np.int8)
    status_weight = np.zeros((MAX_BOARD_SIZE, MAX_BOARD_SIZE), dtype=np.float32)
    territory = np.full((MAX_BOARD_SIZE, MAX_BOARD_SIZE), NEUTRAL, dtype=np.int8)
    territory_weight = np.zeros((MAX_BOARD_SIZE, MAX_BOARD_SIZE), dtype=np.float32)
    tags = position_tags(board)

    for y in range(board.size):
        for x in range(board.size):
            if board.stones[y, x] != 0: continue
            py, px = y + offset, x + offset
            strength = float(ownership[y, x]); certainty = float(confidence[y, x])
            if strength <= -0.55: territory[py, px] = BLACK_TERRITORY
            elif strength >= 0.55: territory[py, px] = WHITE_TERRITORY
            else: territory[py, px] = NEUTRAL
            territory_weight[py, px] = certainty if abs(strength) >= 0.35 else certainty * 0.6

    group_records: list[tuple[set[tuple[int, int]], set[tuple[int, int]], int]] = []
    seen: set[tuple[int, int]] = set()
    for y in range(board.size):
        for x in range(board.size):
            if board.stones[y, x] == 0 or (x, y) in seen: continue
            group, liberties = board._group(x, y); seen.update(group)
            color = int(board.stones[y, x]); group_records.append((group, liberties, color))
            agreement = np.mean([(-ownership[gy, gx] if color == 1 else ownership[gy, gx]) for gx, gy in group])
            certainty = float(np.mean([confidence[gy, gx] for gx, gy in group]))
            label = ALIVE if agreement >= 0.55 else DEAD if agreement <= -0.55 else UNSETTLED
            weight = certainty if label != UNSETTLED else certainty * 0.5
            for gx, gy in group:
                status[gy + offset, gx + offset] = label
                status_weight[gy + offset, gx + offset] = weight

    # A conservative seki label: both colors border a compact neutral region and
    # a bordering living group has no liberties outside that shared region.
    for region, borders in _empty_regions(board.stones):
        if borders != {-1, 1} or len(region) > 8:
            continue
        neutral = all(abs(float(ownership[y, x])) < 0.35 for x, y in region)
        if not neutral: continue
        marked = False
        for group, liberties, _ in group_records:
            if len(liberties) >= 2 and liberties.issubset(region):
                for gx, gy in group:
                    status[gy + offset, gx + offset] = SEKI_STATUS
                    status_weight[gy + offset, gx + offset] = max(status_weight[gy + offset, gx + offset], 0.8)
                marked = True
        if marked: tags |= SEKI

    return SettlementLabels(
        status.reshape(-1), status_weight.reshape(-1),
        territory.reshape(-1), territory_weight.reshape(-1), tags,
    )


def tag_names(mask: int) -> list[str]:
    return [name for bit, name in TAG_NAMES.items() if mask & bit]
