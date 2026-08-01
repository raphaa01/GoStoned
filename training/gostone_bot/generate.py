from __future__ import annotations

import argparse
import json
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np

from .board import BoardState, PASS_INDEX, padded_policy_index, policy_to_padded
from .teacher import DEFAULT_IMAGE, TEACHER_FILENAME, KataGoTeacher, default_cache_dir


@dataclass(frozen=True)
class StrengthProfile:
    name: str
    katago_profile: str
    normalized: float
    nominal_elo: int
    temperature: float


STRENGTHS = (
    StrengthProfile("novice", "rank_20k", 0.00, 600, 1.18),
    StrengthProfile("beginner", "rank_15k", 0.20, 900, 1.10),
    StrengthProfile("developing", "rank_10k", 0.40, 1200, 1.02),
    StrengthProfile("intermediate", "rank_5k", 0.60, 1500, 0.94),
    StrengthProfile("advanced", "rank_1k", 0.80, 1800, 0.86),
    StrengthProfile("strong", "rank_1d", 1.00, 2100, 0.78),
)


def searched_policy(result: dict[str, Any], size: int) -> np.ndarray:
    policy = np.zeros(PASS_INDEX + 1, dtype=np.float32)
    move_infos = result.get("moveInfos") or []
    total = sum(max(0.0, float(move.get("visits", 0))) for move in move_infos)
    if total <= 0 and move_infos:
        policy[padded_policy_index(str(move_infos[0]["move"]), size)] = 1.0
        return policy
    for move in move_infos:
        visits = max(0.0, float(move.get("visits", 0)))
        if visits:
            policy[padded_policy_index(str(move["move"]), size)] = visits / total
    return policy


def make_target_policy(
    result: dict[str, Any],
    size: int,
    search_mix: float,
    allow_pass: bool,
) -> np.ndarray:
    human = result.get("humanPolicy")
    if not isinstance(human, list):
        raise RuntimeError("KataGo did not return humanPolicy; verify the human teacher model")
    human_policy = policy_to_padded(human, size)
    moves = result.get("moveInfos") or []
    top_move = str(moves[0].get("move", "pass")) if moves else "pass"
    if allow_pass and top_move.lower() == "pass":
        target = np.zeros(PASS_INDEX + 1, dtype=np.float32)
        target[PASS_INDEX] = 1.0
        return target
    human_policy[PASS_INDEX] = 0.0
    human_policy /= max(float(human_policy.sum()), 1e-8)
    searched = searched_policy(result, size)
    if not allow_pass:
        searched[PASS_INDEX] = 0.0
        if searched.sum() > 0:
            searched /= searched.sum()
    if searched.sum() <= 0:
        return human_policy
    target = human_policy * (1.0 - search_mix) + searched * search_mix
    return target / target.sum()


def sample_move(
    target: np.ndarray,
    size: int,
    temperature: float,
    rng: np.random.Generator,
) -> str:
    adjusted = np.power(np.clip(target, 0.0, None), 1.0 / max(0.05, temperature))
    adjusted /= adjusted.sum()
    index = int(rng.choice(len(adjusted), p=adjusted))
    if index == PASS_INDEX:
        return "pass"
    offset = (19 - size) // 2
    y, x = divmod(index, 19)
    local_x, local_y = x - offset, y - offset
    if not (0 <= local_x < size and 0 <= local_y < size):
        raise RuntimeError("Sampled policy outside the active board")
    columns = "ABCDEFGHJKLMNOPQRST"
    return f"{columns[local_x]}{size - local_y}"


