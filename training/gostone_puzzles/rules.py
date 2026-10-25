from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache


@lru_cache(maxsize=20)
def neighbors(size: int) -> tuple[tuple[int, ...], ...]:
    return tuple(tuple(q for q in (p-1 if p % size else -1,
                                  p+1 if p % size < size-1 else -1,
                                  p-size, p+size) if 0 <= q < size*size)
                 for p in range(size*size))


def group(stones: tuple[int, ...], size: int, point: int) -> tuple[frozenset[int], frozenset[int]]:
    color = stones[point]
    if not color:
        return frozenset(), frozenset()
    found, liberties, stack = {point}, set(), [point]
    adjacency = neighbors(size)
    while stack:
        for other in adjacency[stack.pop()]:
            if not stones[other]:
                liberties.add(other)
            elif stones[other] == color and other not in found:
                found.add(other)
                stack.append(other)
    return frozenset(found), frozenset(liberties)


def static_placement_allowed(stones, size, point, color):
    """Construction of AB/AW diagrams never silently captures setup stones."""
    if stones[point] or color not in (1,2):
        return False
    board = list(stones)
    board[point] = color
    board = tuple(board)
    if not group(board,size,point)[1]:
        return False
    checked = set()
    for other in neighbors(size)[point]:
        if board[other] == 3-color and other not in checked:
            chain,liberties = group(board,size,other)
            checked.update(chain)
            if not liberties:
                return False
    return True


@dataclass(frozen=True)
class State:
    size: int
    stones: tuple[int, ...]
    to_play: int
    targets: frozenset[int]
    history: frozenset[bytes]
    passes: int = 0

    @classmethod
    def setup(cls, size: int, board, to_play: int, targets=()):
        if not 2 <= size <= 19 or len(board) != size*size or to_play not in (1, 2):
            raise ValueError("Invalid board dimensions or player")
        if any(type(v) is not int or v not in (0, 1, 2) for v in board):
            raise ValueError("Invalid stone color")
        stones = tuple(board)
        checked = set()
        for point, color in enumerate(stones):
            if color and point not in checked:
                chain, liberties = group(stones, size, point)
                if not liberties:
                    raise ValueError("Initial group has no liberty")
                checked.update(chain)
        if any(type(p) is not int or not 0 <= p < size*size or not stones[p] for p in targets):
            raise ValueError("Target must mark an existing stone")
        return cls(size, stones, to_play, frozenset(targets), frozenset((bytes(stones),)))

    def play(self, move: int) -> State:
        if move == -1:
            return State(self.size, self.stones, 3-self.to_play, self.targets, self.history, self.passes+1)
        if type(move) is not int or not 0 <= move < len(self.stones) or self.stones[move]:
            raise ValueError("Illegal or occupied move")
        board, removed, checked = list(self.stones), set(), set()
        board[move] = self.to_play
        for other in neighbors(self.size)[move]:
            if board[other] == 3-self.to_play and other not in checked:
                chain, liberties = group(tuple(board), self.size, other)
                checked.update(chain)
                if not liberties:
                    removed.update(chain)
                    for p in chain:
                        board[p] = 0
        result = tuple(board)
        if not group(result, self.size, move)[1]:
            raise ValueError("Suicide")
        key = bytes(result)
        if key in self.history:
            raise ValueError("Positional superko")
        return State(self.size, result, 3-self.to_play, self.targets - removed,
                     self.history | {key}, 0)

    def legal(self):
        for point, color in enumerate(self.stones):
            if not color:
                try:
                    yield point, self.play(point)
                except ValueError:
                    pass
        yield -1, self.play(-1)


@lru_cache(maxsize=12000)
def unconditional_life(stones: tuple[int, ...], size: int, color: int) -> frozenset[int]:
    """Conservative Benson fixed point over empty, single-color bounded regions.

    A vital region must consist entirely of liberties of a block. Shared or
    opponent-contaminated empty regions cannot create a spurious eye.
    """
    blocks, checked = [], set()
    for p, c in enumerate(stones):
        if c == color and p not in checked:
            chain, libs = group(stones, size, p)
            blocks.append((chain, libs))
            checked.update(chain)
    owner = {p: i for i, (chain, _) in enumerate(blocks) for p in chain}
    # A vital region is a subset of the liberties of at least one block.
    # The open outside usually is not; reject it as soon as one of its cells
    # cannot be a liberty of any friendly block. This is a sufficient rejection,
    # never an assumption that outside moves are irrelevant to the game.
    candidates = set().union(*(libs for _, libs in blocks)) if blocks else set()
    regions, visited = [], set()
    for p in sorted(candidates):
        if p in visited:
            continue
        empty, boundary, stack = {p}, set(), [p]
        visited.add(p)
        possible = True
        while stack and possible:
            for q in neighbors(size)[stack.pop()]:
                if stones[q]:
                    if stones[q] != color:
                        possible = False
                        break
                    boundary.add(q)
                elif q not in empty:
                    if q not in candidates:
                        possible = False
                        break
                    empty.add(q)
                    stack.append(q)
        visited.update(empty)
        if possible and boundary and any(empty <= libs for _, libs in blocks):
            regions.append((frozenset(empty), frozenset(owner[q] for q in boundary)))
    alive = set(range(len(blocks)))
    while True:
        bounded = [region for region, boundary in regions if boundary <= alive]
        surviving = {i for i in alive if sum(region <= blocks[i][1] for region in bounded) >= 2}
        if surviving == alive:
            return frozenset(p for i in alive for p in blocks[i][0])
        alive = surviving


def terminal(state: State, goal: str, player: int) -> int | None:
    if not state.targets:
        return 1 if goal == "kill" else -1
    target_color = 3-player if goal == "kill" else player
    if state.targets & unconditional_life(state.stones, state.size, target_color):
        return -1 if goal == "kill" else 1
    return None
