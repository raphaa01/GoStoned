"""Static visual review artifacts; pictures and move replays, never auto approval."""
from __future__ import annotations

from collections import Counter
import hashlib
import html
import json
from pathlib import Path

from .common import ROOT, atomic_json, canonical, digest, read_json, records
from .corpus import sgf_points
from .rules import State, group


def board_svg(board, moves=(), targets=(), anchors=()):
    size, margin, step = 440, 22, 22
    parts = [f'<svg viewBox="0 0 {size} {size}" role="img" aria-label="Go-Stellung"><rect width="440" height="440" fill="#d3b17c"/>']
    for i in range(19):
        p = margin+i*step
        parts.append(f'<path d="M{p} 22V418 M22 {p}H418" stroke="#69532d" stroke-width=".65"/>')
    labels = {m["move"]: (m["color"], i+1) for i, m in enumerate(moves) if m["move"] >= 0}
    for point in range(361):
        color = labels[point][0] if point in labels else board[point]
        if not color:
            continue
        x, y = margin+point % 19*step, margin+point//19*step
        parts.append(f'<circle cx="{x}" cy="{y}" r="10" fill="{"#131a19" if color == 1 else "#faf8ef"}" stroke="#343731" stroke-width=".7"/>')
        if point in targets:
            stroke="#20836c" if anchors and point in anchors[0] else "#d15b21"
            parts.append(f'<circle cx="{x}" cy="{y}" r="5" fill="none" stroke="{stroke}" stroke-width="2"/>')
        if point in labels:
            parts.append(f'<text x="{x}" y="{y+4}" text-anchor="middle" font-size="12" font-family="sans-serif" fill="{"white" if color == 1 else "black"}">{labels[point][1]}</text>')
    return "".join(parts)+"</svg>"


def position_facts(board):
    checked, groups = set(), []
    for point, color in enumerate(board):
        if color and point not in checked:
            chain, liberties = group(tuple(board), 19, point)
            checked.update(chain)
            groups.append({"color": color, "stones": len(chain), "liberties": len(liberties)})
    return {"stones": sum(bool(c) for c in board), "groups": groups,
            "groups_in_atari": sum(g["liberties"] == 1 for g in groups)}


