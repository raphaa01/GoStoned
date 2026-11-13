"""Reproducible, source-linked transcription imports and corpus accounting."""
from __future__ import annotations

from pathlib import Path
import hashlib
import re

from .common import ROOT, atomic_json, canonical, digest, read_json, records, transform_point
from .rules import State
from .scans import approve_transcription, register_transcription, scan_inventory


def sgf_points(value: str) -> list[int]:
    result = []
    for point in value.split():
        if not re.fullmatch(r"[a-s]{2}", point):
            raise ValueError("Expected explicit SGF coordinates aa through ss")
        result.append((ord(point[1])-97)*19+ord(point[0])-97)
    return result


def import_reviewed(root: Path) -> dict:
    """Import only individually read/reviewed specifications, never OCR guesses.

    The reviewer field explicitly records agent visual transcription rather than
    implying that a professional Go player certified the historical answer.
    """
    inventory = {s["id"]: s for s in scan_inventory(root)["sources"]}
    added, present, merged = [], [], []
    checked_sources = set()
    for path in sorted((ROOT/"transcriptions").glob("*.json")):
        document = read_json(path)
        if document.get("schema") != "gostone.reviewed-scan-transcriptions/1":
            raise ValueError("Unsupported reviewed transcription format")
        for item in document["records"]:
            source = inventory[item["source_id"]]
            if source["rights_status"] != "old-original-pd-scan":
                raise ValueError("Reviewed transcription source rights are not cleared")
            if source.get("sha1") != document["source_pdf_sha1"]:
                raise ValueError("The reviewed source edition does not match the downloaded inventory")
            if source["id"] not in checked_sources:
                original = root/source["relative_path"]
                value = hashlib.sha1()
                with original.open("rb") as stream:
                    while block := stream.read(1024*1024):
                        value.update(block)
                if value.hexdigest() != document["source_pdf_sha1"]:
                    raise ValueError("The downloaded original changed since visual transcription")
                checked_sources.add(source["id"])
            identifier = digest((item["source_id"], item["page"], item["label"]))[:24]
            board = [0]*361
            for color, key in ((1, "black"), (2, "white")):
                for point in sgf_points(item[key]):
                    if board[point]:
                        raise ValueError("Overlapping or repeated setup stone")
                    board[point] = color
            solutions = [sgf_points(line) for line in item["solutions"]]
            old = next((r for r in records(root) if r["id"] == "scan-"+identifier), None)
            if old:
                if (any(old[key] != value for key, value in
                       (("board", board), ("to_play", item["to_play"]), ("category", item["category"])))
                        or any(line not in old["solutions"] for line in solutions)):
                    raise ValueError("Reviewed source changed; an explicit new revision is needed")
                present.append(old["id"])
                continue
            family = canonical(board, 19, item["to_play"])
            corpus = read_json(root/"data/corpus.json", {"records": []})
            duplicate = next((r for r in corpus["records"] if r["family"] == family), None)
            if duplicate:
                # Merge answer evidence in the original row's orientation. A
                # mirrored diagram with another line is not another puzzle.
                symmetry = None
                for candidate in range(8):
                    mapped = [0]*361
                    for point, color in enumerate(board):
                        mapped[transform_point(point, 19, candidate)] = (
                            color if item["to_play"] == duplicate["to_play"] else 3-color if color else 0)
                    if mapped == duplicate["board"]:
                        symmetry = candidate
                        break
                if symmetry is None:
                    raise ValueError("Cannot align duplicated source position")
                mapped_solutions = [[transform_point(point, 19, symmetry) for point in line] for line in solutions]
                for line in mapped_solutions:
                    state = State.setup(19, duplicate["board"], duplicate["to_play"])
                    for point in line:
                        state = state.play(point)
                    if line not in duplicate["solutions"]:
                        duplicate["solutions"].append(line)
                evidence = {"transcription_id": identifier, "source_id": item["source_id"],
                            "page": item["page"], "label": item["label"], "review": item["review"],
                            "symmetry_to_record": symmetry, "note": item["note"]}
                previous = duplicate.setdefault("additional_source_evidence", [])
                if not any(e["transcription_id"] == identifier for e in previous):
                    previous.append(evidence)
                corpus["content_hash"] = digest(corpus["records"])
                atomic_json(root/"data/corpus.json", corpus)
                merged.append({"source": item["label"], "family": duplicate["id"]})
                continue
            transcription = register_transcription(root, {
                "source_id": item["source_id"], "page": item["page"], "diagram_label": item["label"],
                "board": board, "solutions": solutions, "category": item["category"],
                "to_play": item["to_play"], "notes": item["note"],
            })
            review = item["review"]
            result = approve_transcription(root, transcription["id"], review["reviewer"],
                                           {key: review.get(key) for key in ("position", "solution", "source")})
            added.append(result["added"])
    audit = audit_corpus(root)
    corpus = read_json(root/"data/corpus.json")
    for source in corpus["sources"]:
        if source["id"] in checked_sources:
            source.update(attribution_required_for_original_content_in_reviewed_territories=False,
                          commercial_use_of_original_content_in_reviewed_territories=True)
    atomic_json(root/"data/corpus.json",corpus)
    index = read_json(root/"data/sources.json",{})
    index["sources"] = corpus["sources"]
    atomic_json(root/"data/sources.json",index)
    atomic_json(root/"data/corpus-audit.json", audit)
    return {"added": added, "already_present": present, "merged_same_family": merged, "audit": audit}


