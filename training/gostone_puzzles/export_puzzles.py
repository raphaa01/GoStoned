from __future__ import annotations

from pathlib import Path

from .common import atomic_json, read_json, canonical, solution_fingerprint, tactical_core
from .rules import State, group, normalize_anchors
from .solver import verify_certificate


def export_registry(root):
    result = read_json(root/"data/export-registry.json",{"schema":"gostone.puzzle-export-registry/1","entries":{}})
    if result.get("schema") != "gostone.puzzle-export-registry/1":
        raise ValueError("Unsupported export registry; puzzle numbers must not silently reset")
    numbers = [entry["number"] for entry in result["entries"].values()]
    if any(type(number) is not int or number < 1 for number in numbers) or len(set(numbers)) != len(numbers):
        raise ValueError("Export registry contains conflicting puzzle numbers")
    return result


def allocate_numbers(root, puzzles):
    registry = export_registry(root)
    next_number = max((entry["number"] for entry in registry["entries"].values()),default=0)+1
    result = []
    for row in puzzles:
        position = canonical(row["board"],row["size"],row["to_play"])
        core = tactical_core(row["board"],row["targets"],row["to_play"])
        signature = solution_fingerprint(row["verification"]["solution"],row["to_play"])
        entry = registry["entries"].get(row["id"])
        if entry is None:
            entry = {"number":next_number,"position":position,"core":core,"solution_patterns":[]}
            registry["entries"][row["id"]] = entry
            next_number += 1
        elif entry["position"] != position or entry["core"] != core:
            raise ValueError("An exported puzzle ID changed its initial position or target core")
        if signature and signature not in entry["solution_patterns"]:
            entry["solution_patterns"].append(signature)
        result.append({**row,"puzzle_number":entry["number"]})
    # Reserve numbers before writing outputs. A failed file write may leave a
    # gap, but must never make an already published number identify a new task.
    atomic_json(root/"data/export-registry.json",registry)
    return result


def approved_puzzles(root: Path, territory="DE"):
    corpus = read_json(root / "data/corpus.json", {"sources": [], "records": []})
    sources = {row["id"]: row for row in corpus["sources"]}
    parents = {row["id"]: row for row in corpus["records"]}
    puzzles = []
    positions = {r["family"] for r in corpus["records"]}
    cores = {tactical_core(r["board"],r.get("targets",()),r["to_play"]) for r in corpus["records"] if r.get("targets")}
    patterns = set()
    registry = export_registry(root)
    for path in sorted((root / "candidates").glob("*.json")):
        row = read_json(path)
        feedback = read_json(root / "reviews" / (row["id"]+".json"), {})
        result = row["verification"]
        if feedback.get("rating") != "good" or not result.get("export_eligible"):
            continue
        kyu = feedback.get("kyu")
        difficulty = {"kyu":kyu,"status":"human-assessed","automatic_calibration":False}
        if type(kyu) is not int or not 1 <= kyu <= 30:
            from .difficulty import estimate
            difficulty = estimate(root,row)
            kyu = difficulty.get("kyu")
            if type(kyu) is not int or difficulty.get("status") != "calibrated-estimate":
                continue
            low,high = row.get("requested_kyu",[1,30])
            if not low <= difficulty["interval_90pct"][0] <= difficulty["interval_90pct"][1] <= high:
                continue
        if not row.get("requested_kyu",[1,30])[0] <= kyu <= row.get("requested_kyu",[1,30])[1]:
            continue
        if row["size"] != 19:
            raise ValueError("The current puzzle export supports actual 19x19 boards only")
        parent = parents[row["parent_id"]]
        source = sources[parent["source_id"]]
        if territory not in source.get("reviewed_territories", []):
            raise ValueError(f"Source territory not reviewed: {territory}")
        if (source.get("attribution_required_for_original_content_in_reviewed_territories") is not False
                or source.get("commercial_use_of_original_content_in_reviewed_territories") is not True):
            raise ValueError("Source lacks recorded commercial use without attribution")
        initial = State.setup(row["size"], row["board"], row["to_play"], row["targets"])
        anchors=normalize_anchors(row["category"],row.get("anchor_groups",()),row["size"])
        if anchors:
            if initial.targets != anchors[0] | anchors[1]:
                raise ValueError("The exported targets must identify both anchor groups")
            for index,points in enumerate(anchors):
                chain,_=group(initial.stones,initial.size,next(iter(points)))
                color=3-row["to_play"] if row["category"] == "semeai" and index == 1 else row["to_play"]
                if chain != points or any(initial.stones[p] != color for p in points):
                    raise ValueError("An anchor must identify a complete original group of the correct color")
        else:
            color = initial.stones[next(iter(initial.targets))]
            target_group,_ = group(initial.stones,initial.size,next(iter(initial.targets)))
            if target_group != initial.targets:
                raise ValueError("The target must identify the complete initial group")
            if any(len(group(initial.stones,initial.size,p)[0]) > len(target_group)
                   for p,c in enumerate(initial.stones) if c == color):
                continue
        def verify(state, proof):
            if proof.get("goal") != row["category"] or proof.get("player") != row["to_play"]:
                raise ValueError("Certificate goal/player differs from the exported task")
            if normalize_anchors(row["category"],proof.get("anchor_groups",()),row["size"]) != anchors:
                raise ValueError("Certificate anchor groups differ from the exported objective")
            verify_certificate(state,proof)
        certificate = result["certificate"]
        if certificate.get("deadline_plies") is not None or certificate["nodes"][certificate["root"]]["outcome"] != 1:
            raise ValueError("Puzzle requires an unbounded goal-achievement proof")
        verify(initial, certificate)
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
            verify(initial.play(entry["move"]), proof)
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
            verify(initial, lower)
        alternatives = result.get("wrong_variations", [])
        if len(alternatives) != 2:
            raise ValueError("Two refuted alternatives are required")
        for alternative in alternatives:
            moves = alternative["moves"]
            if (not 2 <= len(moves) <= 4 or moves[0]["color"] != initial.to_play or moves[0]["move"] == first
                    or alternative.get("status") != "incorrect" or alternative.get("feedback_after_ply") != len(moves)
                    or any(move["move"] < 0 for move in moves)):
                raise ValueError("Invalid short refutation")
            child = initial.play(moves[0]["move"])
            proof = alternative["certificate"]
            if proof.get("deadline_plies") is not None or proof["nodes"][proof["root"]]["outcome"] != -1:
                raise ValueError("An incomplete horizon is not a refutation")
            verify(child, proof)
            key = proof["root"]
            for move in moves[1:]:
                if move["color"] != child.to_play:
                    raise ValueError("Wrong-variation colors do not alternate legally")
                branch = next((b for b in proof["nodes"][key].get("branches",[]) if b["move"] == move["move"]),None)
                if branch is None:
                    raise ValueError("A displayed wrong variation is outside its refutation proof")
                child,key = child.play(move["move"]),branch["next"]
            if not proof["nodes"][key].get("terminal") or proof["nodes"][key]["outcome"] != -1:
                raise ValueError("A short wrong variation must reach its proved failure within four plies")
        position_key = canonical(row["board"],row["size"],row["to_play"])
        core_key = tactical_core(row["board"],row["targets"],row["to_play"])
        def pattern(line, player):
            return solution_fingerprint(line,player)
        signature = pattern(solution,row["to_play"])
        if any(identifier != row["id"] and
               (entry["position"] == position_key or entry["core"] == core_key
                or (signature and signature in entry["solution_patterns"]))
               for identifier,entry in registry["entries"].items()):
            continue
        historical_patterns = set()
        for reference in corpus["records"]:
            for line in reference["solutions"]:
                for offset in range(len(line)-len(solution)+1):
                    player=reference["to_play"] if offset % 2 == 0 else 3-reference["to_play"]
                    old_signature = pattern([{"move":m,"color":player if i%2 == 0 else 3-player}
                                             for i,m in enumerate(line[offset:offset+len(solution)])],player)
                    if old_signature:
                        historical_patterns.add(old_signature)
        if position_key in positions or core_key in cores or (signature and (signature in patterns or signature in historical_patterns)):
            continue
        positions.add(position_key)
        cores.add(core_key)
        if signature:
            patterns.add(signature)
        puzzles.append({**row,"starting_color":"black" if row["to_play"] == 1 else "white",
                        "difficulty":difficulty})
    return puzzles


