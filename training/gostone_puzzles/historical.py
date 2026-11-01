from __future__ import annotations

import html
import hashlib
from pathlib import Path
import re
import urllib.request

from .common import CATEGORIES, atomic_json, canonical, digest, read_json
from .rules import State, group

SMITH_URL = "https://www.gutenberg.org/files/66632/66632-h/66632-h.htm"
COLUMNS = "ABCDEFGHJKLMNOPQRST"
SOURCE = {
    "id": "smith-1908-original-coordinate-content",
    "title": "The Game of Go (1908), chapter VIII",
    "url": SMITH_URL,
    "author": "Arthur Smith (1870–1929)",
    "earlier_source": "Oskar Korschelt (1853–1940), after historical Japanese problems",
    "rights": "public-domain-original-content",
    "reviewed_territories": ["DE", "US"],
    "attribution_required_for_original_content_in_reviewed_territories": False,
    "commercial_use_of_original_content_in_reviewed_territories": True,
    "rights_basis": "Original publication 1908; authors died more than 70 years ago. Original board facts and historical coordinate answers only.",
    "limits": "No worldwide clearance is asserted. No modern cover, editorial commentary, Gutenberg marks or boilerplate are training content.",
    "answers": "historical-reference; not an exhaustive proof",
}


def text(fragment: str) -> str:
    fragment = re.sub(r'<span\b[^>]*class="pageNum"[^>]*>.*?</span>', "", fragment, flags=re.S)
    return " ".join(html.unescape(re.sub(r"<[^>]+>", " ", fragment)).split())


def coordinates(fragment: str, carry: bool = True) -> list[int]:
    result, column = [], None
    for match in re.finditer(r"(?<![A-Za-z0-9])([A-HJ-T])\s*(\d{1,2})\b|(?<![A-Za-z0-9])(\d{1,2})\b", fragment):
        if match[1]:
            column, row = COLUMNS.index(match[1]), int(match[2])
        elif carry and column is not None:
            row = int(match[3])
        else:
            continue
        if not 1 <= row <= 19:
            raise ValueError(f"Invalid historical coordinate {match[0]}")
        result.append((19-row)*19+column)
    return result


