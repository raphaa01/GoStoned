from __future__ import annotations

from pathlib import Path
import shutil
import time

from .common import atomic_json, read_json
from .generate import generate


def compare(root: Path, attempts=30, own_moves=3, seed=2026, proof_seconds=.3):
    """Identical seeds, budgets and fresh dedup indices for each approach."""
    run = root / "experiments" / f"comparison-{time.time_ns()}"
    reports = []
    for approach in ("joint", "denoise", "mutation"):
        workspace = run / approach
        shutil.copytree(root / "data", workspace / "data")
        if approach != "mutation":
            source = root / "models" / approach / "checkpoint.pt"
            destination = workspace / "models" / approach / "checkpoint.pt"
            destination.parent.mkdir(parents=True)
            shutil.copy2(source, destination)
        report = generate(workspace, approach=approach, count=attempts, own_moves=own_moves,
                          seed=seed, proof_seconds=proof_seconds)
        report["export_eligible"] = sum(read_json(path)["verification"].get("export_eligible", False)
                                        for path in (workspace / "candidates").glob("*.json"))
        for path in (workspace / "candidates").glob("*.json"):
            destination = root / "candidates" / path.name
            destination.parent.mkdir(exist_ok=True)
            if not destination.exists():
                shutil.copy2(path, destination)
        reports.append(report)
    result = {"schema": "gostone.puzzle-experiment/1", "reports": reports,
              "conditions": {"attempts_each": attempts, "own_moves": own_moves, "seed": seed,
                             "proof_seconds": proof_seconds, "fresh_indices_per_approach": True},
              "winner": None, "production_ready": False,
              "interpretation": "No winner without full export eligibility AND independent human quality/diversity review. Neural imitation accuracy alone cannot select a production generator."}
    atomic_json(run / "comparison.json", result)
    atomic_json(root / "experiments/latest-comparison.json", result)
    return result
