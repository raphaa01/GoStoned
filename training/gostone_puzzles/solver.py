from __future__ import annotations

from dataclasses import dataclass
from collections import deque
import hashlib
import time

from .rules import State, group, neighbors, terminal


@dataclass
class Limits:
    own_moves: int = 3
    nodes: int = 100000
    seconds: float = 10.0


class BudgetExceeded(Exception):
    pass


class Solver:
    """Sound, deliberately conservative full-board bounded AND/OR search.

    No crop, synthetic wall, heuristic life, or neural estimate is a terminal.
    A horizon exhaustion is UNKNOWN. This baseline does not implement RZS yet.
    """

    def __init__(self, goal: str, player: int, limits: Limits | None = None, policy=None, deadline=False, seek=None):
        if goal not in ("life", "kill") or player not in (1, 2):
            raise ValueError("Only explicit life/kill goals are currently provable")
        self.goal, self.player, self.limits, self.policy = goal, player, limits or Limits(), policy
        if not 1 <= self.limits.own_moves <= 8 or self.limits.nodes < 1 or self.limits.seconds <= 0:
            raise ValueError("Invalid search limits")
        self.nodes, self.cache, self.proof = 0, {}, {}
        self.deadline = deadline
        if seek not in (None, -1, 1):
            raise ValueError("Invalid requested proof direction")
        self.seek = seek
        self.started = time.monotonic()

    def _key(self, state: State, plies: int) -> str:
        # A binary encoding avoids repeatedly serializing long 19x19 histories
        # as JSON/hex. All rule-relevant fields, including exact superko history,
        # remain part of the transposition key.
        key = hashlib.sha256(b"GoStone full-board state 2\0")
        key.update(bytes((state.size, state.to_play)))
        key.update(plies.to_bytes(4, "big", signed=True))
        key.update(state.passes.to_bytes(4, "big"))
        key.update(bytes(state.stones))
        key.update(bytes(int(p in state.targets) for p in range(len(state.stones))))
        for position in sorted(state.history):
            key.update(position)
        return key.hexdigest()

    def _search(self, state: State, plies: int):
        self.nodes += 1
        if self.nodes > self.limits.nodes or time.monotonic()-self.started > self.limits.seconds:
            raise BudgetExceeded()
        key = self._key(state, plies)
        if key in self.cache:
            return self.cache[key], key
        outcome = terminal(state, self.goal, self.player)
        if outcome is not None:
            self.proof[key] = {"outcome": outcome, "terminal": True}
            self.cache[key] = outcome
            return outcome, key
        if plies <= 0 and self.deadline:
            self.proof[key] = {"outcome": -1, "terminal": True, "deadline": True}
            self.cache[key] = -1
            return -1, key
        if plies <= 0 or state.passes >= 2:
            return 0, key
        own_left = (plies+int(state.to_play == self.player))//2
        if self.goal == "kill" and state.targets:
            _, liberties = group(state.stones, state.size, next(iter(state.targets)))
            if len(liberties) > own_left:
                # The defender can pass: this fixed target chain then loses at
                # most one liberty per attacking move. It cannot be physically
                # captured within this horizon. This is NOT an unbounded loss.
                if self.deadline:
                    self.proof[key] = {"outcome": -1, "terminal": True,
                                       "capture_liberty_bound": True}
                    self.cache[key] = -1
                    return -1, key
                if self.seek == 1:
                    return 0, key
        # Ordering changes runtime only. Every required opponent move is searched.
        focus = set(state.targets)
        checked = set()
        for p in state.targets:
            if p not in checked:
                chain, liberties = group(state.stones, state.size, p)
                checked.update(chain)
                focus.update(liberties)
        distance = [-1]*len(state.stones)
        pending = deque(focus)
        for point in focus:
            distance[point] = 0
        adjacency = neighbors(state.size)
        while pending:
            point = pending.popleft()
            for other in adjacency[point]:
                if distance[other] < 0:
                    distance[other] = distance[point]+1
                    pending.append(other)
        def priority(move):
            if move == -1:
                return -10000
            return -distance[move]
        moves = [point for point, color in enumerate(state.stones) if not color] + [-1]
        moves.sort(key=priority, reverse=True)
        if self.policy:
            preferences = self.policy.at_depth(state,own_left) if hasattr(self.policy,"at_depth") else self.policy(state)
            moves.sort(key=lambda move: preferences.get(move, 0.0), reverse=True)
        desired = 1 if state.to_play == self.player else -1
        branches, unknown = [], False
        for move in moves:
            try:
                child = state.play(move)
            except ValueError:
                continue
            value, child_key = self._search(child, plies-1)
            if value == desired:
                self.proof[key] = {"outcome": value, "branches": [{"move": move, "next": child_key}]}
                self.cache[key] = value
                return value, key
            if value == 0:
                if self.seek is not None and desired != self.seek:
                    # One unresolved mandatory counteranswer already prevents
                    # a proof in the requested direction. No guess is cached.
                    return 0, key
                unknown = True
            else:
                branches.append({"move": move, "next": child_key})
        if unknown:
            return 0, key
        outcome = -desired
        self.proof[key] = {"outcome": outcome, "branches": branches}
        self.cache[key] = outcome
        return outcome, key

    def solve(self, state: State, allow_captured_target=False) -> dict:
        if (not state.targets and not allow_captured_target) or (state.targets and len({state.stones[p] for p in state.targets}) != 1):
            raise ValueError("A nonempty single-color target must be marked")
        expected = self.player if self.goal == "life" else 3-self.player
        if state.targets and state.stones[next(iter(state.targets))] != expected:
            raise ValueError("Target color disagrees with goal")
        result, root_key, own = 0, "", None
        try:
            depths = [self.limits.own_moves] if self.deadline else range(1, self.limits.own_moves+1)
            for depth in depths:
                plies = 2*depth-1 if state.to_play == self.player else 2*depth
                result, root_key = self._search(state, plies)
                if result:
                    own = depth
                    break
        except BudgetExceeded:
            result = 0
        certificate = None
        if result:
            reachable, pending = {}, [root_key]
            while pending:
                key = pending.pop()
                if key in reachable:
                    continue
                reachable[key] = self.proof[key]
                pending.extend(branch["next"] for branch in self.proof[key].get("branches", []))
            certificate = {"schema": "gostone.full-board-proof/1", "goal": self.goal,
                           "player": self.player, "root": root_key, "nodes": reachable,
                           "deadline_plies": plies if self.deadline else None,
                           "rules": "positional-superko; suicide forbidden; no artificial boundary"}
            verify_certificate(state, certificate)
        status = "proven-win" if result == 1 else "proven-loss" if result == -1 else "unknown"
        if self.deadline and result:
            status = "deadline-success" if result == 1 else "deadline-failure"
        return {"status": status,
                "within_own_moves": own if result == 1 else None,
                "search_nodes": self.nodes, "seconds": time.monotonic()-self.started,
                "certificate": certificate, "scope": "full-board",
                "minimum_depth_certified": False}


