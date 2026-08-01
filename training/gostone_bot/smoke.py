from __future__ import annotations

import shutil

import torch

from .download_teacher import download_teacher
from .generate import generate_dataset
from .model import GoStoneStudent, StudentConfig
from .teacher import default_cache_dir
from .train import train_student


def main() -> None:
    cache = default_cache_dir()
    teacher = download_teacher()
    smoke_dir = cache / "smoke"
    shutil.rmtree(smoke_dir, ignore_errors=True)
    data = smoke_dir / "teacher-smoke.npz"
    generate_dataset(
        output=data,
        games=1,
        board_sizes=(9,),
        visits=1,
        max_moves=8,
        seed=20260801,
        image="newproject-katago:latest",
        human_model=teacher,
    )
    model_path = train_student(
        data=data,
        output_dir=smoke_dir / "artifact",
        epochs=1,
        batch_size=4,
        learning_rate=3e-4,
        channels=96,
        blocks=10,
        seed=20260801,
    )
    checkpoint = torch.load(smoke_dir / "artifact" / "gostone-japanese-v1.pt", map_location="cpu")
    config = StudentConfig(**checkpoint["config"])
    model = GoStoneStudent(config)
    model.load_state_dict(checkpoint["state_dict"])
    model.eval()
    if model_path.stat().st_size > 8 * 1024 * 1024:
        raise RuntimeError("Smoke model is larger than 8 MiB")
    print("local KataGo distillation smoke test passed")


if __name__ == "__main__":
    main()
