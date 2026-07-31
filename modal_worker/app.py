"""Scale-to-zero KataGo jobs for GoStone.

The lightweight authenticated endpoint only dispatches work. KataGo compute
starts for a specific durable PostgreSQL job and scales back to zero afterward.
"""

from __future__ import annotations

import subprocess

import modal

from .settings import APP_NAME, DATABASE_SECRET_NAME


app = modal.App(APP_NAME)

worker_image = modal.Image.from_dockerfile(
    "docker/katago/Dockerfile",
    context_dir=".",
    add_python="3.12",
)

dispatcher_image = modal.Image.debian_slim(python_version="3.12").pip_install(
    "fastapi==0.116.1",
)

worker_environment = {
    "DATABASE_SSL": "require",
    "DATABASE_POOL_MAX": "1",
    "KATAGO_MAX_VISITS": "160",
    "KATAGO_BOT_MAX_VISITS": "160",
    "KATAGO_PUZZLE_MAX_VISITS": "80",
}


def run_job(kind: str, target_id: str | None) -> None:
    command = ["npm", "run", "worker:katago:once", "--", kind]
    if target_id:
        command.append(target_id)
    subprocess.run(command, cwd="/app", check=True, timeout=1_150)


@app.function(
    image=worker_image,
    secrets=[modal.Secret.from_name(DATABASE_SECRET_NAME)],
    env=worker_environment,
    cpu=2.0,
    memory=4096,
    min_containers=0,
    max_containers=2,
    scaledown_window=10,
    timeout=60,
    routing_region="eu-west",
)
def process_bot(target_id: str | None = None) -> None:
    run_job("bot", target_id)


@app.function(
    image=worker_image,
    secrets=[modal.Secret.from_name(DATABASE_SECRET_NAME)],
    env=worker_environment,
    cpu=4.0,
    memory=8192,
    min_containers=0,
    max_containers=1,
    scaledown_window=10,
    timeout=1_200,
    routing_region="eu-west",
)
def process_analysis(target_id: str | None = None) -> None:
    run_job("analysis", target_id)


@app.function(
    image=worker_image,
    secrets=[modal.Secret.from_name(DATABASE_SECRET_NAME)],
    env=worker_environment,
    cpu=4.0,
    memory=8192,
    min_containers=0,
    max_containers=1,
    scaledown_window=10,
    timeout=300,
    routing_region="eu-west",
)
def process_puzzle(target_id: str | None = None) -> None:
    run_job("puzzle", target_id)


@app.function(
    image=dispatcher_image,
    min_containers=0,
    max_containers=2,
    scaledown_window=2,
    timeout=30,
    routing_region="eu-west",
)
@modal.fastapi_endpoint(method="POST", requires_proxy_auth=True)
def dispatch(payload: dict[str, str | None]) -> dict[str, str]:
    kind = payload.get("kind")
    target_id = payload.get("targetId")
    processors = {
        "bot": process_bot,
        "analysis": process_analysis,
        "puzzle": process_puzzle,
    }
    if kind not in processors:
        from fastapi import HTTPException
        raise HTTPException(status_code=400, detail="Unsupported KataGo job kind.")
    call = processors[kind].spawn(target_id)
    return {"ok": "true", "callId": call.object_id}
