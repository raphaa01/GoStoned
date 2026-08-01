from __future__ import annotations

import unittest

import numpy as np
import torch

from .board import BoardState, PASS_INDEX, policy_to_padded, spatial_to_padded
from .generate import STRENGTHS, make_target_policy, settlement_targets
from .model import GoStoneStudent, StudentConfig
from .settlement import propose_settlement, score_japanese
from .train import MAX_MODEL_BYTES


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

    def test_settlement_targets_require_complete_teacher_maps(self) -> None:
        ownership, confidence = settlement_targets(
            {"ownership": [-0.5] * 81, "ownershipStdev": [0.2] * 81},
            9,
        )
        self.assertEqual(ownership.shape, (361,))
        self.assertEqual(confidence.shape, (361,))
        self.assertAlmostEqual(float(confidence.max()), 0.8)


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
