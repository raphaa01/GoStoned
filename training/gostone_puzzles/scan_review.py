"""Source/reading review sheets for bulk transcription, with no auto approval."""
from __future__ import annotations

import html
import json
from pathlib import Path

from .common import atomic_json, canonical, read_json, solution_fingerprint
from .quality import board_svg


def write_reader_review(directory: Path):
    from PIL import Image
    directory = directory.resolve()
    report = read_json(directory/"progress.json")
    if not report or report.get("schema") != "gostone.assisted-scan-batch/1":
        raise ValueError("Choose an assisted scan batch")
    destination = directory/"review"
    destination.mkdir(exist_ok=True)
    style = ('body{font:16px system-ui;background:#f3f0e7;color:#202920;margin:24px}'
             'section{background:white;padding:20px;margin:24px 0;break-inside:avoid}'
             '.boards{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:20px}'
             'figure{margin:0}svg,img{width:100%;display:block}figcaption{margin-top:8px}'
             'img{object-fit:contain;max-height:440px}.notice{color:#93451d}'
             'details{margin:12px 0}pre{white-space:pre-wrap}a{color:#175d47}'
             '@media(max-width:800px){.boards{grid-template-columns:1fr}}')
    summary = {"schema": "gostone.assisted-scan-review/1", "pages": [], "drafts": 0,
               "unique_proposed_boards": 0, "unique_proposed_move_patterns": 0,
               "approved_training_records": 0, "training_eligible": False,
               "optical_batch": report}
    families, patterns = set(), set()
    for path in sorted(directory.glob("[0-9][0-9][0-9][0-9].json")):
        page = read_json(path)
        if page.get("model_sha256") != report["model_sha256"]:
            continue
        sections, page_drafts = [], 0
        for frame in page["frames"]:
            warped = Image.open(directory/f"{page['page']:04d}-{frame['index']}.png")
            for draft in frame["drafts"]:
                points = draft["printed_points"]
                left, right = max(0, min(p % 19 for p in points)-1), min(18, max(p % 19 for p in points)+1)
                top, bottom = max(0, min(p//19 for p in points)-1), min(18, max(p//19 for p in points)+1)
                filename = draft["id"]+".png"
                warped.crop((left*50, top*50, (right+1)*50, (bottom+1)*50)).save(destination/filename)
                line = [{"color": draft["to_play"] if i % 2 == 0 else 3-draft["to_play"], "move": point}
                        for i, point in enumerate(draft["solutions"][0])]
                # View-only zoom: source positions and rule engine remain 19x19.
                box = f'{11+left*22} {11+top*22} {(right-left+1)*22} {(bottom-top+1)*22}'
                numbered = board_svg(draft["board"], line).replace('viewBox="0 0 440 440"', f'viewBox="{box}"')
                initial = board_svg(draft["board"]).replace('viewBox="0 0 440 440"', f'viewBox="{box}"')
                color = "Schwarz" if draft["to_play"] == 1 else "Weiß"
                coordinates = " ".join(chr(97+m["move"] % 19)+chr(97+m["move"]//19) for m in line)
                sections.append(
                    f'<section id="{draft["id"]}"><h2>Seite {page["page"]} · Rahmen {frame["index"]+1} · Entwurf {page_drafts+1}</h2>'
                    f'<p>{color} beginnt · {len(line)} gedruckte Halbzüge · {len(draft["review_flags"])} optisch auffällige Felder</p>'
                    '<div class="boards">'
                    f'<figure><img src="{filename}" alt="Originalausschnitt mit nummerierter Antwort"><figcaption>Originalscan: auch benachbarte Steine im Bild prüfen</figcaption></figure>'
                    f'<figure>{numbered}<figcaption>Gelesene Druckziffern (noch nicht freigegeben)</figcaption></figure>'
                    f'<figure>{initial}<figcaption>Vorgeschlagene Ausgangslage · Blickausschnitt des 19×19-Bretts</figcaption></figure></div>'
                    f'<p class="notice">Raster und Aufgabengrenze benötigen Sichtprüfung. Ein legaler Verlauf belegt keine korrekte Übertragung. Keine Trainingserlaubnis durch diese Ansicht.</p>'
                    f'<p>SGF-Koordinaten: {coordinates}</p><details><summary>Auffällige Felder und Alternativen</summary><pre>'
                    +html.escape(json.dumps({"flags": draft["review_flags"], "alternatives": draft["alternatives"],
                                            "grid_status": draft["grid_status"], "context": draft["context_status"]}, indent=2))
                    +'</pre></details></section>')
                families.add(canonical(draft["board"], 19, draft["to_play"]))
                pattern = solution_fingerprint(line, draft["to_play"])
                if pattern:
                    patterns.add(pattern)
                page_drafts += 1
        title = f'Originalseite {page["page"]} – Übertragungsprüfung'
        content = ('<!doctype html><html lang="de"><meta charset="utf-8"><title>'+title+'</title><style>'+style+'</style>'
                   '<p><a href="index.html">Alle Seiten</a></p><h1>'+title+'</h1>'
                   f'<p><a href="../{page["page"]:04d}.png">Vollständige Originalseite zur Raster- und Kontextprüfung</a></p>'
                   '<p>Alle Einträge sind ungeprüfte Erkennungsvorschläge. Das Modell erkennt nur Ziffern 1–11; längere Folgen, Wiederbesetzungen und Textvarianten erfordern weitere Übertragung.</p>'
                   +"".join(sections)+'</html>')
        (destination/f"{page['page']:04d}.html").write_text(content, encoding="utf-8")
        summary["pages"].append({"page": page["page"], "drafts": page_drafts})
        summary["drafts"] += page_drafts
    summary["unique_proposed_boards"] = len(families)
    summary["unique_proposed_move_patterns"] = len(patterns)
    atomic_json(destination/"review.json", summary)
    links = ''.join(f'<li><a href="{p["page"]:04d}.html">Originalseite {p["page"]}</a> · {p["drafts"]} Entwürfe</li>' for p in summary["pages"])
    (destination/"index.html").write_text(
        '<!doctype html><html lang="de"><meta charset="utf-8"><title>Stapelübertragung aus Originalscans</title><style>'+style+'</style>'
        '<h1>Stapelübertragung aus Originalscans</h1>'
        f'<p>{summary["drafts"]} ungeprüfte Lesarten auf {len(summary["pages"])} Seiten. '
        f'{summary["unique_proposed_boards"]} unterschiedliche vorgeschlagene Stellungen; '
        f'{summary["unique_proposed_move_patterns"]} unterschiedliche vollständige Zugmuster. Diese Zahlen sind keine Qualitätsfreigabe.</p>'
        '<p class="notice">0 automatisch freigegebene Trainingsaufgaben. Jeden Stein, jede Ziffer, die vollständige Antwort und die Rasterzuordnung am Original prüfen.</p><ul>'
        +links+'</ul></html>', encoding="utf-8")
    return {"html": str(destination/"index.html"), "drafts": summary["drafts"], "pages": len(summary["pages"])}