def audit_corpus(root: Path) -> dict:
    rows = records(root)
    seen, ids, sources, colors, moves = set(), set(), {}, {1: 0, 2: 0}, 0
    for row in rows:
        if row["id"] in ids:
            raise ValueError("Repeated corpus ID")
        ids.add(row["id"])
        family = canonical(row["board"], row["size"], row["to_play"])
        if family != row["family"] or family in seen:
            raise ValueError("Changed or duplicate position family")
        seen.add(family)
        if not row["solutions"] or any(not line for line in row["solutions"]):
            raise ValueError("A training reference needs an actual nonempty answer")
        initial = State.setup(row["size"], row["board"], row["to_play"], row.get("targets", ()))
        for line in row["solutions"]:
            state = initial
            for move in line:
                state = state.play(move)
                moves += 1
        colors[row["to_play"]] += 1
        sources[row["source_id"]] = sources.get(row["source_id"], 0)+1
    inventory = scan_inventory(root)["sources"]
    scanned = sum(row["source_id"] in {s["id"] for s in inventory} for row in rows)
    return {"records": len(rows), "families": len(seen), "move_examples": moves,
            "start_black": colors[1], "start_white": colors[2], "sources": sources,
            "reviewed_scan_records": scanned, "corpus_hash": digest(rows),
            "scan_pages": sum(s.get("pages", 0) for s in inventory),
            "unreviewed_diagram_proposals": sum(len(read_json(p).get("diagrams", [])) for p in (root/"scans/recognition").glob("*/*.json")),
            "no_training_count_limit": True, "reference_lines_are_optimal_defense_proofs": False}


def training_manifest(root: Path, training, validation) -> dict:
    """Every corpus record is accounted for, including held-out references."""
    entries = []
    for split, rows in (("training", training), ("validation", validation)):
        for row in rows:
            entries.append({"id": row["id"], "split": split, "family": row["family"],
                            "source_id": row.get("source_id", "local"), "sha256": digest(row),
                            "move_examples": sum(len(line) for line in row["solutions"])})
    if len(entries) != len(records(root)):
        raise ValueError("Training manifest omitted corpus records")
    return {"schema": "gostone.training-data-manifest/1", "records": entries,
            "total_records": len(entries), "corpus_hash": digest(records(root))}
