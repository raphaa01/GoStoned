from __future__ import annotations

import os
import tempfile
import unittest
from unittest import mock
from pathlib import Path

import numpy as np
import torch

from .board import BoardState, PASS_INDEX, policy_to_padded, spatial_to_padded
from .generate import (
    STRENGTHS,
    make_target_policy,
    settlement_targets,
    training_position_limit,
    training_profiles,
)
from .model import GoStoneStudent, StudentConfig
from .runtime import StopRequested
from .settlement import propose_settlement, score_japanese
from .train import MAX_MODEL_BYTES, _atomic_torch_save, split_training_archives, train_student


def write_training_archive(path: Path, positions: int = 4) -> None:
    features = np.zeros((positions, 12, 19, 19), dtype=np.float32)
    features[:, 4] = 1.0
    policies = np.zeros((positions, 362), dtype=np.float32)
    policies[:, PASS_INDEX] = 1.0
    np.savez_compressed(
        path,
        features=features,
        policies=policies,
        values=np.zeros(positions, dtype=np.float32),
        scores=np.zeros(positions, dtype=np.float32),
        ownerships=np.zeros((positions, 361), dtype=np.float32),
        ownership_weights=np.ones((positions, 361), dtype=np.float32),
    )


class BoardEncodingTests(unittest.TestCase):
    def test_captures_prisoners_and_centers_small_boards(self) -> None:
        board = BoardState(9)
        for move in ("B2", "A2", "A1", "pass", "A3"):
            board.play(move)
        features = board.features(0.4, 6.5)
        self.assertEqual(features.shape, (12, 19, 19))
        self.assertEqual(int(features[4].sum()), 81)
        self.assertEqual(int(features[1].sum()), 0)
        self.assertEqual(board.captured_white_by_black, 1)
        self.assertGreater(float(features[8].max()), 0.0)

    def test_policy_and_spatial_padding_preserve_contract(self) -> None:
        policy = np.zeros(82, dtype=np.float32)
        policy[0] = 0.75
        policy[-1] = 0.25
        padded = policy_to_padded(policy, 9)
        self.assertAlmostEqual(float(padded.sum()), 1.0)
        self.assertAlmostEqual(float(padded[PASS_INDEX]), 0.25)
        ownership = spatial_to_padded(np.linspace(-1, 1, 81), 9)
        self.assertEqual(ownership.shape, (361,))
        self.assertAlmostEqual(float(ownership.reshape(19, 19)[5, 5]), -1.0)


