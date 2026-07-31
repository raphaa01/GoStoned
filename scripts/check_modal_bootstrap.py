"""Static, cost-free validation for the production Modal integration."""

from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
APP_SOURCE = (ROOT / "modal_worker" / "app.py").read_text(encoding="utf-8")
WORKFLOW_SOURCE = (
    ROOT / ".github" / "workflows" / "modal-worker.yml"
).read_text(encoding="utf-8")


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
    require("@app.server", APP_SOURCE, "The worker must run as a Modal Server.")
    require("unauthenticated=False", APP_SOURCE, "The worker health endpoint must require Modal proxy authentication.")
    require("min_containers=1", APP_SOURCE, "Exactly one warm worker baseline is required.")
    require("modal.Secret.from_name(DATABASE_SECRET_NAME)", APP_SOURCE, "Database access must use a named Secret.")
    require('["npm", "run", "worker:katago"]', APP_SOURCE, "Modal must start the shared Node worker.")
    require('"DATABASE_SSL": "require"', APP_SOURCE, "Production PostgreSQL must require TLS.")
    forbid("postgresql://", APP_SOURCE, "A database URL must never be hardcoded.")
    forbid("DATABASE_URL\":", APP_SOURCE, "A database URL value must come only from Modal Secret injection.")

    print("Modal production worker configuration is valid.")


if __name__ == "__main__":
    main()
