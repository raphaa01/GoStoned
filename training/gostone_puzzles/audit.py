from __future__ import annotations

from pathlib import Path
import random

from .common import atomic_json, records
from .rules import State


def export_transitions(root: Path, destination: Path):
    transitions = []
    for row in records(root):
        for line in row["solutions"]:
            state = State.setup(19, row["board"], row["to_play"])
            for move in line:
                child = state.play(move)
                transitions.append({"before": state.stones, "after": child.stones,
                                    "player": state.to_play, "move": move, "source": row["id"]})
                state = child
    rng = random.Random(101)
    for game in range(20):
        state = State.setup(19, [0]*361, 1)
        for turn in range(100):
            options = list(state.legal())
            move, child = options[rng.randrange(len(options)-1)]
            transitions.append({"before": state.stones, "after": child.stones,
                                "player": state.to_play, "move": move, "source": f"random-{game}-{turn}"})
            state = child
    atomic_json(destination, {"transitions": transitions})
    return {"transitions": len(transitions), "path": str(destination)}
