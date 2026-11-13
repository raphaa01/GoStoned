from __future__ import annotations

from pathlib import Path

from .common import atomic_json, read_json
from .rules import State
from .solver import verify_certificate


def approved_puzzles(root: Path, territory="DE"):
    corpus = read_json(root / "data/corpus.json", {"sources": [], "records": []})
    sources = {row["id"]: row for row in corpus["sources"]}
    parents = {row["id"]: row for row in corpus["records"]}
    puzzles = []
    for path in (root / "candidates").glob("*.json"):
        row = read_json(path)
        feedback = read_json(root / "reviews" / (row["id"]+".json"), {})
        result = row["verification"]
        if feedback.get("rating") != "good" or not result.get("export_eligible"):
            continue
        parent = parents[row["parent_id"]]
        source = sources[parent["source_id"]]
        if territory not in source.get("reviewed_territories", []):
            raise ValueError(f"Source territory not reviewed: {territory}")
        initial = State.setup(row["size"], row["board"], row["to_play"], row["targets"])
        certificate = result["certificate"]
        if certificate.get("deadline_plies") is not None or certificate["nodes"][certificate["root"]]["outcome"] != 1:
            raise ValueError("Puzzle requires an unbounded goal-achievement proof")
        verify_certificate(initial, certificate)
        solution = result["solution"]
        if not solution or len({v["moves"][0]["move"] for v in result.get("wrong_variations", [])}) != 2:
            raise ValueError("Distinct wrong first moves and a main solution are required")
        first = solution[0]["move"]
        refutations = result.get("first_move_refutations", [])
        refuted = [entry["move"] for entry in refutations]
        required = {move for move, _ in initial.legal()} - {first}
        if len(set(refuted)) != len(refuted) or set(refuted) != required:
            raise ValueError("Every other legal first move must have a refutation certificate")
        for entry in refutations:
            proof = entry["certificate"]
            if proof.get("deadline_plies") is not None or proof["nodes"][proof["root"]]["outcome"] != -1:
                raise ValueError("First-move refutation is incomplete")
            verify_certificate(initial.play(entry["move"]), proof)
        position, key = initial, certificate["root"]
        for move in solution:
            if move["color"] != position.to_play or move["move"] == -1:
                raise ValueError("Invalid main line color or pass")
            branch = next((b for b in certificate["nodes"][key].get("branches", []) if b["move"] == move["move"]), None)
            if branch is None:
                raise ValueError("Main demonstration is outside the proof")
            position, key = position.play(move["move"]), branch["next"]
        if not certificate["nodes"][key].get("terminal"):
            raise ValueError("Main demonstration stops before the proved goal")
        if sum(m["color"] == initial.to_play for m in solution) != row["requested_own_moves"]:
            raise ValueError("Main line does not match the requested own moves")
        if row["requested_own_moves"] > 1:
            lower = result["minimum_depth_certificate"]
            if lower.get("deadline_plies") != 2*(row["requested_own_moves"]-1)-1:
                raise ValueError("Wrong minimum-depth certificate horizon")
            if lower["nodes"][lower["root"]]["outcome"] != -1:
                raise ValueError("Minimum-depth lower bound is not proved")
            verify_certificate(initial, lower)
        alternatives = result.get("wrong_variations", [])
        if len(alternatives) != 2:
            raise ValueError("Two refuted alternatives are required")
        for alternative in alternatives:
            moves = alternative["moves"]
            if not 1 <= len(moves) <= 4 or moves[0]["color"] != initial.to_play:
                raise ValueError("Invalid short refutation")
            child = initial.play(moves[0]["move"])
            proof = alternative["certificate"]
            if proof.get("deadline_plies") is not None or proof["nodes"][proof["root"]]["outcome"] != -1:
                raise ValueError("An incomplete horizon is not a refutation")
            verify_certificate(child, proof)
        puzzles.append(row)
    return puzzles


def export_puzzles(root: Path, destination: Path, territory="DE"):
    puzzles = approved_puzzles(root, territory)
    if not puzzles:
        raise ValueError("No puzzles pass proof, exact depth, two refutations and human quality approval yet")
    payload = {"schema": "gostone.ai-puzzle-bundle/1", "territory_review": territory,
               "difficulty_calibrated": False, "puzzles": puzzles}
    atomic_json(destination.with_suffix(".json"), payload)
    sgf = []
    def point(p):
        return "" if p == -1 else chr(97+p % 19)+chr(97+p//19)
    def branch(moves, status):
        return "("+"".join(f";{'B' if move['color'] == 1 else 'W'}[{point(move['move'])}]C[{status}]" for move in moves)+")"
    for row in puzzles:
        setup = "".join(f"A{label}"+"".join(f"[{point(p)}]" for p,c in enumerate(row["board"]) if c == color)
                        for color, label in ((1,"B"),(2,"W")) if color in row["board"])
        result = row["verification"]
        sgf.append(f"(;GM[1]FF[4]CA[UTF-8]SZ[19]PL[{'B' if row['to_play'] == 1 else 'W'}]GN[{row['id']}]"
                   f"C[Goal: {row['category']}; Kyu: uncalibrated; own moves: {row['requested_own_moves']}]"
                   +setup+branch(result["solution"], "correct")
                   +"".join(branch(variation["moves"], "incorrect; full refutation in JSON") for variation in result["wrong_variations"])+")")
    destination.with_suffix(".sgf").write_text("\n".join(sgf)+"\n", encoding="utf-8")
    return {"exported": len(puzzles), "json": str(destination.with_suffix(".json")), "sgf": str(destination.with_suffix(".sgf"))}
