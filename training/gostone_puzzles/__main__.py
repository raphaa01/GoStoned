from __future__ import annotations

import argparse
import json
from pathlib import Path
from contextlib import nullcontext

from .common import default_root


def main():
    parser = argparse.ArgumentParser(description="Local, portable Go puzzle AI lab")
    parser.add_argument("--root", type=Path, default=default_root())
    sub = parser.add_subparsers(dest="command", required=True)
    ingest = sub.add_parser("import-historical")
    ingest.add_argument("--html", type=Path)
    training = sub.add_parser("train")
    training.add_argument("--approach", choices=("joint", "denoise"), default="joint")
    training.add_argument("--steps", type=int, default=500)
    training.add_argument("--channels", type=int, default=32)
    training.add_argument("--blocks", type=int, default=3)
    training.add_argument("--batch-size", type=int, default=16)
    training.add_argument("--resume", type=Path)
    training.add_argument("--device", choices=("cpu", "cuda"), default="cpu")
    training.add_argument("--no-feedback", action="store_true")
    generate = sub.add_parser("generate")
    generate.add_argument("--approach", choices=("joint", "denoise", "mutation"), default="joint")
    generate.add_argument("--attempts", type=int, default=30)
    generate.add_argument("--own-moves", type=int, default=3)
    generate.add_argument("--kyu-min", type=int, default=10)
    generate.add_argument("--kyu-max", type=int, default=20)
    generate.add_argument("--seed", type=int, default=2026)
    generate.add_argument("--proof-seconds", type=float, default=.25)
    generate.add_argument("--proof-nodes", type=int, default=3000)
    serve = sub.add_parser("serve")
    serve.add_argument("--port", type=int, default=4186)
    serve.add_argument("--no-browser", action="store_true")
    export = sub.add_parser("export-environment")
    export.add_argument("--destination", type=Path, required=True)
    export.add_argument("--offline-windows", action="store_true")
    export.add_argument("--include-scans", action="store_true")
    verify = sub.add_parser("verify-bundle")
    verify.add_argument("--directory", type=Path, required=True)
    scan = sub.add_parser("download-scans")
    scan.add_argument("--ids", help="Comma-separated source IDs; default all inventoried editions")
    render = sub.add_parser("render-scans")
    render.add_argument("--renderer")
    render.add_argument("--ids")
    sub.add_parser("doctor")
    comparison = sub.add_parser("compare")
    comparison.add_argument("--attempts", type=int, default=30)
    comparison.add_argument("--own-moves", type=int, default=3)
    comparison.add_argument("--proof-seconds", type=float, default=.3)
    puzzle_export = sub.add_parser("export-puzzles")
    puzzle_export.add_argument("--destination", type=Path, required=True)
    puzzle_export.add_argument("--territory", default="DE")
    audit = sub.add_parser("audit-transitions")
    audit.add_argument("--destination", type=Path, required=True)
    recognition = sub.add_parser("recognize-scans")
    recognition.add_argument("--ids")
    recognition.add_argument("--limit", type=int, default=0)
    approval = sub.add_parser("approve-transcription")
    approval.add_argument("--id", required=True)
    approval.add_argument("--reviewer", required=True)
    approval.add_argument("--position-checked", action="store_true")
    approval.add_argument("--solution-checked", action="store_true")
    approval.add_argument("--source-checked", action="store_true")
    args = parser.parse_args()
    args.root = args.root.resolve()
    args.root.mkdir(parents=True, exist_ok=True)
    from .common import workspace_lock
    readonly=("serve","doctor","verify-bundle","audit-transitions")
    with nullcontext() if args.command in readonly else workspace_lock(args.root):
        execute(args)


def execute(args):
    if args.command == "import-historical":
        from .historical import import_smith
        result = import_smith(args.root, args.html)
    elif args.command == "train":
        from .train import train
        (args.root/"stop-training.flag").unlink(missing_ok=True)
        result = train(args.root, name=args.approach, steps=args.steps, channels=args.channels,
                       blocks=args.blocks, batch_size=args.batch_size, resume=args.resume,
                       device=args.device, use_feedback=not args.no_feedback)
    elif args.command == "generate":
        from .generate import generate
        (args.root/"stop-generation.flag").unlink(missing_ok=True)
        result = generate(args.root, approach=args.approach, count=args.attempts, own_moves=args.own_moves,
                          kyu_min=args.kyu_min, kyu_max=args.kyu_max, seed=args.seed,
                          proof_seconds=args.proof_seconds, proof_nodes=args.proof_nodes)
    elif args.command == "serve":
        from .server import serve
        serve(args.root, args.port, not args.no_browser)
        return
    elif args.command == "download-scans":
        from .scans import download_scans
        inventory = download_scans(args.root, args.ids.split(",") if args.ids else None)
        result = {"sources": len(inventory["sources"]),
                  "downloaded": sum(s.get("download_status") == "complete" for s in inventory["sources"]),
                  "pages": sum(s.get("pages") or 0 for s in inventory["sources"]),
                  "errors": [{"id": s["id"], "error": s["error"]} for s in inventory["sources"] if s.get("error")]}
    elif args.command == "render-scans":
        from .scans import render_scans
        result = render_scans(args.root, args.renderer, args.ids.split(",") if args.ids else None)
    elif args.command == "export-environment":
        from .portable import export_environment
        result = export_environment(args.root, args.destination, args.offline_windows, args.include_scans)
    elif args.command == "compare":
        from .experiments import compare
        result = compare(args.root, args.attempts, args.own_moves, proof_seconds=args.proof_seconds)
    elif args.command == "export-puzzles":
        from .export_puzzles import export_puzzles
        result = export_puzzles(args.root, args.destination, args.territory)
    elif args.command == "audit-transitions":
        from .audit import export_transitions
        result = export_transitions(args.root, args.destination)
    elif args.command == "recognize-scans":
        from .vision import recognize_scans
        result = recognize_scans(args.root, args.ids.split(",") if args.ids else None, args.limit)
    elif args.command == "approve-transcription":
        from .scans import approve_transcription
        result = approve_transcription(args.root,args.id,args.reviewer,
            {"position":args.position_checked,"solution":args.solution_checked,"source":args.source_checked})
    elif args.command == "verify-bundle":
        from .portable import verify_bundle
        result = verify_bundle(args.directory)
    else:
        import platform
        import torch
        import numpy
        from .common import records
        result = {"python": platform.python_version(), "torch": torch.__version__, "numpy": numpy.__version__,
                  "cuda": torch.cuda.is_available(), "root": str(args.root), "historical_records": len(records(args.root)),
                  "production_ready": False}
    print(json.dumps(result, ensure_ascii=True, indent=2))


if __name__ == "__main__":
    main()
