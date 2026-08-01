from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

import torch

from .arena import MAX_MODEL_BYTES, ArenaService, ModelCatalog
from .model import GoStoneStudent, StudentConfig


def create_artifact(
    root: Path,
    run_id: str = "test-run",
    *,
    preset_id: str = "short",
    model_version: int | None = None,
) -> Path:
    run_dir = root / run_id
    artifact_dir = run_dir / "artifact"
    artifact_dir.mkdir(parents=True)
    config = StudentConfig(channels=8, blocks=1)
    model = GoStoneStudent(config)
    torch.save(
        {"config": config.as_dict(), "state_dict": model.state_dict()},
        artifact_dir / "gostone-japanese-v1.pt",
    )
    (artifact_dir / "gostone-japanese-v1.onnx").write_bytes(b"test-onnx")
    (artifact_dir / "gostone-japanese-v1.json").write_text(
        json.dumps({"rules": "japanese", "komi": 6.5}),
        encoding="utf-8",
    )
    (run_dir / "config.json").write_text(
        json.dumps(
            {
                "created_at": 10,
                "preset": {"id": preset_id, "name": "Interner Presetname"},
                "model_version": model_version,
            }
        ),
        encoding="utf-8",
    )
    return run_dir


class ArenaTests(unittest.TestCase):
    def test_catalog_lists_only_complete_japanese_artifacts(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            create_artifact(root)
            incomplete = root / "incomplete" / "artifact"
            incomplete.mkdir(parents=True)
            (incomplete / "gostone-japanese-v1.pt").write_bytes(b"partial")
            oversized = create_artifact(root, "oversized")
            with (oversized / "artifact" / "gostone-japanese-v1.onnx").open("r+b") as output:
                output.truncate(MAX_MODEL_BYTES + 1)
            models = ModelCatalog(root).artifacts()
            self.assertEqual([model.id for model in models], ["test-run"])
            self.assertTrue(models[0].label.startswith("GoStone AI v1 · "))
            self.assertEqual(models[0].model_version, 1)

    def test_versioned_and_technical_models_have_product_names(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            create_artifact(root, "real", model_version=7)
            create_artifact(root, "smoke", preset_id="smoke")
            models = {model.id: model for model in ModelCatalog(root).artifacts()}
            self.assertTrue(models["smoke"].label.startswith("GoStone AI Technical Test · "))
            self.assertTrue(models["real"].label.startswith("GoStone AI v7 · "))
            self.assertTrue(models["smoke"].technical_test)

    def test_player_can_start_and_make_a_legal_move_against_the_model(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            create_artifact(root)
            service = ArenaService(root)
            state = service.start("test-run", 9, 1200, "black")
            self.assertEqual(state["move_number"], 0)
            state = service.move_point(str(state["session_id"]), 4, 4)
            self.assertEqual(state["move_number"], 2)
            self.assertEqual(state["board"][4][4], 1)
            self.assertEqual(state["to_move"], "black")
            self.assertEqual(state["rules"], "japanese")
            self.assertEqual(state["komi"], 6.5)

    def test_two_passes_return_a_japanese_settlement_proposal(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            create_artifact(root)
            service = ArenaService(root)
            service._bot_move = lambda _session: "pass"  # type: ignore[method-assign]
            state = service.start("test-run", 9, 1500, "black")
            state = service.move(str(state["session_id"]), "pass")
            self.assertTrue(state["finished"])
            self.assertIsNotNone(state["proposal"])
            proposal = state["proposal"]
            self.assertEqual(proposal["score"]["white_total"], 6.5)
            self.assertIn("both players", proposal["notice"])

    def test_two_models_advance_exactly_one_visible_move_per_request(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            create_artifact(root, "model-one", model_version=1)
            create_artifact(root, "model-two", model_version=2)
            service = ArenaService(root)
            state = service.start_match("model-one", "model-two", 9, 1200, "white")

            self.assertEqual(state["mode"], "model_match")
            self.assertEqual(state["move_number"], 0)
            self.assertEqual(state["black_model_id"], "model-one")
            self.assertEqual(state["white_model_id"], "model-two")
            self.assertEqual(state["settlement_evaluator"], "white")

            first = service.next_match_move(str(state["session_id"]))
            self.assertEqual(first["move_number"], 1)
            self.assertEqual(first["to_move"], "white")
            self.assertEqual(len(first["moves"]), 1)
            self.assertEqual(first["moves"][0]["color"], "black")
            self.assertEqual(first["moves"][0]["model_id"], "model-one")

            second = service.next_match_move(str(state["session_id"]))
            self.assertEqual(second["move_number"], 2)
            self.assertEqual(second["to_move"], "black")
            self.assertEqual(len(second["moves"]), 2)
            self.assertEqual(second["moves"][1]["color"], "white")
            self.assertEqual(second["moves"][1]["model_id"], "model-two")

    def test_model_match_settles_after_two_visible_passes(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            create_artifact(root, "model-one", model_version=1)
            create_artifact(root, "model-two", model_version=2)
            service = ArenaService(root)
            service._bot_move = lambda _session, _model_id=None: "pass"  # type: ignore[method-assign]
            state = service.start_match("model-one", "model-two", 9, 1500, "white")

            first = service.next_match_move(str(state["session_id"]))
            self.assertFalse(first["finished"])
            final = service.next_match_move(str(state["session_id"]))

            self.assertTrue(final["finished"])
            self.assertEqual(final["finished_reason"], "two_passes")
            self.assertEqual([move["move"] for move in final["moves"]], ["pass", "pass"])
            self.assertIsNotNone(final["proposal"])
            self.assertEqual(final["proposal"]["evaluator_model_id"], "model-two")
            self.assertEqual(final["proposal"]["evaluator_color"], "white")
            self.assertIn("GoStone AI v2", final["proposal"]["notice"])

    def test_model_match_can_use_black_ai_for_japanese_scoring(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            create_artifact(root, "model-one", model_version=1)
            create_artifact(root, "model-two", model_version=2)
            service = ArenaService(root)
            service._bot_move = lambda _session, _model_id=None: "pass"  # type: ignore[method-assign]
            state = service.start_match("model-one", "model-two", 9, 1500, "black")
            service.next_match_move(str(state["session_id"]))
            final = service.next_match_move(str(state["session_id"]))

            self.assertEqual(final["proposal"]["evaluator_model_id"], "model-one")
            self.assertEqual(final["proposal"]["evaluator_color"], "black")


if __name__ == "__main__":
    unittest.main()
