from __future__ import annotations

import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess
import time
import urllib.parse
import urllib.request

from .common import atomic_json, digest, read_json
from .common import CATEGORIES, canonical

# Multiple editions are indexed for cross-checking, never counted as new tasks.
SCAN_SOURCES = [
    {"id": "guanzipu-anthology", "title": "GGZBCK468 橘中祕 官子譜 居易堂圍棋譜.pdf",
     "collection": "guanzipu", "rights_status": "old-original-pd-scan", "training_status": "needs-page-and-diagram-review",
     "note": "Mixed anthology: includes Chinese chess and other Go books. Do not treat every grid as a Guanzipu problem."},
    *[{"id": f"guanzipu-cadal-{i}", "title": f"CADAL020951{38+i}_官子譜（{label}）.djvu",
       "collection": "guanzipu", "rights_status": "territory-review-needed", "training_status": "blocked-rights-review",
       "note": "Alternate edition; deduplicate against original anthology."} for i, label in enumerate("一二三", 1)],
    *[{"id": f"xuanxuan-{i}", "title": f"AMDIHA-403・64 玄玄棊經 第{i}冊.pdf",
       "collection": "xuanxuan", "rights_status": "old-original-pd-scan", "training_status": "needs-page-and-diagram-review",
       "note": "Historical original; preserve written coordinate answers and missing-leaf warnings."} for i in range(1, 7)],
    {"id": "gokyo-original-1", "title": "NDL861149 碁経衆妙 1.pdf", "collection": "gokyo",
     "rights_status": "old-original-pd-scan", "training_status": "needs-page-and-diagram-review",
     "note": "Original question diagrams; not a standalone solved training corpus."},
    *[{"id": f"gokyo-answers-{i}", "title": f"NDL8611{57+i} 碁経衆妙問題答案 - 開発珍瓏 {label}.pdf",
       "collection": "gokyo", "rights_status": "author-life-dates-unresolved", "training_status": "blocked-rights-review",
       "note": "Historical answers by Kumagai Genrei; Japanese PD marking is not sufficient evidence of German clearance."}
      for i, label in enumerate("上中下", 1)],
]


def request_json(url):
    request = urllib.request.Request(url, headers={"User-Agent": "GoStonePuzzleResearch/0.1 (local historical transcription)"})
    with urllib.request.urlopen(request, timeout=45) as response:
        return json.load(response)


def scan_inventory(root: Path):
    result = read_json(root / "scans/inventory.json", {"sources": []})
    saved = {row["id"]: row for row in result["sources"]}
    return {"schema": "gostone.scan-inventory/1", "sources": [saved.get(row["id"], row.copy()) for row in SCAN_SOURCES]}


def download_scans(root: Path, selected=None):
    inventory = scan_inventory(root)
    for source in inventory["sources"]:
        if selected and source["id"] not in selected:
            continue
        try:
            query = urllib.parse.urlencode({"action": "query", "format": "json", "prop": "imageinfo",
                      "iiprop": "url|size|sha1", "titles": "File:"+source["title"]})
            data = request_json("https://commons.wikimedia.org/w/api.php?"+query)
            pages = list(data["query"]["pages"].values())
            info = pages[0].get("imageinfo", [{}])[0]
            if not info.get("url"):
                raise ValueError("Source file not found; no substitute edition was selected automatically")
            suffix = ".djvu" if source["title"].endswith(".djvu") else ".pdf"
            path = root / "scans/originals" / (source["id"]+suffix)
            path.parent.mkdir(parents=True, exist_ok=True)
            source.update(url=info["url"], description_url=info["descriptionurl"],
                          expected_bytes=info["size"], pages=info.get("pagecount"), sha1=info["sha1"],
                          relative_path=str(path.relative_to(root)).replace("\\", "/"))
            if not path.exists() or path.stat().st_size != info["size"]:
                temporary = path.with_suffix(suffix+".part")
                request = urllib.request.Request(info["url"], headers={"User-Agent": "GoStonePuzzleResearch/0.1"})
                with urllib.request.urlopen(request, timeout=60) as response, temporary.open("wb") as output:
                    while chunk := response.read(1024*1024):
                        output.write(chunk)
                if temporary.stat().st_size != info["size"]:
                    raise ValueError("Incomplete source download")
                temporary.replace(path)
            actual = hashlib.sha1(path.read_bytes()).hexdigest()
            if actual != info["sha1"]:
                raise ValueError("Source checksum mismatch")
            source.update(download_status="complete", checksum_verified=True)
            source.pop("error", None)
            print(f"Scan {source['id']}: {source.get('pages')} pages, checksum verified", flush=True)
        except Exception as error:
            source.update(download_status="failed", error=str(error)[:500])
            print(f"Scan {source['id']}: {error}", flush=True)
        atomic_json(root / "scans/inventory.json", inventory)
    return inventory