class StudentModelTests(unittest.TestCase):
    def test_atomic_checkpoint_retries_transient_windows_file_locks(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            checkpoint = Path(directory) / "training-progress.pt"
            real_replace = os.replace
            attempts = 0

            def intermittently_locked(source: Path, destination: Path) -> None:
                nonlocal attempts
                attempts += 1
                if attempts < 3:
                    raise PermissionError(13, "checkpoint is temporarily locked", str(destination))
                real_replace(source, destination)

            with (
                mock.patch("training.gostone_bot.train.os.replace", side_effect=intermittently_locked),
                mock.patch("training.gostone_bot.train.time.sleep"),
            ):
                _atomic_torch_save({"value": 42}, checkpoint)

            self.assertEqual(attempts, 3)
            self.assertEqual(torch.load(checkpoint, weights_only=True)["value"], 42)

    def test_whole_katago_games_are_held_out_for_quality_checks(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for index in range(10):
                write_training_archive(root / f"game-{index:05d}.npz", 1)
            training, validation = split_training_archives(root)
            self.assertEqual([path.name for path in validation], ["game-00004.npz", "game-00009.npz"])
            self.assertEqual(len(training), 8)

    def test_mid_epoch_checkpoint_resumes_after_a_safe_stop(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            data = root / "sample.npz"
            output = root / "output"
            write_training_archive(data, 4)
            calls = 0

            def stop_after_first_batch() -> None:
                nonlocal calls
                calls += 1
                if calls == 2:
                    raise StopRequested()

            with self.assertRaises(StopRequested):
                train_student(
                    data=data,
                    output_dir=output,
                    epochs=1,
                    batch_size=2,
                    learning_rate=3e-4,
                    channels=8,
                    blocks=1,
                    seed=11,
                    control=stop_after_first_batch,
                    resume=True,
                )
            progress = torch.load(output / "training-progress.pt", weights_only=True)
            self.assertEqual(progress["epoch_index"], 0)
            self.assertEqual(progress["completed_batches_in_epoch"], 1)
            result = train_student(
                data=data,
                output_dir=output,
                epochs=1,
                batch_size=2,
                learning_rate=3e-4,
                channels=8,
                blocks=1,
                seed=11,
                resume=True,
            )
            self.assertTrue(result.is_file())
            resumed = torch.load(output / "training-progress.pt", weights_only=True)
            self.assertEqual(resumed["completed_epochs"], 1)
            self.assertEqual(resumed["completed_batches_in_epoch"], 0)

    def test_resume_advances_a_fully_saved_epoch_without_dividing_by_zero(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            data = root / "sample.npz"
            output = root / "output"
            write_training_archive(data, 4)
            train_student(
                data=data,
                output_dir=output,
                epochs=1,
                batch_size=2,
                learning_rate=3e-4,
                channels=8,
                blocks=1,
                seed=17,
                resume=True,
            )
            checkpoint = output / "training-progress.pt"
            saved = torch.load(checkpoint, weights_only=True)
            saved.update(epoch_index=0, completed_epochs=0, completed_batches_in_epoch=2)
            torch.save(saved, checkpoint)
            completed: list[tuple[int, dict[str, float]]] = []

            result = train_student(
                data=data,
                output_dir=output,
                epochs=2,
                batch_size=2,
                learning_rate=3e-4,
                channels=8,
                blocks=1,
                seed=17,
                resume=True,
                on_epoch=lambda epoch, _total, metrics: completed.append((epoch, metrics)),
            )

            self.assertTrue(result.is_file())
            self.assertEqual(completed[0], (1, {}))
            self.assertEqual(completed[1][0], 2)
            resumed = torch.load(checkpoint, weights_only=True)
            self.assertEqual(resumed["completed_epochs"], 2)
            self.assertEqual(resumed["completed_batches_in_epoch"], 0)

    def test_model_outputs_and_rank_profiles_fit_the_hard_limit(self) -> None:
        model = GoStoneStudent(StudentConfig())
        features = torch.zeros(2, 12, 19, 19)
        features[:, 4] = 1.0
        policy, value, score, ownership, survival = model(features)
        self.assertEqual(tuple(policy.shape), (2, 362))
        self.assertEqual(tuple(value.shape), (2,))
        self.assertEqual(tuple(score.shape), (2,))
        self.assertEqual(tuple(ownership.shape), (2, 361))
        self.assertEqual(tuple(survival.shape), (2, 361))
        self.assertLess(model.parameter_count * 4, MAX_MODEL_BYTES)
        self.assertEqual(
            [profile.nominal_elo for profile in STRENGTHS],
            [600, 900, 1200, 1500, 1800, 2100],
        )

    def test_early_teacher_pass_is_suppressed(self) -> None:
        raw_policy = [0.0] * 82
        raw_policy[0] = 0.4
        raw_policy[-1] = 0.6
        result = {
            "humanPolicy": raw_policy,
            "moveInfos": [{"move": "pass", "visits": 1}],
        }
        target = make_target_policy(result, 9, search_mix=0.18, allow_pass=False)
        self.assertEqual(float(target[PASS_INDEX]), 0.0)
        self.assertAlmostEqual(float(target.sum()), 1.0)

    def test_new_version_starts_from_the_previous_model_weights(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            data = root / "sample.npz"
            features = np.zeros((1, 12, 19, 19), dtype=np.float32)
            features[:, 4] = 1.0
            policies = np.zeros((1, 362), dtype=np.float32)
            policies[:, PASS_INDEX] = 1.0
            np.savez_compressed(
                data,
                features=features,
                policies=policies,
                values=np.zeros(1, dtype=np.float32),
                scores=np.zeros(1, dtype=np.float32),
                ownerships=np.zeros((1, 361), dtype=np.float32),
                ownership_weights=np.ones((1, 361), dtype=np.float32),
            )
            config = StudentConfig(channels=8, blocks=1)
            base_model = GoStoneStudent(config)
            with torch.no_grad():
                base_model.stem[0].weight.fill_(0.125)
            base = root / "base.pt"
            torch.save({"config": config.as_dict(), "state_dict": base_model.state_dict()}, base)
            train_student(
                data=data,
                output_dir=root / "output",
                epochs=0,
                batch_size=1,
                learning_rate=3e-4,
                channels=8,
                blocks=1,
                seed=7,
                initial_checkpoint=base,
            )
            saved = torch.load(root / "output" / "gostone-japanese-v1.pt", weights_only=True)
            inherited = saved["state_dict"]["stem.0.weight"]
            self.assertTrue(torch.allclose(inherited, torch.full_like(inherited, 0.125)))

    def test_settlement_targets_require_complete_teacher_maps(self) -> None:
        ownership, confidence = settlement_targets(
            {"ownership": [-0.5] * 81, "ownershipStdev": [0.2] * 81},
            9,
        )
        self.assertEqual(ownership.shape, (361,))
        self.assertEqual(confidence.shape, (361,))
        self.assertAlmostEqual(float(confidence.max()), 0.8)

    def test_real_training_balances_ranks_across_both_colors(self) -> None:
        pairings = [training_profiles(index) for index in range(18)]
        black = [profile.nominal_elo for profile, _ in pairings]
        white = [profile.nominal_elo for _, profile in pairings]
        expected = sorted([profile.nominal_elo for profile in STRENGTHS] * 3)
        self.assertEqual(sorted(black), expected)
        self.assertEqual(sorted(white), expected)
        for board_index in range(3):
            board_black = sorted(pairings[index][0].nominal_elo for index in range(board_index, 18, 3))
            board_white = sorted(pairings[index][1].nominal_elo for index in range(board_index, 18, 3))
            all_strengths = sorted(profile.nominal_elo for profile in STRENGTHS)
            self.assertEqual(board_black, all_strengths)
            self.assertEqual(board_white, all_strengths)

    def test_real_presets_reach_the_endgame_on_every_board_size(self) -> None:
        self.assertEqual(training_position_limit(9, 55, True), 81)
        self.assertEqual(training_position_limit(13, 55, True), 169)
        self.assertEqual(training_position_limit(19, 55, True), 361)
        self.assertEqual(training_position_limit(19, 8, False), 8)


class JapaneseSettlementTests(unittest.TestCase):
    def test_japanese_score_counts_territory_prisoners_and_komi(self) -> None:
        board = np.zeros((9, 9), dtype=np.int8)
        board[0, 2] = board[1, 1] = board[2, 0] = 1
        board[8, 8] = -1
        result = score_japanese(
            board,
            captured_white_by_black=2,
            captured_black_by_white=1,
            dead_stones=[],
            neutral_region_seeds=[],
            komi=6.5,
        )
        self.assertEqual(result.black_territory, 3)
        self.assertEqual(result.black_total, 5)
        self.assertEqual(result.white_total, 7.5)
        self.assertEqual(result.winner, "white")
        self.assertEqual(result.margin, 2.5)

    def test_proposal_keeps_low_confidence_groups_uncertain(self) -> None:
        board = np.zeros((9, 9), dtype=np.int8)
        board[0, 0] = 1
        proposal = propose_settlement(
            board,
            survival_logits=np.zeros(361, dtype=np.float32),
            ownership=np.zeros(361, dtype=np.float32),
            captured_white_by_black=0,
            captured_black_by_white=0,
        )
        self.assertEqual(proposal.groups[0].status, "uncertain")
        self.assertEqual(proposal.dead_stones, ())


if __name__ == "__main__":
    unittest.main()