def generate_dataset(
    *,
    output: Path,
    games: int,
    board_sizes: tuple[int, ...],
    visits: int,
    max_moves: int | None,
    seed: int,
    image: str,
    human_model: Path,
) -> Path:
    numpy_rng = np.random.default_rng(seed)
    features: list[np.ndarray] = []
    policies: list[np.ndarray] = []
    values: list[float] = []
    profiles: list[int] = []
    board_size_values: list[int] = []
    started = time.monotonic()
    completed_games = 0

    def save_progress() -> None:
        if not features:
            return
        output.parent.mkdir(parents=True, exist_ok=True)
        temporary = output.with_name(f"{output.stem}.tmp{output.suffix}")
        np.savez_compressed(
            temporary,
            features=np.asarray(features, dtype=np.float16),
            policies=np.asarray(policies, dtype=np.float16),
            values=np.asarray(values, dtype=np.float16),
            nominal_elos=np.asarray(profiles, dtype=np.int16),
            board_sizes=np.asarray(board_size_values, dtype=np.int8),
            metadata=json.dumps(
                {
                    "format": 1,
                    "teacher": "KataGo b10c384 + human b18c384nbt-humanv0",
                    "requested_games": games,
                    "completed_games": completed_games,
                    "visits": visits,
                    "seed": seed,
                }
            ),
        )
        temporary.replace(output)

    try:
        with KataGoTeacher(human_model=human_model, image=image) as teacher:
            for game_index in range(games):
                # Cover every requested size before repeating one. This makes
                # small pilots representative and large batches balanced.
                size = board_sizes[game_index % len(board_sizes)]
                # Cycle instead of sampling so every three games cover all six
                # strength inputs, even for a tiny pilot dataset.
                black_profile = STRENGTHS[(game_index * 2) % len(STRENGTHS)]
                white_profile = STRENGTHS[(game_index * 2 + 1) % len(STRENGTHS)]
                board = BoardState(size)
                history: list[list[str]] = []
                limit = max_moves or size * size * 2
                for _ in range(limit):
                    profile = black_profile if board.to_move == 1 else white_profile
                    result = teacher.analyze(
                        moves=history,
                        size=size,
                        komi=7.5,
                        profile=profile.katago_profile,
                        visits=visits,
                    )
                    # A one-visit teacher query is useful for a pipeline smoke test,
                    # but not reliable enough to declare an early position finished.
                    # Only expose pass after a meaningful amount of the board has
                    # been played, or after the opponent has already passed.
                    allow_pass = (
                        board.move_number >= int(size * size * 0.45)
                        or board.consecutive_passes > 0
                    )
                    target = make_target_policy(
                        result,
                        size,
                        search_mix=0.18,
                        allow_pass=allow_pass,
                    )
                    root = result.get("rootInfo") or {}
                    winrate = float(root.get("winrate", 0.5))
                    features.append(board.features(profile.normalized, 7.5))
                    policies.append(target)
                    values.append(np.clip(winrate * 2.0 - 1.0, -1.0, 1.0))
                    profiles.append(profile.nominal_elo)
                    board_size_values.append(size)
                    move = sample_move(target, size, profile.temperature, numpy_rng)
                    color = "B" if board.to_move == 1 else "W"
                    board.play(move)
                    history.append([color, move])
                    if board.consecutive_passes >= 2:
                        break
                completed_games += 1
                save_progress()
                elapsed = time.monotonic() - started
                print(
                    f"game {game_index + 1}/{games}: {size}x{size}, "
                    f"{len(history)} moves, {len(features)} samples, {elapsed:.1f}s",
                    flush=True,
                )
    except BaseException:
        save_progress()
        raise
    print(f"dataset ready: {output} ({len(features)} positions)")
    return output


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Distill KataGo positions into a compact GoStone dataset")
    parser.add_argument("--output", type=Path, default=Path("training/gostone_bot/data/teacher-v1.npz"))
    parser.add_argument("--games", type=int, default=12)
    parser.add_argument("--board-sizes", type=int, nargs="+", choices=(9, 13, 19), default=(9, 13, 19))
    parser.add_argument("--visits", type=int, default=8)
    parser.add_argument("--max-moves", type=int)
    parser.add_argument("--seed", type=int, default=20260801)
    parser.add_argument("--image", default=DEFAULT_IMAGE)
    parser.add_argument("--human-model", type=Path, default=default_cache_dir() / TEACHER_FILENAME)
    return parser.parse_args()


if __name__ == "__main__":
    arguments = parse_args()
    generate_dataset(
        output=arguments.output,
        games=arguments.games,
        board_sizes=tuple(arguments.board_sizes),
        visits=arguments.visits,
        max_moves=arguments.max_moves,
        seed=arguments.seed,
        image=arguments.image,
        human_model=arguments.human_model,
    )