def export_puzzles(root: Path, destination: Path, territory="DE"):
    puzzles = approved_puzzles(root, territory)
    if not puzzles:
        raise ValueError("No puzzles pass proof, exact depth, two short refutations, novelty, Kyu assessment and human quality approval yet")
    puzzles = allocate_numbers(root,puzzles)
    payload = {"schema": "gostone.ai-puzzle-bundle/1", "territory_review": territory,
               "difficulty_calibrated": all(r["difficulty"]["status"] == "calibrated-estimate" for r in puzzles), "puzzles": puzzles}
    atomic_json(destination.with_suffix(".json"), payload)
    sgf = []
    def point(p):
        return "" if p == -1 else chr(97+p % 19)+chr(97+p//19)
    def escape(value):
        return str(value).replace("\\","\\\\").replace("]","\\]")
    def branch(moves, status):
        return "("+"".join(f";{'B' if move['color'] == 1 else 'W'}[{point(move['move'])}]"
                           +(f"C[{status}]" if i == len(moves)-1 else "")for i,move in enumerate(moves))+")"
    for row in puzzles:
        setup = "".join(f"A{label}"+"".join(f"[{point(p)}]" for p,c in enumerate(row["board"]) if c == color)
                        for color, label in ((1,"B"),(2,"W")) if color in row["board"])
        anchors=row.get("anchor_groups",[])
        if anchors:
            setup+="TR"+"".join(f"[{point(p)}]" for p in anchors[0])
            setup+="SQ"+"".join(f"[{point(p)}]" for p in anchors[1])
        elif row.get("targets"):
            setup+="MA"+"".join(f"[{point(p)}]" for p in row["targets"])
        markers="first anchor: triangles; second anchor: squares" if anchors else "target: crosses"
        result = row["verification"]
        sgf.append(f"(;GM[1]FF[4]CA[UTF-8]SZ[19]PL[{'B' if row['to_play'] == 1 else 'W'}]GN[Puzzle {row['puzzle_number']}]"
                   f"C[Goal: {row['category']}; {escape(row.get('objective_text',''))}; Kyu: {row['difficulty']['kyu']} ({row['difficulty']['status']}); own moves: {row['requested_own_moves']}; {markers}]"
                   +setup+branch(result["solution"], "correct")
                   +"".join(branch(variation["moves"], "incorrect; full refutation in JSON") for variation in result["wrong_variations"])+")")
    destination.with_suffix(".sgf").write_text("\n".join(sgf)+"\n", encoding="utf-8")
    return {"exported": len(puzzles), "json": str(destination.with_suffix(".json")), "sgf": str(destination.with_suffix(".sgf"))}
