from __future__ import annotations

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import mimetypes
from pathlib import Path
import secrets
import re
import subprocess
import sys
import threading
import time
from urllib.parse import parse_qs, urlsplit
import webbrowser

from .common import ROOT, read_json, records
from .scans import page_image, register_transcription, scan_inventory


class Lab(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, address, root):
        super().__init__(address, Handler)
        self.root = root
        self.token = secrets.token_urlsafe(32)
        self.job = None
        self.job_lock = threading.Lock()

    def start_job(self, arguments):
        with self.job_lock:
            if self.job and self.job.poll() is None:
                raise ValueError("A training/generation job is already running")
            if (self.root/"writer.lock").exists():
                raise ValueError("A CLI run or retained writer lock already owns this workspace")
            if (self.root/"composer.lock").exists():
                raise ValueError("A continuing composition run already owns this workspace")
            self.root.mkdir(parents=True, exist_ok=True)
            log = (self.root / "job.log").open("w", encoding="utf-8")
            try:
                self.job = subprocess.Popen([sys.executable, "-m", "training.gostone_puzzles", "--root", str(self.root), *arguments],
                    cwd=ROOT.parent.parent, stdout=log, stderr=subprocess.STDOUT,
                    creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0)
            finally:
                log.close()
            return {"pid": self.job.pid, "command": arguments[0]}


