"""Restricted tactical search supplies move ordering, never a solution proof."""
from __future__ import annotations

import time

from .rules import group, terminal


class TacticalGuide:
    def __init__(self, initial, goal, player, prior=None, seconds=.25, nodes=4000):
        occupied = [p for p,c in enumerate(initial.stones) if c]
        low_x, high_x = max(0,min(p % initial.size for p in occupied)-2), min(initial.size-1,max(p % initial.size for p in occupied)+2)
        low_y, high_y = max(0,min(p//initial.size for p in occupied)-2), min(initial.size-1,max(p//initial.size for p in occupied)+2)
        self.zone = tuple(y*initial.size+x for y in range(low_y,high_y+1) for x in range(low_x,high_x+1))
        self.goal, self.player, self.prior = goal, player, prior
        self.seconds, self.max_nodes, self.nodes = seconds, nodes, 0
        self.moves, self.cache = {}, {}
        self.started = time.monotonic()

    def key(self, state):
        # Ignoring outside moves/history is safe ONLY for a fallible ordering
        # hypothesis. The real solver retains both and checks all legal replies.
        return bytes(state.stones[p] for p in self.zone), state.to_play, state.targets

    def search(self, state, plies):
        self.nodes += 1
        if self.nodes > self.max_nodes or time.monotonic()-self.started > self.seconds:
            return 0
        outcome = terminal(state,self.goal,self.player)
        if outcome is not None:
            return outcome
        if plies <= 0 or state.passes >= 2:
            return 0
        own_left = (plies+int(state.to_play == self.player))//2
        if self.goal == "kill" and len(group(state.stones,state.size,next(iter(state.targets)))[1]) > own_left:
            return 0
        key = state, plies
        if key in self.cache:
            return self.cache[key]
        choices = [p for p in self.zone if not state.stones[p]]+[-1]
        if self.prior:
            scores = self.prior.at_depth(state,own_left) if hasattr(self.prior,"at_depth") else self.prior(state)
            choices.sort(key=lambda p:scores.get(p,-10000),reverse=True)
        desired = 1 if state.to_play == self.player else -1
        unknown = False
        for point in choices:
            if self.nodes >= self.max_nodes or time.monotonic()-self.started > self.seconds:
                return 0
            try:
                child = state.play(point)
            except ValueError:
                continue
            value = self.search(child,plies-1)
            if value == desired:
                self.cache[key] = value
                if value == 1:
                    self.moves[self.key(state)] = point
                return value
            if value == 0:
                if desired == -1:
                    return 0
                unknown = True
        outcome = 0 if unknown else -desired
        self.cache[key] = outcome
        return outcome

    def __call__(self, state):
        return self.at_depth(state,None)

    def at_depth(self, state, own_moves):
        point = self.moves.get(self.key(state))
        if point is not None:
            return {point: 1_000_000.}
        if not self.prior:
            return {}
        return self.prior.at_depth(state,own_moves) if hasattr(self.prior,"at_depth") else self.prior(state)

    def report(self, result):
        return {"scope":"restricted-ordering-hypothesis-only","hypothesis":result,
                "nodes":self.nodes,"seconds":time.monotonic()-self.started,
                "legal_counteranswer_coverage_proven":False}
