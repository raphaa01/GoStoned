from __future__ import annotations

import argparse
import json
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

import numpy as np

from .board import (
    BoardState,
    PASS_INDEX,
    board_offset,
    padded_policy_index,
    policy_to_padded,
    spatial_to_padded,
)
from .teacher import DEFAULT_IMAGE, TEACHER_FILENAME, KataGoTeacher, default_cache_dir
from .runtime import StopRequested

JAPANESE_KOMI = 6.5
DATASET_FORMAT = 2


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


def training_profiles(game_index: int, board_size_count: int = 3) -> tuple[StrengthProfile, StrengthProfile]:
    if game_index < 0 or board_size_count <= 0:
        raise ValueError("game_index must be nonnegative and board_size_count positive")
    profile_index = (game_index // board_size_count) % len(STRENGTHS)
    black = STRENGTHS[profile_index]
    white = STRENGTHS[(profile_index + len(STRENGTHS) // 2) % len(STRENGTHS)]
    return black, white


def training_position_limit(size: int, requested: int, ensure_endgame: bool) -> int:
    if requested <= 0:
        raise ValueError("max_moves must be positive")
    # Real runs may stop earlier after two passes, but never cut a game off
    # before it has enough room to reach a natural Japanese settlement.
    return max(requested, size * size) if ensure_endgame else requested


@dataclass
class TrainingGame:
    features: list[np.ndarray]
    policies: list[np.ndarray]
    values: list[float]
    scores: list[float]
    ownerships: list[np.ndarray]
    ownership_weights: list[np.ndarray]
    nominal_elos: list[int]
    board_sizes: list[int]
    moves: int

    @property
    def positions(self) -> int:
        return len(self.features)


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
    human_total = float(human_policy.sum())
    if human_total > 0:
        human_policy /= human_total
    searched = searched_policy(result, size)
    if not allow_pass:
        searched[PASS_INDEX] = 0.0
        searched_total = float(searched.sum())
        if searched_total > 0:
            searched /= searched_total
    if searched.sum() <= 0:
        if human_policy.sum() <= 0:
            raise RuntimeError("KataGo teacher offered no non-pass move in an unfinished position")
        return human_policy
    if human_policy.sum() <= 0:
        return searched
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
    offset = board_offset(size)
    y, x = divmod(index, 19)
    local_x, local_y = x - offset, y - offset
    if not (0 <= local_x < size and 0 <= local_y < size):
        raise RuntimeError("Sampled policy outside the active board")
    columns = "ABCDEFGHJKLMNOPQRST"
    return f"{columns[local_x]}{size - local_y}"


def settlement_targets(result: dict[str, Any], size: int) -> tuple[np.ndarray, np.ndarray]:
    ownership = result.get("ownership")
    stdev = result.get("ownershipStdev")
    if not isinstance(ownership, list) or len(ownership) != size * size:
        raise RuntimeError("KataGo did not return a complete Japanese ownership map")
    ownership_target = spatial_to_padded(ownership, size)
    if isinstance(stdev, list) and len(stdev) == size * size:
        confidence = 1.0 - np.clip(spatial_to_padded(stdev, size, fill=1.0), 0.0, 1.0)
    else:
        confidence = np.zeros(PASS_INDEX, dtype=np.float32)
    offset = board_offset(size)
    mask = np.zeros(PASS_INDEX, dtype=np.float32).reshape(19, 19)
    mask[offset : offset + size, offset : offset + size] = 1.0
    return ownership_target, confidence * mask.reshape(-1)


def generate_game_samples(
    *,
    teacher: KataGoTeacher,
    game_index: int,
    board_sizes: tuple[int, ...],
    normal_visits: int,
    endgame_visits: int,
    max_moves: int,
    seed: int,
    ensure_endgame: bool = False,
    control: Callable[[], None] | None = None,
    on_position: Callable[[int, int, int, int], None] | None = None,
) -> TrainingGame:
    if not board_sizes or any(size not in (9, 13, 19) for size in board_sizes):
        raise ValueError("Training requires at least one supported board size")
    size = board_sizes[game_index % len(board_sizes)]
    # Both colors cycle through every rank equally. The former adjacent-pair
    # schedule always made White stronger and taught a harmful color bias.
    black_profile, white_profile = training_profiles(game_index, len(board_sizes))
    rng = np.random.default_rng(seed + game_index * 10_007)
    board = BoardState(size)
    history: list[list[str]] = []
    game = TrainingGame([], [], [], [], [], [], [], [], 0)
    position_limit = training_position_limit(size, max_moves, ensure_endgame)
    try:
        for position_index in range(position_limit):
            if control:
                control()
            profile = black_profile if board.to_move == 1 else white_profile
            is_endgame = board.move_number >= int(size * size * 0.45)
            visits = endgame_visits if is_endgame else normal_visits
            result = teacher.analyze(
                moves=history,
                size=size,
                komi=JAPANESE_KOMI,
                profile=profile.katago_profile,
                visits=visits,
                include_ownership=True,
            )
            allow_pass = is_endgame or board.consecutive_passes > 0
            target = make_target_policy(result, size, search_mix=0.18, allow_pass=allow_pass)
            ownership, ownership_weight = settlement_targets(result, size)
            root = result.get("rootInfo") or {}
            winrate = float(root.get("winrate", 0.5))
            score_lead = float(root.get("scoreLead", 0.0))
            game.features.append(board.features(profile.normalized, JAPANESE_KOMI))
            game.policies.append(target)
            game.values.append(float(np.clip(winrate * 2.0 - 1.0, -1.0, 1.0)))
            game.scores.append(float(np.clip(score_lead / (size * size), -1.0, 1.0)))
            game.ownerships.append(ownership)
            game.ownership_weights.append(ownership_weight)
            game.nominal_elos.append(profile.nominal_elo)
            game.board_sizes.append(size)
            move = sample_move(target, size, profile.temperature, rng)
            color = "B" if board.to_move == 1 else "W"
            board.play(move)
            history.append([color, move])
            if on_position:
                on_position(position_index + 1, position_limit, size, visits)
            if board.consecutive_passes >= 2:
                break
    except StopRequested as error:
        game.moves = len(history)
        error.partial_game = game
        raise
    game.moves = len(history)
    return game


def save_game_archive(path: Path, game: TrainingGame, metadata: dict[str, Any]) -> None:
    if game.positions == 0:
        raise ValueError("Cannot save an empty training game")
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f"{path.stem}.tmp{path.suffix}")
    np.savez_compressed(
        temporary,
        features=np.asarray(game.features, dtype=np.float16),
        policies=np.asarray(game.policies, dtype=np.float16),
        values=np.asarray(game.values, dtype=np.float16),
        scores=np.asarray(game.scores, dtype=np.float16),
        ownerships=np.asarray(game.ownerships, dtype=np.float16),
        ownership_weights=np.asarray(game.ownership_weights, dtype=np.float16),
        nominal_elos=np.asarray(game.nominal_elos, dtype=np.int16),
        board_sizes=np.asarray(game.board_sizes, dtype=np.int8),
        metadata=json.dumps({"format": DATASET_FORMAT, "rules": "japanese", **metadata}),
    )
    temporary.replace(path)


def combine_games(games: list[TrainingGame]) -> TrainingGame:
    combined = TrainingGame([], [], [], [], [], [], [], [], 0)
    for game in games:
        combined.features.extend(game.features)
        combined.policies.extend(game.policies)
        combined.values.extend(game.values)
        combined.scores.extend(game.scores)
        combined.ownerships.extend(game.ownerships)
        combined.ownership_weights.extend(game.ownership_weights)
        combined.nominal_elos.extend(game.nominal_elos)
        combined.board_sizes.extend(game.board_sizes)
        combined.moves += game.moves
    return combined


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
    endgame_visits: int | None = None,
) -> Path:
    generated: list[TrainingGame] = []
    started = time.monotonic()
    with KataGoTeacher(human_model=human_model, image=image) as teacher:
        for game_index in range(games):
            game = generate_game_samples(
                teacher=teacher,
                game_index=game_index,
                board_sizes=board_sizes,
                normal_visits=visits,
                endgame_visits=endgame_visits or visits,
                max_moves=max_moves or max(board_sizes) * max(board_sizes) * 2,
                seed=seed,
            )
            generated.append(game)
            combined = combine_games(generated)
            save_game_archive(
                output,
                combined,
                {
                    "teacher": "KataGo b10c384 + human b18c384nbt-humanv0",
                    "requested_games": games,
                    "completed_games": game_index + 1,
                    "normal_visits": visits,
                    "endgame_visits": endgame_visits or visits,
                    "seed": seed,
                },
            )
            elapsed = time.monotonic() - started
            print(
                f"game {game_index + 1}/{games}: {game.board_sizes[0]}x{game.board_sizes[0]}, "
                f"{game.moves} moves, {combined.positions} samples, {elapsed:.1f}s",
                flush=True,
            )
    print(f"dataset ready: {output} ({sum(game.positions for game in generated)} positions)")
    return output


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Distill Japanese-rules KataGo positions for GoStone")
    parser.add_argument("--output", type=Path, default=Path("training/gostone_bot/data/teacher-v2.npz"))
    parser.add_argument("--games", type=int, default=12)
    parser.add_argument("--board-sizes", type=int, nargs="+", choices=(9, 13, 19), default=(9, 13, 19))
    parser.add_argument("--visits", type=int, default=1)
    parser.add_argument("--endgame-visits", type=int, default=12)
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
        endgame_visits=arguments.endgame_visits,
        max_moves=arguments.max_moves,
        seed=arguments.seed,
        image=arguments.image,
        human_model=arguments.human_model,
    )
