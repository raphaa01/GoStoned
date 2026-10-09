from __future__ import annotations

import shutil

from .download_teacher import download_teacher
from .generate import generate_dataset
from .model import load_checkpoint_model
from .teacher import default_cache_dir
from .train import MAX_MODEL_BYTES, train_student


def main() -> None:
    cache = default_cache_dir()
    teacher = download_teacher()
    smoke_dir = cache / "smoke"
    shutil.rmtree(smoke_dir, ignore_errors=True)
    data = smoke_dir / "data"
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
        channels=32,
        blocks=2,
        seed=20260801,
    )
    model = load_checkpoint_model(smoke_dir / "artifact" / "gostone-japanese-v1.pt")
    if model_path.stat().st_size > MAX_MODEL_BYTES:
        raise RuntimeError("Smoke model is larger than 15 MiB")
    print("local KataGo distillation smoke test passed")


if __name__ == "__main__":
    main()