def page_image(root: Path, source_id: str, page: int) -> Path:
    """Commons' PDF/DjVu renderer supports both formats with original page indices."""
    inventory = scan_inventory(root)
    source = next(row for row in inventory["sources"] if row["id"] == source_id)
    if not 1 <= page <= int(source.get("pages") or 10000):
        raise ValueError("Invalid scan page")
    destination = root / "scans/pages" / source_id / f"{page:04d}.jpg"
    if destination.exists():
        return destination
    query = urllib.parse.urlencode({"action": "query", "format": "json", "prop": "imageinfo",
              "iiprop": "url", "iiurlwidth": 1600, "iiurlparam": f"page{page}-1600px",
              "titles": "File:"+source["title"]})
    data = request_json("https://commons.wikimedia.org/w/api.php?"+query)
    info = next(iter(data["query"]["pages"].values()))["imageinfo"][0]
    url = info.get("thumburl")
    if not url:
        raise ValueError("No rendered page available")
    destination.parent.mkdir(parents=True, exist_ok=True)
    request = urllib.request.Request(url, headers={"User-Agent": "GoStonePuzzleResearch/0.1"})
    with urllib.request.urlopen(request, timeout=45) as response:
        payload = response.read(15_000_000)
    if not payload.startswith((b"\xff\xd8", b"\x89PNG")):
        raise ValueError("Renderer did not return an image")
    destination.write_bytes(payload)
    return destination


def register_transcription(root: Path, item: dict):
    """Keep scan recognition separate until position, move numbers and source pass review."""
    source = next(row for row in scan_inventory(root)["sources"] if row["id"] == item["source_id"])
    page = int(item["page"])
    if not 1 <= page <= int(source.get("pages") or 10000):
        raise ValueError("Invalid page")
    identifier = digest((item["source_id"], page, item["diagram_label"]))[:24]
    value = {"id": identifier, "source_id": source["id"], "page": page,
             "diagram_label": str(item["diagram_label"])[:100],
             "board": item.get("board"), "to_play": item.get("to_play"),
             "solutions": item.get("solutions", []), "grid": item.get("grid"),
             "category": item.get("category"),
             "notes": str(item.get("notes", ""))[:4000], "review_status": "pending",
             "training_eligible": False, "updated_at": time.time(),
             "rights_status": source["rights_status"]}
    if value["board"] is not None:
        from .rules import State
        initial = State.setup(19, value["board"], value["to_play"])
        for line in value["solutions"]:
            position = initial
            for move in line:
                position = position.play(move)
    atomic_json(root / "scans/transcriptions" / (identifier+".json"), value)
    return value


