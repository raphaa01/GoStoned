from __future__ import annotations

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import mimetypes
from pathlib import Path
import secrets
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
                reports = {name: read_json(root / "models" / name / "report.json") for name in ("joint", "denoise")}
                candidates = []
                for path in sorted((root / "candidates").glob("*.json"), key=lambda p: p.stat().st_mtime, reverse=True)[:120]:
                    row = read_json(path)
                    # Large proofs remain on disk; the browser needs only their summary.
                    row["verification"] = {k: v for k, v in row.get("verification", {}).items()
                                           if k not in ("certificate", "minimum_depth_certificate", "wrong_variations", "first_move_refutations")}
                    row["feedback"] = read_json(root / "reviews" / (row["id"]+".json"))
                    candidates.append(row)
                job = self.server.job
                log_path = root / "job.log"
                log = log_path.read_text(encoding="utf-8", errors="replace")[-6000:] if log_path.exists() else ""
                return self.respond(200, {"token": self.server.token, "root": str(root), "models": reports,
                    "references": records(root), "candidates": candidates, "scans": scan_inventory(root),
                    "job": {"running": job is not None and job.poll() is None, "log": log},
                    "generation": read_json(root / "generation-progress.json"),
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
                from .generate import review
                result = review(root, data["id"], data["rating"], data.get("note", ""), data.get("tags", []))
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
                    checkpoint = root / "models" / approach / "checkpoint.pt"
                    if data.get("resume", True) and checkpoint.exists():
                        arguments += ["--resume", str(checkpoint)]
                elif action == "generate":
                    approach = data.get("approach", "joint")
                    count = int(data.get("attempts", 30))
                    depth = int(data.get("own_moves", 3))
                    if approach not in ("joint", "denoise", "mutation") or not 1 <= count <= 10000 or not 1 <= depth <= 8:
                        raise ValueError("Invalid generation settings")
                    (root / "stop-generation.flag").unlink(missing_ok=True)
                    arguments = ["generate", "--approach", approach, "--attempts", str(count), "--own-moves", str(depth),
                                 "--seed", str(int(time.time()))]
                elif action == "download-scans":
                    arguments = ["download-scans"]
                else:
                    raise ValueError("Unknown job")
                result = self.server.start_job(arguments)
            elif path == "/api/stop":
                (root / "stop-training.flag").touch()
                (root / "stop-generation.flag").touch()
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
