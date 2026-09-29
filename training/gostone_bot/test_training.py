from __future__ import annotations

import tempfile
import unittest
import json
from pathlib import Path

import numpy as np
import torch

from .board import BoardState, FEATURE_PLANES, PASS_INDEX, policy_to_padded, spatial_to_padded
from .curriculum import FALSE_EYE, KO, SEKI_STATUS, position_tags, settlement_labels
from .generate import (
    STRENGTHS,
    make_target_policy,
    settlement_targets,
    split_for_game,
    training_position_limit,
    training_profiles,
)
from .model import GoStoneStudent, StudentConfig
from .settlement import propose_settlement, score_japanese
from .teacher import KataGoTeacher, TeacherRetry
from .train import MAX_MODEL_BYTES, train_student


class BoardEncodingTests(unittest.TestCase):
    def test_captures_prisoners_and_centers_small_boards(self) -> None:
        board = BoardState(9)
        for move in ("B2", "A2", "A1", "pass", "A3"):
            board.play(move)
        features = board.features(0.4, 6.5)
        self.assertEqual(features.shape, (FEATURE_PLANES, 19, 19))
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
    def test_model_outputs_and_rank_profiles_fit_the_hard_limit(self) -> None:
        model = GoStoneStudent(StudentConfig())
        features = torch.zeros(2, FEATURE_PLANES, 19, 19)
        features[:, 4] = 1.0
        policy, value, score, ownership, survival, score_stdev, territory, status, score_logits = model(features)
        self.assertEqual(tuple(policy.shape), (2, 362))
        self.assertEqual(tuple(value.shape), (2,))
        self.assertEqual(tuple(score.shape), (2,))
        self.assertEqual(tuple(ownership.shape), (2, 361))
        self.assertEqual(tuple(survival.shape), (2, 361))
        self.assertEqual(tuple(score_stdev.shape), (2,))
        self.assertEqual(tuple(territory.shape), (2, 3, 361))
        self.assertEqual(tuple(status.shape), (2, 4, 361))
        self.assertEqual(tuple(score_logits.shape), (2, 41))
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

    def test_v5_family_version_starts_from_the_previous_model_weights(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            data = root / "data"
            data.mkdir()
            features = np.zeros((1, FEATURE_PLANES, 19, 19), dtype=np.float32)
            features[:, 4] = 1.0
            policies = np.zeros((1, 362), dtype=np.float32)
            policies[:, PASS_INDEX] = 1.0
            np.savez_compressed(
                data / "game-00000.npz",
                features=features,
                policies=policies,
                values=np.zeros(1, dtype=np.float32),
                scores=np.zeros(1, dtype=np.float32),
                ownerships=np.zeros((1, 361), dtype=np.float32),
                ownership_weights=np.ones((1, 361), dtype=np.float32),
                status_targets=np.zeros((1, 361), dtype=np.int8),
                status_weights=np.ones((1, 361), dtype=np.float32),
                territory_targets=np.full((1, 361), 2, dtype=np.int8),
                territory_weights=np.ones((1, 361), dtype=np.float32),
                position_kinds=np.zeros(1, dtype=np.int16),
                board_sizes=np.full(1, 9, dtype=np.int8),
                metadata=json.dumps({"format": 5, "split": "train"}),
            )
            config = StudentConfig(channels=16, blocks=1)
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
                channels=16,
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

    def test_black_to_move_ownership_is_converted_to_fixed_color_perspective(self) -> None:
        ownership, _ = settlement_targets(
            {"ownership": [0.75] * 81, "ownershipStdev": [0.0] * 81}, 9, to_move=1
        )
        self.assertAlmostEqual(float(ownership.reshape(19, 19)[5, 5]), -0.75)

    def test_strength_changes_only_policy_branch_not_scoring_heads(self) -> None:
        torch.manual_seed(4)
        model = GoStoneStudent(StudentConfig(channels=16, blocks=1)).eval()
        board = BoardState(9)
        weak = torch.from_numpy(board.features(0.0, 6.5)).unsqueeze(0)
        strong = torch.from_numpy(board.features(1.0, 6.5)).unsqueeze(0)
        with torch.inference_mode():
            weak_outputs = model(weak); strong_outputs = model(strong)
        self.assertFalse(torch.allclose(weak_outputs[0], strong_outputs[0]))
        for index in (1, 2, 3, 4, 5, 6, 7, 8):
            self.assertTrue(torch.allclose(weak_outputs[index], strong_outputs[index]))

    def test_known_shared_liberty_position_gets_conservative_seki_labels(self) -> None:
        board = BoardState(9)
        board.stones[:4, :] = 1
        board.stones[5:, :] = -1
        board.stones[4, :4] = 1
        board.stones[4, 6:] = -1
        ownership = np.zeros(361, dtype=np.float32)
        confidence = np.ones(361, dtype=np.float32)
        labels = settlement_labels(board, ownership, confidence)
        offset = 5
        self.assertEqual(labels.status_targets.reshape(19, 19)[offset, offset], SEKI_STATUS)

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

    def test_whole_game_split_covers_every_board_size(self) -> None:
        splits = {(index % 3, split_for_game(index)) for index in range(30)}
        for board_index in range(3):
            self.assertIn((board_index, "train"), splits)
            self.assertIn((board_index, "validation"), splits)
            self.assertIn((board_index, "test"), splits)

    def test_real_presets_reach_the_endgame_on_every_board_size(self) -> None:
        self.assertEqual(training_position_limit(9, 55, True), 81)
        self.assertEqual(training_position_limit(13, 55, True), 169)
        self.assertEqual(training_position_limit(19, 55, True), 361)
        self.assertEqual(training_position_limit(19, 8, False), 8)


class JapaneseSettlementTests(unittest.TestCase):
    def test_known_ko_and_false_eye_fixtures_are_selected_for_deep_labels(self) -> None:
        board = BoardState(9)
        board.ko_point = (4, 4)
        for x, y in ((4, 3), (3, 4), (5, 4), (4, 5)):
            board.stones[y, x] = 1
        board.stones[3, 3] = board.stones[5, 5] = -1
        tags = position_tags(board)
        self.assertTrue(tags & KO)
        self.assertTrue(tags & FALSE_EYE)

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


class TeacherRecoveryTests(unittest.TestCase):
    def test_timeout_restarts_teacher_and_retries_with_smaller_budget(self) -> None:
        teacher = object.__new__(KataGoTeacher)
        teacher._generation = 0
        visits: list[int] = []

        def submit(query):
            visits.append(query["maxVisits"])
            if len(visits) == 1:
                raise TeacherRetry("timeout")
            return "query", object(), teacher._generation

        def restart(expected_generation, _reason):
            self.assertEqual(expected_generation, 0)
            teacher._generation += 1

        teacher._submit_group = lambda requests: [submit(teacher._query(**request)) for request in requests]
        teacher._restart = restart
        teacher._receive = lambda *_args: {"id": "query"}
        result = teacher.analyze(
            moves=[], size=9, komi=6.5, profile="rank_5k", visits=256,
            include_ownership=True,
        )
        self.assertEqual(result["id"], "query")
        self.assertEqual(visits, [256, 128])
        self.assertEqual(teacher._generation, 1)

    def test_deep_analysis_is_split_into_bounded_batches(self) -> None:
        teacher = object.__new__(KataGoTeacher)
        groups: list[int] = []
        teacher._run_with_retries = lambda requests: groups.append(len(requests)) or requests
        requests = [{"visits": 256}] * 9
        self.assertEqual(len(teacher.analyze_many(requests)), 9)
        self.assertEqual(groups, [4, 4, 1])


if __name__ == "__main__":
    unittest.main()
