"""Fail closed while the Modal integration is intentionally dormant."""

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
    require(
        "vars.MODAL_DEPLOYMENT_ENABLED == 'true'",
        WORKFLOW_SOURCE,
        "Modal deployment must retain the repository-variable safety lock.",
    )
    require("--env GoStone", WORKFLOW_SOURCE, "Modal deploy must target GoStone explicitly.")

    for remote_resource in (
        "@app.function",
        "@app.cls",
        "modal.Image",
        "modal.Secret",
        "modal.Volume",
        ".deploy(",
    ):
        forbid(
            remote_resource,
            APP_SOURCE,
            f"Dormant Modal app unexpectedly declares remote resource: {remote_resource}",
        )

    print("Modal bootstrap is valid and remains deployment-locked.")


if __name__ == "__main__":
    main()