def infer_targets(board, player: int, goal: str, first_move: int, prefer_main=False) -> list[int]:
    if goal not in ("life", "kill"):
        return []
    color = player if goal == "life" else 3-player
    checked, groups = set(), []
    for p, c in enumerate(board):
        if c == color and p not in checked:
            chain, _ = group(tuple(board), 19, p)
            checked.update(chain)
            distance = min(abs(q % 19-first_move % 19)+abs(q//19-first_move//19) for q in chain)
            groups.append(((-len(chain), distance, min(chain), chain) if prefer_main
                           else (distance, -len(chain), min(chain), chain)))
    return sorted(min(groups)[3]) if groups else []


def parse_smith(document: str) -> dict:
    document = re.sub(r'<span\b[^>]*class="corr"[^>]*>(.*?)</span>', r'\1', document, flags=re.S)
    split = re.split(r'<h3[^>]*>\s*SOLUTIONS TO PROBLEMS\s*</h3>', document, flags=re.I)
    if len(split) != 2:
        raise ValueError("Historical source structure changed: missing solution section")
    positions = re.split(r'<h3\b[^>]*>.*?</h3>', split[0], flags=re.S)[-7:]
    answers = re.split(r'<h4\b[^>]*>.*?</h4>', split[1], flags=re.S)[1:8]
    if len(positions) != 7 or len(answers) != 7:
        raise ValueError("Historical source must contain seven matched problem sections")
    records, quarantine = [], []
    expected_counts = (24, 19, 16, 12, 12, 12, 4)
    for section, (position_section, answer_section, category, expected) in enumerate(zip(positions, answers, CATEGORIES, expected_counts), 1):
        solution_map = {}
        for paragraph in re.findall(r'<p\b[^>]*>(.*?)</p>', answer_section, re.S):
            match = re.match(r'\s*<b>(\d+)\.</b>(.*)', paragraph, re.S)
            if match:
                solution_map[int(match[1])] = text(match[2])
        seen = 0
        for paragraph in re.findall(r'<p\b[^>]*>(.*?)</p>', position_section, re.S):
            match = re.match(r'\s*<b>(\d+)\.</b>(.*)', paragraph, re.S)
            if not match:
                continue
            number, raw = int(match[1]), match[2]
            identifier = f"smith1908-{section}-{number:02d}"
            seen += 1
            try:
                italic = re.search(r'<i>\s*(White|Black)\s*</i>', raw)
                if not italic:
                    raise ValueError("Missing explicitly italicized starting color")
                player = 1 if italic[1] == "Black" else 2
                plain = text(raw)
                white = re.search(r'White\s*,(.*?)Black\s*,', plain)
                black = re.search(r'Black\s*,(.*)', plain)
                if not white or not black:
                    raise ValueError("Missing coordinate lists")
                board = [0]*361
                for color, fragment in ((2, white[1]), (1, black[1])):
                    for point in coordinates(fragment):
                        if board[point]:
                            raise ValueError("Repeated or overlapping setup coordinate")
                        board[point] = color
                initial = State.setup(19, board, player)
                reference = solution_map[number]
                variations, rejected = [], []
                for branch in re.split(r'\bor\b', reference):
                    moves = coordinates(branch, carry=False)
                    state = initial
                    try:
                        if not moves:
                            raise ValueError("Empty answer")
                        for move in moves:
                            state = state.play(move)
                        variations.append(moves)
                    except ValueError as error:
                        rejected.append(str(error))
                if not variations:
                    raise ValueError("No legal reference variation: " + "; ".join(rejected))
                targets = infer_targets(board, player, category, variations[0][0])
                records.append({
                    "id": identifier, "family": canonical(board, 19, player), "size": 19,
                    "board": board, "to_play": player, "category": category,
                    "targets": targets, "target_status": "heuristic-needs-review",
                    "solutions": variations, "source_id": SOURCE["id"],
                    "source_locator": f"VIII / {section} / {number}",
                    "status": "historical-reference", "proof_status": "unproved",
                    "excluded_reference_branches": rejected,
                })
            except (ValueError, KeyError) as error:
                quarantine.append({"id": identifier, "reason": str(error)})
        if seen != expected:
            raise ValueError(f"Section {section}: expected {expected} positions, found {seen}")
    return {"schema": "gostone.puzzle-corpus/1", "sources": [SOURCE], "records": records,
            "quarantine": quarantine, "content_hash": digest(records)}


def import_smith(root: Path, local_html: Path | None = None) -> dict:
    if local_html:
        document = local_html.read_text(encoding="utf-8")
    else:
        request = urllib.request.Request(SMITH_URL, headers={"User-Agent": "GoStonePuzzleLab/0.1 historical research"})
        with urllib.request.urlopen(request, timeout=60) as response:
            document = response.read(8_000_000).decode("utf-8")
    corpus = parse_smith(document)
    previous = read_json(root / "data/corpus.json", {"records": [], "sources": []})
    corpus["records"] += [row for row in previous["records"] if row["source_id"] != SOURCE["id"]]
    corpus["sources"] += [source for source in previous["sources"] if source["id"] != SOURCE["id"]]
    corpus["content_hash"] = digest(corpus["records"])
    atomic_json(root / "data/corpus.json", corpus)
    atomic_json(root / "data/sources.json", {"sources": corpus["sources"], "raw_document_sha256": hashlib.sha256(document.encode("utf-8")).hexdigest()})
    return {"imported": len(corpus["records"]), "quarantined": len(corpus["quarantine"]),
            "families": len({row["family"] for row in corpus["records"]}), "content_hash": corpus["content_hash"]}
