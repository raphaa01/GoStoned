"""Static, cost-free validation for the production Modal integration."""

from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
APP_SOURCE = (ROOT / "modal_worker" / "app.py").read_text(encoding="utf-8")
WORKFLOW_SOURCE = (ROOT / ".github" / "workflows" / "modal-worker.yml").read_text(encoding="utf-8")


def require(fragment: str, source: str, message: str) -> None:
    if fragment not in source:
        raise RuntimeError(message)


def forbid(fragment: str, source: str, message: str) -> None:
    if fragment in source:
        raise RuntimeError(message)


def main() -> None:
    require("workflow_dispatch:", WORKFLOW_SOURCE, "Modal workflow must remain manual.")
    forbid("push:", WORKFLOW_SOURCE, "Modal deployment must not run on push.")
    forbid("pull_request:", WORKFLOW_SOURCE, "Modal deployment must not run on pull requests.")
    require("--env GoStone", WORKFLOW_SOURCE, "Modal deploy must target GoStone explicitly.")
    require("modal.Image.from_dockerfile", APP_SOURCE, "Modal must reuse the reviewed Docker image.")
    require("requires_proxy_auth=True", APP_SOURCE, "Dispatch must require Modal proxy authentication.")
    require("min_containers=0", APP_SOURCE, "Every function must be allowed to scale to zero.")
    forbid("min_containers=1", APP_SOURCE, "A paid warm baseline is forbidden.")
    require("max_containers=1", APP_SOURCE, "Expensive analysis concurrency must be capped.")
    require(
        "def process_analysis_on_demand",
        APP_SOURCE,
        "Analysis compute must use a fresh non-regional function identity that supports spawn().",
    )
    require(
        "def process_puzzle_on_demand",
        APP_SOURCE,
        "Puzzle compute must use a fresh non-regional function identity that supports spawn().",
    )
    analysis_decorator = APP_SOURCE.split("def process_analysis_on_demand", 1)[0].rsplit("@app.function(", 1)[-1]
    puzzle_decorator = APP_SOURCE.split("def process_puzzle_on_demand", 1)[0].rsplit("@app.function(", 1)[-1]
    forbid(
        "routing_region=",
        analysis_decorator,
        "Spawned analysis compute cannot use Modal regional input routing.",
    )
    forbid(
        "routing_region=",
        puzzle_decorator,
        "Spawned puzzle compute cannot use Modal regional input routing.",
    )
    require("modal.Secret.from_name(DATABASE_SECRET_NAME)", APP_SOURCE, "Database access must use a named Secret.")
    require('"worker:katago:once"', APP_SOURCE, "Modal must run bounded one-shot jobs.")
    require('"DATABASE_SSL": "require"', APP_SOURCE, "Production PostgreSQL must require TLS.")
    forbid("postgresql://", APP_SOURCE, "A database URL must never be hardcoded.")
    forbid('"DATABASE_URL":', APP_SOURCE, "A database URL value must come only from Secret injection.")
    forbid("@app.server", APP_SOURCE, "A permanent Modal Server must not be deployed.")
    print("Modal scale-to-zero configuration is valid.")


if __name__ == "__main__":
    main()