def verify_certificate(initial: State, certificate: dict) -> None:
    """Replay proof structure, including exact legal answer coverage.

    Separate from search and its caches; shares the small rule kernel. A second
    independent rule engine is still desirable before a production release.
    """
    if certificate.get("schema") != "gostone.full-board-proof/1":
        raise ValueError("Unsupported proof schema")
    nodes, goal, player = certificate["nodes"], certificate["goal"], certificate["player"]
    if goal not in ("life", "kill") or player not in (1, 2):
        raise ValueError("Invalid proof goal")
    target_color = player if goal == "life" else 3-player
    if any(initial.stones[p] != target_color for p in initial.targets):
        raise ValueError("Certificate target color disagrees with its goal")
    active, visited = set(), set()
    def visit(state: State, key: str, depth: int):
        if depth > 100 or key in active:
            raise ValueError("Cyclic or overdeep proof")
        context = (key, state)
        if context in visited:
            return
        node = nodes[key]
        outcome = node.get("outcome")
        if outcome not in (-1, 1):
            raise ValueError("A certificate cannot contain unknown outcomes")
        if node.get("terminal"):
            is_deadline = node.get("deadline") is True
            if node.get("capture_liberty_bound") is True:
                limit = certificate.get("deadline_plies")
                if goal != "kill" or outcome != -1 or type(limit) is not int or limit <= depth or not state.targets:
                    raise ValueError("False capture liberty bound")
                own_left = (limit-depth+int(state.to_play == player))//2
                _, liberties = group(state.stones, state.size, next(iter(state.targets)))
                if len(liberties) <= own_left:
                    raise ValueError("False capture liberty bound")
            elif is_deadline:
                if certificate.get("deadline_plies") != depth or outcome != -1 or terminal(state, goal, player) == 1:
                    raise ValueError("False deadline claim")
            elif terminal(state, goal, player) != outcome:
                raise ValueError("False terminal claim")
            if node.get("branches"):
                raise ValueError("Terminal contains branches")
        else:
            if state.passes >= 2:
                raise ValueError("Two passes are not a terminal life proof")
            branches = node.get("branches", [])
            moves = [entry["move"] for entry in branches]
            if not moves or len(set(moves)) != len(moves):
                raise ValueError("Invalid proof branches")
            existential = (state.to_play == player) == (outcome == 1)
            if not existential and set(moves) != {move for move, _ in state.legal()}:
                raise ValueError("Proof omits a legal counteranswer")
            active.add(key)
            for branch in branches:
                if nodes[branch["next"]]["outcome"] != outcome:
                    raise ValueError("Inconsistent proof outcome")
                visit(state.play(branch["move"]), branch["next"], depth+1)
            active.remove(key)
        visited.add(context)
    visit(initial, certificate["root"], 0)