def approve_transcription(root: Path, identifier: str, reviewer: str, checks: dict):
    if not re.fullmatch(r"[a-f0-9]{24}", identifier) or not reviewer.strip():
        raise ValueError("A valid transcription and named reviewer are required")
    if not all(checks.get(name) is True for name in ("position", "solution", "source")):
        raise ValueError("Original position, numbered solution and source must each be visually checked")
    path=root/"scans/transcriptions"/(identifier+".json")
    item=read_json(path)
    if not item:
        raise ValueError("Transcription does not exist")
    source=next(row for row in scan_inventory(root)["sources"] if row["id"]==item["source_id"])
    if source["rights_status"] != "old-original-pd-scan":
        raise ValueError("Source rights are not cleared for this corpus")
    if item.get("category") not in CATEGORIES or not item.get("solutions"):
        raise ValueError("A precise category and historical solution are required")
    from .rules import State
    from .historical import infer_targets
    initial=State.setup(19,item["board"],item["to_play"])
    for line in item["solutions"]:
        state=initial
        if not line:
            raise ValueError("Empty solution")
        for move in line:
            state=state.play(move)
    corpus_path=root/"data/corpus.json"
    corpus=read_json(corpus_path,{"schema":"gostone.puzzle-corpus/1","sources":[],"records":[],"quarantine":[]})
    family=canonical(item["board"],19,item["to_play"])
    if any(row["id"]=="scan-"+identifier for row in corpus["records"]):
        raise ValueError("Duplicate transcription ID; corrections require a new reviewed revision and corpus audit")
    if any(row["family"]==family for row in corpus["records"]):
        raise ValueError("Duplicate historical position; alternate editions do not create new training families")
    row={"id":"scan-"+identifier,"family":family,"size":19,"board":item["board"],
         "to_play":item["to_play"],"category":item["category"],"solutions":item["solutions"],
         "targets":infer_targets(item["board"],item["to_play"],item["category"],item["solutions"][0][0]),
         "target_status":"heuristic-needs-review","source_id":source["id"],
         "source_locator":f"page {item['page']} / {item['diagram_label']}",
         "status":"visually-reviewed-historical-reference","proof_status":"unproved",
         "transcription_review":{"reviewer":reviewer,"checks":checks}}
    if not any(row["id"]==source["id"] for row in corpus["sources"]):
        corpus["sources"].append({**source,"reviewed_territories":["DE","US"],
            "rights_basis":"Ancient original content from the recorded PD-scan; modern editorial additions excluded. No worldwide clearance asserted."})
    corpus["records"].append(row)
    corpus["content_hash"]=digest(corpus["records"])
    atomic_json(corpus_path,corpus)
    source_index=read_json(root/"data/sources.json",{})
    source_index["sources"]=corpus["sources"]
    atomic_json(root/"data/sources.json",source_index)
    item.update(review_status="approved-reference",training_eligible=True,reviewer=reviewer,checks=checks)
    atomic_json(path,item)
    return {"added":row["id"],"corpus_records":len(corpus["records"])}


def render_scans(root: Path, renderer: str | None = None, selected=None):
    """Render every PDF leaf locally. Recognition/review remains a separate stage."""
    renderer = renderer or shutil.which("pdftoppm")
    if not renderer:
        raise ValueError("Poppler pdftoppm is needed for bulk PDF rendering; scan-page review also supports Commons rendering")
    report = {"sources": [], "rendered_pages": 0, "status": "running"}
    for source in scan_inventory(root)["sources"]:
        if selected and source["id"] not in selected:
            continue
        if source.get("download_status") != "complete":
            continue
        path = root / source["relative_path"]
        destination = root / "scans/pages" / source["id"]
        destination.mkdir(parents=True, exist_ok=True)
        if path.suffix == ".djvu":
            report["sources"].append({"id": source["id"], "status": "alternate-edition-online-renderer", "pages": source["pages"]})
            continue
        for page in range(1, source["pages"]+1):
            if (root / "stop-scans.flag").exists():
                report["status"] = "stopped"
                atomic_json(root / "scans/render-progress.json", report)
                return report
            output = destination / f"{page:04d}"
            if not output.with_suffix(".jpg").exists():
                subprocess.run([str(renderer), "-f", str(page), "-l", str(page), "-singlefile", "-scale-to", "1600",
                                "-jpeg", "-jpegopt", "quality=88", str(path), str(output)],
                               check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, timeout=45)
            report["rendered_pages"] += 1
            if page % 10 == 0:
                atomic_json(root / "scans/render-progress.json", {**report, "current_source": source["id"], "current_page": page})
        report["sources"].append({"id": source["id"], "status": "rendered-needs-transcription", "pages": source["pages"]})
        print(f"Rendered {source['id']}: {source['pages']} pages", flush=True)
    report["status"] = "completed"
    atomic_json(root / "scans/render-progress.json", report)
    return report
