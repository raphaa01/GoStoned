from __future__ import annotations

import argparse
import copy
import json
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

import numpy as np

from .board import BoardState, PASS_INDEX, board_offset, padded_policy_index, policy_to_padded, spatial_to_padded
from .curriculum import (
    ATARI, DAME, DEAD_INVASION, FALSE_EYE, KO, SEKI, SNAPBACK, TERMINAL_WINDOW,
    position_tags, settlement_labels,
)
from .runtime import StopRequested
from .teacher import DEFAULT_IMAGE, TEACHER_FILENAME, KataGoTeacher, default_cache_dir

JAPANESE_KOMI = 6.5
DATASET_FORMAT = 5
TERMINAL_OFFSETS = (2, 4, 8, 16, 32)
HARD_TAGS = KO | ATARI | FALSE_EYE | SNAPBACK | DAME | SEKI | DEAD_INVASION


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
    return max(requested, size * size) if ensure_endgame else requested


def split_for_game(game_index: int, board_size_count: int = 3, technical: bool = False) -> str:
    if technical:
        return "train"
    # Whole games stay in one split. Every ten rounds include every board size
    # once in validation and once in the locked test split.
    bucket = (game_index // board_size_count) % 10
    return "train" if bucket < 8 else "validation" if bucket == 8 else "test"


@dataclass
class TrainingGame:
    features: list[np.ndarray]
    policies: list[np.ndarray]
    values: list[float]
    scores: list[float]
    ownerships: list[np.ndarray]
    ownership_weights: list[np.ndarray]
    status_targets: list[np.ndarray]
    status_weights: list[np.ndarray]
    territory_targets: list[np.ndarray]
    territory_weights: list[np.ndarray]
    position_kinds: list[int]
    nominal_elos: list[int]
    board_sizes: list[int]
    moves: int

    @classmethod
    def empty(cls) -> "TrainingGame":
        return cls([], [], [], [], [], [], [], [], [], [], [], [], [], 0)

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


def make_target_policy(result: dict[str, Any], size: int, search_mix: float, allow_pass: bool) -> np.ndarray:
    human = result.get("humanPolicy")
    if not isinstance(human, list):
        raise RuntimeError("KataGo did not return humanPolicy; verify the human teacher model")
    human_policy = policy_to_padded(human, size)
    moves = result.get("moveInfos") or []
    top_move = str(moves[0].get("move", "pass")) if moves else "pass"
    if allow_pass and top_move.lower() == "pass":
        target = np.zeros(PASS_INDEX + 1, dtype=np.float32); target[PASS_INDEX] = 1.0
        return target
    human_policy[PASS_INDEX] = 0.0
    if human_policy.sum() > 0: human_policy /= human_policy.sum()
    searched = searched_policy(result, size)
    if not allow_pass:
        searched[PASS_INDEX] = 0.0
        if searched.sum() > 0: searched /= searched.sum()
    if searched.sum() <= 0: return human_policy
    if human_policy.sum() <= 0: return searched
    target = human_policy * (1.0 - search_mix) + searched * search_mix
    return target / target.sum()


def sample_move(target: np.ndarray, size: int, temperature: float, rng: np.random.Generator) -> str:
    adjusted = np.power(np.clip(target, 0.0, None), 1.0 / max(0.05, temperature)); adjusted /= adjusted.sum()
    index = int(rng.choice(len(adjusted), p=adjusted))
    if index == PASS_INDEX: return "pass"
    offset = board_offset(size); y, x = divmod(index, 19); local_x, local_y = x - offset, y - offset
    if not (0 <= local_x < size and 0 <= local_y < size):
        raise RuntimeError("Sampled policy outside the active board")
    return f"ABCDEFGHJKLMNOPQRST"[local_x] + str(size - local_y)


def settlement_targets(
    result: dict[str, Any], size: int, to_move: int = -1,
) -> tuple[np.ndarray, np.ndarray]:
    """Convert SIDETOMOVE ownership to the fixed -Black/+White contract."""
    ownership = result.get("ownership"); stdev = result.get("ownershipStdev")
    if not isinstance(ownership, list) or len(ownership) != size * size:
        raise RuntimeError("KataGo did not return a complete Japanese ownership map")
    perspective_factor = -1.0 if to_move == 1 else 1.0
    ownership_target = spatial_to_padded(np.asarray(ownership, dtype=np.float32) * perspective_factor, size)
    if isinstance(stdev, list) and len(stdev) == size * size:
        confidence = 1.0 - np.clip(spatial_to_padded(stdev, size, fill=1.0), 0.0, 1.0)
    else:
        confidence = np.zeros(PASS_INDEX, dtype=np.float32)
    offset = board_offset(size); mask = np.zeros((19, 19), dtype=np.float32)
    mask[offset : offset + size, offset : offset + size] = 1.0
    return ownership_target, confidence * mask.reshape(-1)


def _root_targets(result: dict[str, Any], size: int) -> tuple[float, float]:
    root = result.get("rootInfo") or {}
    winrate = float(root.get("winrate", 0.5)); score_lead = float(root.get("scoreLead", 0.0))
    return float(np.clip(winrate * 2.0 - 1.0, -1.0, 1.0)), float(np.clip(score_lead / (size * size), -1.0, 1.0))


def _deep_indices(tags: list[int], limit: int) -> list[int]:
    selected = {len(tags) - offset for offset in TERMINAL_OFFSETS if len(tags) - offset >= 0}
    if tags: selected.add(len(tags) - 1)
    tactical = [index for index, mask in enumerate(tags) if mask & HARD_TAGS]
    # Prefer diverse recent tactical positions, then fill terminal windows.
    for index in reversed(tactical):
        if len(selected) >= limit: break
        selected.add(index)
    return sorted(selected, reverse=True)[:limit]


def generate_game_samples(
    *, teacher: KataGoTeacher, game_index: int, board_sizes: tuple[int, ...],
    normal_visits: int, endgame_visits: int, max_moves: int, seed: int,
    ensure_endgame: bool = False, hard_visits: int | None = None,
    settlement_samples: int = 12, control: Callable[[], None] | None = None,
    on_position: Callable[[int, int, int, int], None] | None = None,
) -> TrainingGame:
    if not board_sizes or any(size not in (9, 13, 19) for size in board_sizes):
        raise ValueError("Training requires at least one supported board size")
    size = board_sizes[game_index % len(board_sizes)]
    black_profile, white_profile = training_profiles(game_index, len(board_sizes))
    rng = np.random.default_rng(seed + game_index * 10_007)
    board = BoardState(size); history: list[list[str]] = []; game = TrainingGame.empty()
    snapshots: list[BoardState] = []; histories: list[list[list[str]]] = []; profiles: list[StrengthProfile] = []
    position_limit = training_position_limit(size, max_moves, ensure_endgame)
    try:
        for position_index in range(position_limit):
            if control: control()
            profile = black_profile if board.to_move == 1 else white_profile
            result = teacher.analyze(
                moves=history, size=size, komi=JAPANESE_KOMI, profile=profile.katago_profile,
                visits=normal_visits, include_ownership=False,
            )
            is_endgame = board.move_number >= int(size * size * 0.45)
            allow_pass = is_endgame or board.consecutive_passes > 0
            target = make_target_policy(result, size, search_mix=0.18, allow_pass=allow_pass)
            value, score = _root_targets(result, size)
            snapshot = copy.deepcopy(board); tags = position_tags(snapshot)
            snapshots.append(snapshot); histories.append([move.copy() for move in history]); profiles.append(profile)
            game.features.append(snapshot.features(profile.normalized, JAPANESE_KOMI)); game.policies.append(target)
            game.values.append(value); game.scores.append(score)
            game.ownerships.append(np.zeros(PASS_INDEX, dtype=np.float32)); game.ownership_weights.append(np.zeros(PASS_INDEX, dtype=np.float32))
            game.status_targets.append(np.full(PASS_INDEX, 3, dtype=np.int8)); game.status_weights.append(np.zeros(PASS_INDEX, dtype=np.float32))
            game.territory_targets.append(np.full(PASS_INDEX, 2, dtype=np.int8)); game.territory_weights.append(np.zeros(PASS_INDEX, dtype=np.float32))
            game.position_kinds.append(tags); game.nominal_elos.append(profile.nominal_elo); game.board_sizes.append(size)
            move = sample_move(target, size, profile.temperature, rng); color = "B" if board.to_move == 1 else "W"
            board.play(move); history.append([color, move])
            if on_position: on_position(position_index + 1, position_limit, size, normal_visits)
            if board.consecutive_passes >= 2: break

        selected = _deep_indices(game.position_kinds, settlement_samples)
        requests = []
        for index in selected:
            snapshot = snapshots[index]
            visits = (hard_visits or endgame_visits) if game.position_kinds[index] & HARD_TAGS else endgame_visits
            requests.append({
                "moves": histories[index], "size": size, "komi": JAPANESE_KOMI,
                "profile": profiles[index].katago_profile, "visits": visits, "include_ownership": True,
            })
        if control: control()
        for index, result in zip(selected, teacher.analyze_many(requests)):
            if control: control()
            snapshot = snapshots[index]
            ownership, confidence = settlement_targets(result, size, snapshot.to_move)
            labels = settlement_labels(snapshot, ownership, confidence)
            game.ownerships[index] = ownership; game.ownership_weights[index] = confidence
            game.status_targets[index] = labels.status_targets; game.status_weights[index] = labels.status_weights
            game.territory_targets[index] = labels.territory_targets; game.territory_weights[index] = labels.territory_weights
            game.position_kinds[index] = labels.tags | TERMINAL_WINDOW
            game.values[index], game.scores[index] = _root_targets(result, size)
            if on_position: on_position(index + 1, position_limit, size, int(requests[selected.index(index)]["visits"]))
    except StopRequested as error:
        game.moves = len(history); error.partial_game = game; raise
    game.moves = len(history)
    return game


def save_game_archive(path: Path, game: TrainingGame, metadata: dict[str, Any]) -> None:
    if game.positions == 0: raise ValueError("Cannot save an empty training game")
    path.parent.mkdir(parents=True, exist_ok=True); temporary = path.with_name(f"{path.stem}.tmp{path.suffix}")
    np.savez_compressed(
        temporary,
        features=np.asarray(game.features, dtype=np.float16), policies=np.asarray(game.policies, dtype=np.float16),
        values=np.asarray(game.values, dtype=np.float16), scores=np.asarray(game.scores, dtype=np.float16),
        ownerships=np.asarray(game.ownerships, dtype=np.float16), ownership_weights=np.asarray(game.ownership_weights, dtype=np.float16),
        status_targets=np.asarray(game.status_targets, dtype=np.int8), status_weights=np.asarray(game.status_weights, dtype=np.float16),
        territory_targets=np.asarray(game.territory_targets, dtype=np.int8), territory_weights=np.asarray(game.territory_weights, dtype=np.float16),
        position_kinds=np.asarray(game.position_kinds, dtype=np.int16), nominal_elos=np.asarray(game.nominal_elos, dtype=np.int16),
        board_sizes=np.asarray(game.board_sizes, dtype=np.int8),
        metadata=json.dumps({"format": DATASET_FORMAT, "rules": "japanese", "ownership_perspective": "fixed-white", **metadata}),
    )
    temporary.replace(path)


def generate_dataset(
    *, output: Path, games: int, board_sizes: tuple[int, ...], visits: int,
    max_moves: int | None, seed: int, image: str, human_model: Path,
    endgame_visits: int | None = None,
) -> Path:
    output.mkdir(parents=True, exist_ok=True); started = time.monotonic()
    with KataGoTeacher(human_model=human_model, image=image) as teacher:
        for game_index in range(games):
            game = generate_game_samples(
                teacher=teacher, game_index=game_index, board_sizes=board_sizes,
                normal_visits=visits, endgame_visits=endgame_visits or visits,
                hard_visits=max(endgame_visits or visits, 64), max_moves=max_moves or max(board_sizes) ** 2 * 2,
                seed=seed, ensure_endgame=True,
            )
            save_game_archive(output / f"game-{game_index:05d}.npz", game, {
                "teacher": "KataGo b10c384 + human b18c384nbt-humanv0", "game_index": game_index,
                "split": split_for_game(game_index, len(board_sizes)), "moves": game.moves,
                "normal_visits": visits, "endgame_visits": endgame_visits or visits, "seed": seed,
            })
            print(f"game {game_index + 1}/{games}: {game.positions} samples, {time.monotonic() - started:.1f}s", flush=True)
    return output


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Distill Japanese-rules KataGo positions for GoStone V5")
    parser.add_argument("--output", type=Path, default=Path("training/gostone_bot/data/teacher-v5"))
    parser.add_argument("--games", type=int, default=30); parser.add_argument("--board-sizes", type=int, nargs="+", choices=(9, 13, 19), default=(9, 13, 19))
    parser.add_argument("--visits", type=int, default=1); parser.add_argument("--endgame-visits", type=int, default=64)
    parser.add_argument("--max-moves", type=int); parser.add_argument("--seed", type=int, default=20260909)
    parser.add_argument("--image", default=DEFAULT_IMAGE); parser.add_argument("--human-model", type=Path, default=default_cache_dir() / TEACHER_FILENAME)
    return parser.parse_args()


if __name__ == "__main__":
    arguments = parse_args()
    generate_dataset(
        output=arguments.output, games=arguments.games, board_sizes=tuple(arguments.board_sizes), visits=arguments.visits,
        endgame_visits=arguments.endgame_visits, max_moves=arguments.max_moves, seed=arguments.seed,
        image=arguments.image, human_model=arguments.human_model,
    )
