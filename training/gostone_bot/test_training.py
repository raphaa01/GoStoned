from __future__ import annotations

import unittest

import numpy as np
import torch

from .board import BoardState, PASS_INDEX, policy_to_padded
from .generate import STRENGTHS, make_target_policy
from .model import GoStoneStudent, StudentConfig


class BoardEncodingTests(unittest.TestCase):
    def test_captures_and_centers_small_boards(self) -> None:
        board = BoardState(9)
        for move in ("B2", "A2", "A1", "pass", "A3"):
            board.play(move)
        features = board.features(0.4, 7.5)
        self.assertEqual(features.shape, (8, 19, 19))
        self.assertEqual(int(features[4].sum()), 81)
        self.assertEqual(int(features[1].sum()), 0)

    def test_policy_preserves_pass_and_probability(self) -> None:
        policy = np.zeros(82, dtype=np.float32)
        policy[0] = 0.75
        policy[-1] = 0.25
        padded = policy_to_padded(policy, 9)
        self.assertAlmostEqual(float(padded.sum()), 1.0)
        self.assertAlmostEqual(float(padded[PASS_INDEX]), 0.25)


class StudentModelTests(unittest.TestCase):
    def test_model_shape_size_and_rank_profiles(self) -> None:
        model = GoStoneStudent(StudentConfig())
        features = torch.zeros(2, 8, 19, 19)
        features[:, 4] = 1.0
        policy, value = model(features)
        self.assertEqual(tuple(policy.shape), (2, 362))
        self.assertEqual(tuple(value.shape), (2,))
        self.assertLess(model.parameter_count * 4, 8 * 1024 * 1024)
        self.assertEqual([profile.nominal_elo for profile in STRENGTHS], [600, 900, 1200, 1500, 1800, 2100])

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


if __name__ == "__main__":
    unittest.main()
