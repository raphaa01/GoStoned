from __future__ import annotations

from dataclasses import dataclass
import time

from .common import digest
from .rules import State, group, terminal


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

    def __init__(self, goal: str, player: int, limits: Limits | None = None, policy=None, deadline=False):
        if goal not in ("life", "kill") or player not in (1, 2):
            raise ValueError("Only explicit life/kill goals are currently provable")
        self.goal, self.player, self.limits, self.policy = goal, player, limits or Limits(), policy
        if not 1 <= self.limits.own_moves <= 8 or self.limits.nodes < 1 or self.limits.seconds <= 0:
            raise ValueError("Invalid search limits")
        self.nodes, self.cache, self.proof = 0, {}, {}
        self.deadline = deadline
        self.started = time.monotonic()

    def _key(self, state: State, plies: int) -> str:
        return digest((state.size, list(state.stones), state.to_play, sorted(state.targets),
                       sorted(item.hex() for item in state.history), state.passes, plies))

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
        legal = list(state.legal())
        # Ordering changes runtime only. Every required opponent move is searched.
        focus = set(state.targets)
        for p in state.targets:
            focus.update(group(state.stones, state.size, p)[1])
        def priority(item):
            move = item[0]
            if move == -1:
                return -10000
            return -min((abs(move % state.size-p % state.size)+abs(move//state.size-p//state.size)
                         for p in focus), default=0)
        legal.sort(key=priority, reverse=True)
        if self.policy:
            preferences = self.policy(state)
            legal.sort(key=lambda item: preferences.get(item[0], 0.0), reverse=True)
        desired = 1 if state.to_play == self.player else -1
        branches, unknown = [], False
        for move, child in legal:
            value, child_key = self._search(child, plies-1)
            if value == desired:
                self.proof[key] = {"outcome": value, "branches": [{"move": move, "next": child_key}]}
                self.cache[key] = value
                return value, key
            if value == 0:
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
            if is_deadline:
                if certificate.get("deadline_plies") != depth or outcome != -1 or terminal(state, goal, player) == 1:
                    raise ValueError("False deadline claim")
            elif terminal(state, goal, player) != outcome:
                raise ValueError("False terminal claim")
            if node.get("branches"):
                raise ValueError("Terminal contains branches")
        else:
            if state.passes >= 2:
                raise ValueError("Two passes are not a terminal life proof")
            legal = dict(state.legal())
            branches = node.get("branches", [])
            moves = [entry["move"] for entry in branches]
            if not moves or len(set(moves)) != len(moves) or any(m not in legal for m in moves):
                raise ValueError("Invalid proof branches")
            existential = (state.to_play == player) == (outcome == 1)
            if not existential and set(moves) != set(legal):
                raise ValueError("Proof omits a legal counteranswer")
            active.add(key)
            for branch in branches:
                if nodes[branch["next"]]["outcome"] != outcome:
                    raise ValueError("Inconsistent proof outcome")
                visit(legal[branch["move"]], branch["next"], depth+1)
            active.remove(key)
        visited.add(context)
    visit(initial, certificate["root"], 0)
