"""Production Modal server for GoStone's existing KataGo worker.

The image and Node process are shared with local Docker. Modal only supplies
compute and the production database secret, so the website remains independent
from the worker host.
"""

from __future__ import annotations

import subprocess

import modal

from .settings import APP_NAME, DATABASE_SECRET_NAME


PORT = 8080

app = modal.App(APP_NAME)

worker_image = modal.Image.from_dockerfile(
    "docker/katago/Dockerfile",
    context_dir=".",
    add_python="3.12",
)


@app.server(
    image=worker_image,
    secrets=[modal.Secret.from_name(DATABASE_SECRET_NAME)],
    env={
        "DATABASE_SSL": "require",
        "DATABASE_POOL_MAX": "2",
        "KATAGO_MAX_VISITS": "160",
        "KATAGO_BOT_MAX_VISITS": "160",
        "KATAGO_BOT_POLL_INTERVAL_MS": "500",
        "KATAGO_PUZZLE_MAX_VISITS": "80",
        "KATAGO_PUZZLE_POLL_INTERVAL_MS": "2000",
        "KATAGO_POLL_INTERVAL_MS": "2000",
        "PORT": str(PORT),
    },
    cpu=4.0,
    memory=8192,
    min_containers=1,
    startup_timeout=300,
    port=PORT,
    unauthenticated=False,
    routing_region="eu-west",
    exit_grace_period=30,
)
class KataGoWorker:
    """One warm worker; PostgreSQL leases remain the source of truth."""

    @modal.enter()
    def start(self) -> None:
        self.process = subprocess.Popen(
            ["npm", "run", "worker:katago"],
            cwd="/app",
        )

    @modal.exit()
    def stop(self) -> None:
        if self.process.poll() is not None:
            return
        self.process.terminate()
        try:
            self.process.wait(timeout=25)
        except subprocess.TimeoutExpired:
            self.process.kill()
            self.process.wait(timeout=5)
