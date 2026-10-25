"""Explicit target selection for connection and capturing-race proposals."""
from __future__ import annotations

from itertools import combinations

from .rules import group


def chains(board,player):
    checked,result=set(),[]
    for point,color in enumerate(board):
        if color == player and point not in checked:
            stones,libs=group(tuple(board),19,point)
            checked.update(stones)
            result.append((stones,libs))
    return result


def distance(a,b):
    return min(abs(p % 19-q % 19)+abs(p//19-q//19) for p in a for q in b)


def select_anchors(board,player,goal,first_move,profile=None):
    own=chains(board,player)
    choices=[]
    if goal == "connect":
        for (a,al),(b,bl) in combinations(own,2):
            gap=distance(a,b)
            if 2 <= gap <= 5 and len(a)+len(b) <= 24:
                near=min(distance({first_move},a),distance({first_move},b))
                choices.append(((gap,near,-min(len(a),len(b))),a,b))
    elif goal == "semeai":
        for a,al in own:
            for b,bl in chains(board,3-player):
                if profile == "tempo" and (len(al) != 2 or len(bl) != 3):
                    continue
                if profile == "atari" and (len(al) != 1 or len(bl) != 2):
                    continue
                if profile == "balanced" and (len(al) != 2 or len(bl) != 2):
                    continue
                if profile == "initiative" and (len(al) != 3 or len(bl) != 2):
                    continue
                if (len(a) >= 2 and len(b) >= 2 and len(a)+len(b) <= 24
                        and len(al) <= 5 and len(bl) <= 5 and min(len(al),len(bl)) <= 3
                        and distance(a,b) == 1):
                    choices.append(((len(al) != 1,-len(al & bl),abs(len(al)-len(bl)),-min(len(a),len(b))),a,b))
    if not choices:
        return []
    _,a,b=min(choices,key=lambda row:(row[0],min(row[1]),min(row[2])))
    return [sorted(a),sorted(b)]


def objective_text(goal):
    return {"life":"Bringe die markierte Gruppe zu zwei bedingungslos sicheren Augen.",
            "kill":"Schlage sämtliche markierten gegnerischen Steine.",
            "connect":"Verbinde die beiden markierten Gruppen zu einer Gruppe mit mindestens zwei Freiheiten, bevor eine verloren geht.",
            "semeai":"Schlage die markierte gegnerische Gruppe und rette deine markierte Gruppe mit mindestens zwei Freiheiten."}[goal]