class Handler(BaseHTTPRequestHandler):
    server: Lab

    def log_message(self, format, *args):
        pass

    def respond(self, status, data, content_type="application/json; charset=utf-8"):
        payload = json.dumps(data, ensure_ascii=False).encode() if content_type.startswith("application/json") else data
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Content-Security-Policy", "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; frame-ancestors 'none'")
        self.end_headers()
        self.wfile.write(payload)

    def valid_host(self):
        return self.headers.get("Host") in (f"127.0.0.1:{self.server.server_port}", f"localhost:{self.server.server_port}")

    def do_GET(self):
        if not self.valid_host():
            return self.respond(403, {"error": "Invalid local Host header"})
        parsed = urlsplit(self.path)
        query = parse_qs(parsed.query)
        root = self.server.root
        try:
            if parsed.path == "/api/state":
                reports = {path.parent.name: read_json(path) for path in sorted((root / "models").glob("*/report.json"))}
                candidates = []
                for path in sorted((root / "candidates").glob("*.json"), key=lambda p: p.stat().st_mtime, reverse=True)[:120]:
                    row = read_json(path)
                    # Large proofs remain on disk; the browser needs only their summary.
                    row["verification"] = {k: v for k, v in row.get("verification", {}).items()
                                           if k not in ("certificate", "minimum_depth_certificate", "wrong_variations", "first_move_refutations")}
                    row["feedback"] = read_json(root / "reviews" / (row["id"]+".json"))
                    candidates.append(row)
                job = self.server.job
                external_writer = read_json(root/"writer.lock") or read_json(root/"composer.lock")
                log_path = root / "job.log"
                log = log_path.read_text(encoding="utf-8", errors="replace")[-6000:] if log_path.exists() else ""
                return self.respond(200, {"token": self.server.token, "root": str(root), "models": reports,
                    "references": records(root), "candidates": candidates, "scans": scan_inventory(root),
                    "job": {"running": (job is not None and job.poll() is None) or bool(external_writer),
                            "external_writer":external_writer,
                            "log":log or ("Ein CLI-Lauf belegt diesen Arbeitsbestand. Fortschritt steht bei den Modellberichten." if external_writer else "")},
                    "generation": read_json(root / "generation-progress.json"),
                    "composition":read_json(root/"composition-progress.json"),
                    "scan_progress": read_json(root / "scans/render-progress.json"),
                    "recognition_progress": read_json(root / "scans/recognition-progress.json")})
            if parsed.path == "/api/scan-proposal":
                source_id=query["source"][0]
                if source_id not in {source["id"] for source in scan_inventory(root)["sources"]}:
                    raise ValueError("Unknown scan source")
                page=int(query["page"][0])
                if not 1<=page<=10000:
                    raise ValueError("Invalid page")
                return self.respond(200,read_json(root/"scans/recognition"/source_id/f"{page:04d}.json",{"diagrams":[]}))
            if parsed.path == "/api/scan-image":
                path = page_image(root, query["source"][0], int(query["page"][0]))
                return self.respond(200, path.read_bytes(), "image/jpeg")
            if parsed.path == "/api/replay":
                from .rules import State
                identifier=query["id"][0]
                if query.get("reference",["0"])[0] == "1":
                    row=next(row for row in records(root) if row["id"]==identifier)
                    variant=int(query.get("variant",["0"])[0])
                    if not 0<=variant<len(row["solutions"]):
                        raise ValueError("Invalid reference variation")
                    line=[{"color":row["to_play"] if i%2==0 else 3-row["to_play"],"move":move}
                          for i,move in enumerate(row["solutions"][variant])]
                else:
                    if len(identifier)!=24 or any(c not in "0123456789abcdef" for c in identifier):
                        raise ValueError("Invalid candidate ID")
                    row=read_json(root/"candidates"/(identifier+".json"))
                    if not row:
                        raise ValueError("Candidate does not exist")
                    line=row["verification"].get("solution",[])
                if len(line)>128:
                    raise ValueError("Demonstration is too long")
                position=State.setup(19,row["board"],row["to_play"],row.get("targets",[]))
                snapshots=[{"board":position.stones,"targets":sorted(position.targets),"move":None,"ply":0}]
                for ply,move in enumerate(line,1):
                    if move["color"]!=position.to_play:
                        raise ValueError("Wrong demonstration color")
                    position=position.play(move["move"])
                    snapshots.append({"board":position.stones,"targets":sorted(position.targets),"move":{**move,"number":ply},"ply":ply})
                return self.respond(200,{"snapshots":snapshots,"reference":query.get("reference",["0"])[0]=="1"})
            names = {"/": "index.html", "/app.js": "app.js", "/style.css": "style.css"}
            if parsed.path in names:
                path = ROOT / "static" / names[parsed.path]
                return self.respond(200, path.read_bytes(), mimetypes.guess_type(path)[0]+"; charset=utf-8")
            self.respond(404, {"error": "Not found"})
        except (ValueError, KeyError, StopIteration, OSError) as error:
            self.respond(400, {"error": str(error)})

    def do_POST(self):
        expected = {f"http://127.0.0.1:{self.server.server_port}", f"http://localhost:{self.server.server_port}"}
        if not self.valid_host() or self.headers.get("X-Lab-Token") != self.server.token or self.headers.get("Origin") not in expected:
            return self.respond(403, {"error": "Invalid local request token or origin"})
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= 100000:
                raise ValueError("Invalid request size")
            data = json.loads(self.rfile.read(length))
            path = urlsplit(self.path).path
            root = self.server.root
            if path == "/api/feedback":
                from .generate import review, UNSET
                result = review(root, data["id"], data["rating"], data.get("note", ""), data.get("tags", []), data.get("kyu",UNSET))
            elif path == "/api/transcription":
                result = register_transcription(root, data)
            elif path == "/api/job":
                action = data["action"]
                if action == "train":
                    approach = data.get("approach", "joint")
                    if approach not in ("joint", "denoise"):
                        raise ValueError("Invalid approach")
                    steps = int(data.get("steps", 500))
                    if not 1 <= steps <= 10000:
                        raise ValueError("Choose 1–10000 training steps")
                    (root / "stop-training.flag").unlink(missing_ok=True)
                    arguments = ["train", "--approach", approach, "--steps", str(steps)]
                    run_name = data.get("run_name") or approach
                    if not re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}", run_name):
                        raise ValueError("Invalid training run name")
                    arguments += ["--run-name", run_name]
                    checkpoint = root / "models" / run_name / "checkpoint.pt"
                    if data.get("resume", True) and checkpoint.exists():
                        arguments += ["--resume", str(checkpoint)]
                elif action == "generate":
                    approach = data.get("approach", "joint")
                    count = int(data.get("attempts", 30))
                    depth = int(data.get("own_moves", 3))
                    category=data.get("category")
                    if category not in (None,"life","kill","connect","semeai"):
                        raise ValueError("Unsupported puzzle objective")
                    kyu_min,kyu_max = int(data.get("kyu_min",10)),int(data.get("kyu_max",20))
                    proof_seconds = float(data.get("proof_seconds",2))
                    if approach not in ("joint", "denoise", "mutation", "fresh") or not 1 <= count <= 10000 or not 1 <= depth <= 8:
                        raise ValueError("Invalid generation settings")
                    if not 1 <= kyu_min <= kyu_max <= 30 or not 0 < proof_seconds <= 600:
                        raise ValueError("Invalid Kyu range or proof budget")
                    (root / "stop-generation.flag").unlink(missing_ok=True)
                    arguments = ["generate", "--approach", approach, "--attempts", str(count), "--own-moves", str(depth),
                                 "--seed", str(int(time.time())),"--kyu-min",str(kyu_min),"--kyu-max",str(kyu_max),
                                 "--proof-seconds",str(proof_seconds),"--proof-nodes","100000"]
                    if category:
                        arguments += ["--category",category]
                    run_name = data.get("model_run")
                    if run_name and approach != "mutation":
                        if not re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}", run_name):
                            raise ValueError("Invalid model run name")
                        report = read_json(root/"models"/run_name/"report.json")
                        if not report or report.get("approach") != ("joint" if approach == "fresh" else approach):
                            raise ValueError("Choose a trained model for this approach")
                        folder = root/"models"/run_name
                        checkpoint = folder/"best.pt" if (folder/"best.pt").exists() else folder/"checkpoint.pt"
                        arguments += ["--checkpoint", str(checkpoint)]
                elif action == "compose":
                    target=int(data.get("target",150))
                    depth=int(data.get("own_moves",3))
                    low,high=int(data.get("kyu_min",10)),int(data.get("kyu_max",20))
                    run_name=data.get("model_run")
                    if (not 1 <= target <= 10000 or not 1 <= depth <= 8 or not 1 <= low <= high <= 30
                            or not isinstance(run_name,str) or not re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}",run_name)):
                        raise ValueError("Invalid continuing composition settings")
                    report=read_json(root/"models"/run_name/"report.json")
                    if not report or report.get("approach") != "joint":
                        raise ValueError("Choose a trained joint composition model")
                    folder=root/"models"/run_name
                    checkpoint=folder/"best.pt" if (folder/"best.pt").exists() else folder/"checkpoint.pt"
                    arguments=["compose","--checkpoint",str(checkpoint),"--target",str(target),
                               "--own-moves",str(depth),"--kyu-min",str(low),"--kyu-max",str(high),"--batch-size","250"]
                elif action == "download-scans":
                    arguments = ["download-scans"]
                else:
                    raise ValueError("Unknown job")
                result = self.server.start_job(arguments)
            elif path == "/api/stop":
                (root / "stop-training.flag").touch()
                (root / "stop-generation.flag").touch()
                (root / "stop-composition.flag").touch()
                result = {"status": "stop-requested; checkpoint will be saved"}
            else:
                return self.respond(404, {"error": "Not found"})
            self.respond(200, result)
        except (ValueError, KeyError, TypeError, OSError) as error:
            self.respond(400, {"error": str(error)})


def serve(root: Path, port=4186, open_browser=True):
    server = Lab(("127.0.0.1", port), root)
    url = f"http://127.0.0.1:{server.server_port}"
    print(f"Puzzle AI Lab: {url}\nData: {root}", flush=True)
    if open_browser:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        if server.job and server.job.poll() is None:
            (root / "stop-training.flag").touch()
            (root / "stop-generation.flag").touch()
    finally:
        server.server_close()