def write_quality_report(root: Path, destination: Path, candidate_roots=()):
    from PIL import Image
    destination = destination.resolve()
    if destination.exists() and any(destination.iterdir()):
        raise ValueError("Choose a new visual-review directory; earlier evidence is preserved")
    destination.mkdir(parents=True, exist_ok=True)
    (destination/"assets").mkdir(exist_ok=True)
    # Coordinates read from this pinned 3200-pixel rendering of the original
    # leaf. These frame boxes are only for visual comparison, not OCR labels.
    frames = {"A": ((220,596),(1082,591),(1087,1437),(229,1431)),
              "B": ((1180,595),(2053,595),(2053,1430),(1185,1430)),
              "C": ((235,2188),(1095,2177),(1114,3016),(252,3033)),
              "D": ((1197,2179),(2063,2175),(2082,3004),(1215,3020))}
    sections, evidence = [], []
    documents=[read_json(path) for path in sorted((ROOT/"transcriptions").glob("*.json"))]
    originals=[(document,item) for document in documents for item in document["records"]]
    source_hashes={}
    for i, (document,item) in enumerate(originals):
        source=root/"scans/pages"/item["source_id"]/f"{item['page']:04d}.jpg"
        page=Image.open(source).convert("RGB")
        source_hashes[f"{item['source_id']}/{item['page']}"]=hashlib.sha256(source.read_bytes()).hexdigest()
        board = [0]*361
        for color, field in ((1,"black"),(2,"white")):
            for point in sgf_points(item[field]):
                board[point] = color
        line = sgf_points(item["solutions"][0])
        numbered = [{"color": item["to_play"] if j % 2 == 0 else 3-item["to_play"], "move": p} for j,p in enumerate(line)]
        state, captures = State.setup(19,board,item["to_play"]), []
        for j, move in enumerate(line):
            child = state.play(move)
            removed = sum(a != 0 and b == 0 for a,b in zip(state.stones,child.stones))
            if removed:
                captures.append({"ply":j+1,"stones":removed})
            state = child
        points = [p for p,c in enumerate(board) if c]+line
        xs, ys = [p % 19 for p in points], [p//19 for p in points]
        left, right = max(-.5,min(xs)-.75), min(18.5,max(xs)+.75)
        top, bottom = max(-.5,min(ys)-.75), min(18.5,max(ys)+.75)
        a,b,c,d = document.get("frames",frames)[item["label"].split("-")[1]]
        render_width,render_height=document.get("render_dimensions",(2218,3200))
        def pixel(x,y):
            x,y = x/18,y/18
            return tuple(((1-x)*(1-y)*a[k]+x*(1-y)*b[k]+x*y*c[k]+(1-x)*y*d[k])*
                         (page.width/render_width if k == 0 else page.height/render_height) for k in range(2))
        corners = [pixel(x,y) for x,y in ((left,top),(right,top),(left,bottom),(right,bottom))]
        box = (int(min(x for x,y in corners)),int(min(y for x,y in corners)),
               int(max(x for x,y in corners))+1,int(max(y for x,y in corners))+1)
        crop = page.crop(box)
        filename = f"source-{i+1}.png"
        crop.resize((max(1,crop.width*2),max(1,crop.height*2))).save(destination/"assets"/filename)
        facts = {"kind":"historical-transcription","label":item["label"],"family":canonical(board,19,item["to_play"]),
                 "reference_plies":len(line),"captures":captures,"position":position_facts(board),
                 "optimal_defense_proven":False,"professional_review":False}
        evidence.append(facts)
        capture_text = ", ".join(f"Zug {c['ply']}: {c['stones']} Stein" for c in captures) or "keine"
        sections.append(f'<section id="reference-{i+1}"><h2>{html.escape(item["label"])}</h2><p>Originalseite {item["page"]} · {"Schwarz" if item["to_play"] == 1 else "Weiß"} beginnt · {len(line)} Halbzüge · Schläge im tatsächlichen Verlauf: {capture_text}.</p><div class="four"><figure><img src="assets/{filename}" alt="Ausschnitt aus dem historischen Original"><figcaption>Original, nummerierte Steine gehören bereits zur Antwort</figcaption></figure><figure>{board_svg(board)}<figcaption>Übertragene Ausgangslage</figcaption></figure><figure>{board_svg(board,numbered)}<figcaption>Referenzziffern wie im Druck, einschließlich später geschlagener Züge</figcaption></figure><figure>{board_svg(state.stones)}<figcaption>Tatsächlich ausgespieltes Ende mit Schlagregeln</figcaption></figure></div><p class="notice">Historische Referenz, kein Beweis stärkster Gegenwehr. Die genaue Gewinnbedingung bleibt offen.</p></section>')
    counts = {}
    for candidate_root in candidate_roots:
        rows = sorted((read_json(path) for path in (Path(candidate_root)/"candidates").glob("*.json")),
                      key=lambda r:r.get("attempt",0))
        label = Path(candidate_root).name
        counts[label] = dict(Counter(row["verification"]["status"] for row in rows))
        # First six surviving proposals plus every proved win. Selection is
        # explicit so an attractive subset cannot conceal the failure rate.
        selected = rows[:6]+[row for row in rows[6:] if row["verification"]["status"] == "proven-win"]
        for row in selected:
            verification = row["verification"]
            result = {"kind":"model-candidate","run":label,"id":row["id"],"attempt":row["attempt"],
                      "model_run":row.get("model_run"),"status":verification["status"],
                      "export_eligible":verification.get("export_eligible",False),
                      "fixed_reference_stones":row.get("reference_stones_fixed",True),
                      "target_stones":len(row["targets"]),
                      "requested_own_moves":row["requested_own_moves"],
                      "demonstrated_own_moves":sum(m["color"] == row["to_play"] for m in verification.get("solution",[])),
                      "minimum_depth_certified":verification.get("minimum_depth_certified",False),
                      "export_blockers":verification.get("export_blockers",[]),
                      "difficulty":row.get("difficulty"),
                      "position":position_facts(row["board"]),"human_approved":False}
            evidence.append(result)
            mainline = verification.get("solution",[])
            end = State.setup(19,row["board"],row["to_play"],row["targets"])
            for move in mainline:
                end = end.play(move["move"])
            alternative = board_svg(end.stones) if mainline else '<p class="unresolved">Kein bewiesener Lösungsverlauf vorhanden.</p>'
            numbered = board_svg(row["board"],mainline,targets=row["targets"]) if mainline else '<p class="unresolved">Keine bewiesene Hauptfolge.</p>'
            sections.append(f'<section id="candidate-{html.escape(label)}-{row["id"]}"><h2>{html.escape(label)} · Versuch {row["attempt"]+1}</h2><p>{"Schwarz" if row["to_play"] == 1 else "Weiß"} beginnt · {html.escape(row["category"])} · {html.escape(verification["status"])} · Beweisvorgaben erfüllt: {result["export_eligible"]}</p><div class="three"><figure>{board_svg(row["board"],targets=row["targets"])}<figcaption>Erzeugte Ausgangslage · Zielsteine orange markiert</figcaption></figure><figure>{numbered}<figcaption>Bewiesene Hauptfolge, Ziffern wie im Aufgabenbuch</figcaption></figure><figure>{alternative}<figcaption>Tatsächlich ausgespieltes Ende</figcaption></figure></div><p>Eigene Züge: {result["demonstrated_own_moves"]} / gewünscht {result["requested_own_moves"]}; Mindesttiefe bewiesen: {result["minimum_depth_certified"]}. Steine: {result["position"]["stones"]}; Zielsteine: {result["target_stones"]}; Gruppen in Atari: {result["position"]["groups_in_atari"]}. Vorgegebene Referenzsteine: {result["fixed_reference_stones"]}.</p><p class="notice">Ein plausibles Bild belegt keine korrekte oder gute Aufgabe. Keine menschliche Freigabe.</p></section>')
    document = '<!doctype html><html lang="de"><meta charset="utf-8"><title>GoStone – visuelle Puzzleprüfung</title><style>body{font:16px system-ui;margin:24px;background:#f3f0e7;color:#202920}h1{font-size:28px}section{background:white;padding:20px;margin:20px 0;break-inside:avoid;border-radius:12px}.four{display:grid;grid-template-columns:repeat(4,1fr);gap:16px}.three{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:24px}@media(max-width:800px){.four,.three{grid-template-columns:1fr}}figure{margin:0}svg{width:100%;display:block}img{width:100%;height:345px;object-fit:contain;background:#fff}figcaption{font-size:13px;margin-top:8px}.notice{color:#7a4328}.unresolved{padding:60px;background:#eee}pre{white-space:pre-wrap}</style><h1>Visuelle Prüfung: historische Übertragung und Modellvorschläge</h1><p>Bildauswahl: sämtliche geprüften Übertragungen, die ersten sechs gespeicherten Vorschläge je Vergleichslauf und alle nachgewiesenen Gewinne. Keine automatische Qualitätsfreigabe.</p><pre>'+html.escape(json.dumps(counts,indent=2))+'</pre>'+"".join(sections)+'</html>'
    (destination/"index.html").write_text(document,encoding="utf-8")
    manifest = {"schema":"gostone.visual-quality-review/1","corpus_hash":digest(records(root)),
                "source_pages_sha256":source_hashes,"candidate_counts":counts,
                "cases":evidence,"screenshots_are_separate_browser_artifacts":True}
    atomic_json(destination/"review.json",manifest)
    return {"html":str(destination/"index.html"),"cases":len(evidence),"counts":counts}
