from __future__ import annotations

import copy
import json
import math
import secrets
import threading
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

import numpy as np
import torch

from .board import BoardState, PASS_INDEX, padded_policy_index, point_to_gtp
from .generate import JAPANESE_KOMI, STRENGTHS
from .model import GoStoneStudent, StudentConfig
from .settlement import propose_settlement

SUPPORTED_ELOS = tuple(profile.nominal_elo for profile in STRENGTHS)
MAX_MODEL_BYTES = 8 * 1024 * 1024


@dataclass(frozen=True)
class ModelArtifact:
    id: str
    run_dir: Path
    checkpoint: Path
    onnx: Path
    metadata: Path
    label: str
    created_at: float
    onnx_bytes: int
    model_version: int | None
    technical_test: bool

    def public(self) -> dict[str, object]:
        return {
            "id": self.id,
            "label": self.label,
            "created_at": self.created_at,
            "onnx_bytes": self.onnx_bytes,
            "onnx_mib": round(self.onnx_bytes / 1024 / 1024, 2),
            "model_version": self.model_version,
            "technical_test": self.technical_test,
        }


class ModelCatalog:
    def __init__(self, runs_dir: Path):
        self.runs_dir = runs_dir

    def artifacts(self) -> list[ModelArtifact]:
        candidates: list[dict[str, Any]] = []
        if not self.runs_dir.is_dir():
            return []
        for run_dir in self.runs_dir.iterdir():
            if not run_dir.is_dir():
                continue
            artifact_dir = run_dir / "artifact"
            checkpoint = artifact_dir / "gostone-japanese-v1.pt"
            onnx = artifact_dir / "gostone-japanese-v1.onnx"
            metadata_path = artifact_dir / "gostone-japanese-v1.json"
            if not all(path.is_file() for path in (checkpoint, onnx, metadata_path)):
                continue
            if onnx.stat().st_size > MAX_MODEL_BYTES:
                continue
            try:
                metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
                if metadata.get("rules") != "japanese" or float(metadata.get("komi")) != JAPANESE_KOMI:
                    continue
                config_path = run_dir / "config.json"
                config = json.loads(config_path.read_text(encoding="utf-8")) if config_path.is_file() else {}
                preset = config.get("preset", {}) if isinstance(config, dict) else {}
                created_at = float(config.get("created_at", onnx.stat().st_mtime)) if isinstance(config, dict) else onnx.stat().st_mtime
            except (OSError, ValueError, TypeError, json.JSONDecodeError):
                continue
            preset_id = str(preset.get("id", "")) if isinstance(preset, dict) else ""
            raw_version = config.get("model_version") if isinstance(config, dict) else None
            version = raw_version if isinstance(raw_version, int) and raw_version > 0 else None
            candidates.append(
                {
                    "id": run_dir.name,
                    "run_dir": run_dir,
                    "checkpoint": checkpoint,
                    "onnx": onnx,
                    "metadata": metadata_path,
                    "created_at": created_at,
                    "onnx_bytes": onnx.stat().st_size,
                    "model_version": version,
                    "technical_test": preset_id == "smoke",
                }
            )
        candidates.sort(key=lambda item: float(item["created_at"]))
        used_versions = {
            int(item["model_version"])
            for item in candidates
            if item["model_version"] is not None and not item["technical_test"]
        }
        next_legacy_version = 1
        result: list[ModelArtifact] = []
        for item in candidates:
            version = item["model_version"]
            if not item["technical_test"] and version is None:
                while next_legacy_version in used_versions:
                    next_legacy_version += 1
                version = next_legacy_version
                used_versions.add(version)
                next_legacy_version += 1
            date = time.strftime("%d.%m.%Y %H:%M", time.localtime(float(item["created_at"])))
            label = f"GoStone Techniktest · {date}" if item["technical_test"] else f"GoStone Bot v{version} · {date}"
            result.append(ModelArtifact(**{**item, "model_version": version, "label": label}))
        return sorted(result, key=lambda artifact: artifact.created_at, reverse=True)

    def resolve(self, model_id: str) -> ModelArtifact:
        for artifact in self.artifacts():
            if secrets.compare_digest(artifact.id, model_id):
                return artifact
        raise ValueError("Dieses fertige Modell wurde nicht gefunden.")


@dataclass
class ArenaSession:
    id: str
    model_id: str
    board: BoardState
    elo: int
    strength: float
    human_color: int
    history: list[np.ndarray]
    mode: str = "human"
    black_model_id: str | None = None
    white_model_id: str | None = None
    black_label: str = "Schwarz"
    white_label: str = "Weiß"
    moves: list[str] = field(default_factory=list)
    finished: bool = False
    finished_reason: str | None = None
    proposal: dict[str, object] | None = None
    created_at: float = field(default_factory=time.time)


class ArenaService:
    def __init__(self, runs_dir: Path):
        self.catalog = ModelCatalog(runs_dir)
        self._models: dict[str, GoStoneStudent] = {}
        self._sessions: dict[str, ArenaSession] = {}
        self._lock = threading.RLock()

    def models(self) -> list[dict[str, object]]:
        return [artifact.public() for artifact in self.catalog.artifacts()]

    def _load_model(self, artifact: ModelArtifact) -> GoStoneStudent:
        cached = self._models.get(artifact.id)
        if cached is not None:
            return cached
        saved = torch.load(artifact.checkpoint, map_location="cpu", weights_only=True)
        raw_config = saved.get("config")
        state_dict = saved.get("state_dict")
        if not isinstance(raw_config, dict) or not isinstance(state_dict, dict):
            raise ValueError("Der Modell-Checkpoint ist unvollständig.")
        allowed = {"channels", "blocks", "input_planes", "board_size"}
        if set(raw_config) != allowed:
            raise ValueError("Der Modell-Checkpoint verwendet eine unbekannte Architektur.")
        config = StudentConfig(**{key: int(raw_config[key]) for key in allowed})
        model = GoStoneStudent(config)
        model.load_state_dict(state_dict, strict=True)
        model.eval()
        self._models[artifact.id] = model
        return model

    @staticmethod
    def _try_move(session: ArenaSession, move: str) -> BoardState | None:
        candidate = copy.deepcopy(session.board)
        try:
            candidate.play(move)
        except ValueError:
            return None
        if move.lower() != "pass" and len(session.history) >= 2:
            if np.array_equal(candidate.stones, session.history[-2]):
                return None
        return candidate

    def _commit_move(self, session: ArenaSession, move: str) -> None:
        candidate = self._try_move(session, move)
        if candidate is None:
            raise ValueError("Dieser Zug ist nach japanischen Regeln nicht erlaubt.")
        session.board = candidate
        session.history.append(candidate.stones.copy())
        session.moves.append(move)
        session.finished = candidate.consecutive_passes >= 2
        if session.finished:
            session.finished_reason = "two_passes"

    def _inference(
        self,
        session: ArenaSession,
        model_id: str | None = None,
    ) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        artifact = self.catalog.resolve(model_id or session.model_id)
        model = self._load_model(artifact)
        features = torch.from_numpy(session.board.features(session.strength, JAPANESE_KOMI)).unsqueeze(0)
        with torch.inference_mode():
            policy, _, _, ownership, survival = model(features)
        return (
            policy[0].cpu().numpy(),
            ownership[0].cpu().numpy(),
            survival[0].cpu().numpy(),
        )

    def _bot_move(self, session: ArenaSession, model_id: str | None = None) -> str:
        policy, _, _ = self._inference(session, model_id)
        legal: list[tuple[str, int]] = []
        for y in range(session.board.size):
            for x in range(session.board.size):
                if session.board.stones[y, x] != 0:
                    continue
                move = point_to_gtp(x, y, session.board.size)
                if self._try_move(session, move) is not None:
                    legal.append((move, padded_policy_index(move, session.board.size)))
        legal.append(("pass", PASS_INDEX))
        logits = np.asarray([policy[index] for _, index in legal], dtype=np.float64)
        if session.board.consecutive_passes == 0 and session.board.move_number < session.board.size * 2:
            logits[-1] = -math.inf
        order = np.argsort(-logits)
        top_k = max(1, round(1 + (1.0 - session.strength) * 10))
        candidates = order[: min(top_k, len(order))]
        candidate_logits = logits[candidates]
        finite = np.isfinite(candidate_logits)
        if not finite.any():
            return legal[int(order[0])][0]
        candidates = candidates[finite]
        candidate_logits = candidate_logits[finite]
        temperature = 0.28 + (1.0 - session.strength) * 1.05
        weights = np.exp((candidate_logits - np.max(candidate_logits)) / temperature)
        weights /= weights.sum()
        seed = int.from_bytes(session.id.encode("utf-8")[:8].ljust(8, b"0"), "little") + len(session.moves)
        choice = int(np.random.default_rng(seed).choice(candidates, p=weights))
        return legal[choice][0]

    def _settle(self, session: ArenaSession) -> None:
        _, ownership, survival = self._inference(session)
        proposal = propose_settlement(
            session.board.stones,
            survival_logits=survival,
            ownership=ownership,
            captured_white_by_black=session.board.captured_white_by_black,
            captured_black_by_white=session.board.captured_black_by_white,
            komi=JAPANESE_KOMI,
        )
        session.proposal = {
            "groups": [asdict(group) for group in proposal.groups],
            "dead_stones": proposal.dead_stones,
            "uncertain_stones": proposal.uncertain_stones,
            "neutral_region_seeds": proposal.neutral_region_seeds,
            "score": proposal.score.as_dict(),
            "notice": "Modellvorschlag – für ein echtes Ergebnis müssen beide Spieler dieselbe Auswahl bestätigen.",
        }

    def _settle_match(self, session: ArenaSession) -> None:
        if session.black_model_id is None or session.white_model_id is None:
            raise ValueError("Der Modellvergleich ist unvollständig.")
        _, black_ownership, black_survival = self._inference(session, session.black_model_id)
        _, white_ownership, white_survival = self._inference(session, session.white_model_id)
        proposal = propose_settlement(
            session.board.stones,
            survival_logits=(black_survival + white_survival) / 2,
            ownership=(black_ownership + white_ownership) / 2,
            captured_white_by_black=session.board.captured_white_by_black,
            captured_black_by_white=session.board.captured_black_by_white,
            komi=JAPANESE_KOMI,
        )
        session.proposal = {
            "groups": [asdict(group) for group in proposal.groups],
            "dead_stones": proposal.dead_stones,
            "uncertain_stones": proposal.uncertain_stones,
            "neutral_region_seeds": proposal.neutral_region_seeds,
            "score": proposal.score.as_dict(),
            "notice": "Gemeinsamer Endstandsvorschlag aus den Bewertungen beider Testmodelle.",
        }

    def _public(self, session: ArenaSession, bot_move: str | None = None) -> dict[str, object]:
        move_history = []
        for index, move in enumerate(session.moves):
            color = "black" if index % 2 == 0 else "white"
            move_history.append(
                {
                    "number": index + 1,
                    "color": color,
                    "move": move,
                    "model_id": session.black_model_id if color == "black" else session.white_model_id,
                    "label": session.black_label if color == "black" else session.white_label,
                }
            )
        return {
            "session_id": session.id,
            "mode": session.mode,
            "model_id": session.model_id,
            "black_model_id": session.black_model_id,
            "white_model_id": session.white_model_id,
            "black_label": session.black_label,
            "white_label": session.white_label,
            "board_size": session.board.size,
            "board": session.board.stones.tolist(),
            "to_move": "black" if session.board.to_move == 1 else "white",
            "human_color": (
                "black" if session.human_color == 1 else "white"
            ) if session.mode == "human" else None,
            "move_number": session.board.move_number,
            "moves": move_history,
            "consecutive_passes": session.board.consecutive_passes,
            "black_prisoners": session.board.captured_white_by_black,
            "white_prisoners": session.board.captured_black_by_white,
            "last_move": session.moves[-1] if session.moves else None,
            "bot_move": bot_move,
            "finished": session.finished,
            "finished_reason": session.finished_reason,
            "proposal": session.proposal,
            "rules": "japanese",
            "komi": JAPANESE_KOMI,
        }

    def _get(self, session_id: str) -> ArenaSession:
        session = self._sessions.get(session_id)
        if session is None:
            raise ValueError("Diese Testpartie existiert nicht mehr.")
        return session

    def start(self, model_id: str, board_size: int, elo: int, human_color: str) -> dict[str, object]:
        with self._lock:
            artifact = self.catalog.resolve(model_id)
            self._load_model(artifact)
            if board_size not in (9, 13, 19):
                raise ValueError("Bitte 9×9, 13×13 oder 19×19 auswählen.")
            if elo not in SUPPORTED_ELOS:
                raise ValueError("Diese Teststufe wird nicht unterstützt.")
            if human_color not in {"black", "white"}:
                raise ValueError("Bitte Schwarz oder Weiß auswählen.")
            board = BoardState(board_size)
            session = ArenaSession(
                id=secrets.token_urlsafe(18),
                model_id=model_id,
                board=board,
                elo=elo,
                strength=(elo - SUPPORTED_ELOS[0]) / (SUPPORTED_ELOS[-1] - SUPPORTED_ELOS[0]),
                human_color=1 if human_color == "black" else -1,
                history=[board.stones.copy()],
                black_model_id=model_id if human_color == "white" else None,
                white_model_id=model_id if human_color == "black" else None,
                black_label=artifact.label if human_color == "white" else "Du",
                white_label=artifact.label if human_color == "black" else "Du",
            )
            self._sessions[session.id] = session
            if len(self._sessions) > 8:
                oldest = min(self._sessions.values(), key=lambda item: item.created_at)
                if oldest.id != session.id:
                    self._sessions.pop(oldest.id, None)
            bot_move = None
            if session.human_color == -1:
                bot_move = self._bot_move(session)
                self._commit_move(session, bot_move)
            return self._public(session, bot_move)

    def move(self, session_id: str, move: str) -> dict[str, object]:
        with self._lock:
            session = self._get(session_id)
            if session.finished:
                raise ValueError("Die Testpartie ist bereits beendet.")
            if session.board.to_move != session.human_color:
                raise ValueError("Der Bot ist gerade am Zug.")
            self._commit_move(session, move)
            bot_move = None
            if not session.finished:
                bot_move = self._bot_move(session)
                self._commit_move(session, bot_move)
            if session.finished:
                self._settle(session)
            return self._public(session, bot_move)

    def start_match(
        self,
        black_model_id: str,
        white_model_id: str,
        board_size: int,
        elo: int,
    ) -> dict[str, object]:
        with self._lock:
            black_artifact = self.catalog.resolve(black_model_id)
            white_artifact = self.catalog.resolve(white_model_id)
            self._load_model(black_artifact)
            self._load_model(white_artifact)
            if board_size not in (9, 13, 19):
                raise ValueError("Bitte 9×9, 13×13 oder 19×19 auswählen.")
            if elo not in SUPPORTED_ELOS:
                raise ValueError("Diese Teststufe wird nicht unterstützt.")
            board = BoardState(board_size)
            session = ArenaSession(
                id=secrets.token_urlsafe(18),
                model_id=black_model_id,
                board=board,
                elo=elo,
                strength=(elo - SUPPORTED_ELOS[0]) / (SUPPORTED_ELOS[-1] - SUPPORTED_ELOS[0]),
                human_color=0,
                history=[board.stones.copy()],
                mode="model_match",
                black_model_id=black_model_id,
                white_model_id=white_model_id,
                black_label=black_artifact.label,
                white_label=white_artifact.label,
            )
            self._sessions[session.id] = session
            if len(self._sessions) > 8:
                oldest = min(self._sessions.values(), key=lambda item: item.created_at)
                if oldest.id != session.id:
                    self._sessions.pop(oldest.id, None)
            return self._public(session)

    def next_match_move(self, session_id: str) -> dict[str, object]:
        with self._lock:
            session = self._get(session_id)
            if session.mode != "model_match":
                raise ValueError("Diese Partie ist kein Modellvergleich.")
            if session.finished:
                raise ValueError("Der Modellvergleich ist bereits beendet.")
            model_id = session.black_model_id if session.board.to_move == 1 else session.white_model_id
            if model_id is None:
                raise ValueError("Für die aktuelle Farbe fehlt ein Modell.")
            move = self._bot_move(session, model_id)
            self._commit_move(session, move)
            if not session.finished and len(session.moves) >= session.board.size * session.board.size * 2:
                session.finished = True
                session.finished_reason = "move_limit"
            if session.finished:
                self._settle_match(session)
            return self._public(session, move)

    def move_point(self, session_id: str, x: int, y: int) -> dict[str, object]:
        with self._lock:
            session = self._get(session_id)
            return self.move(session_id, point_to_gtp(x, y, session.board.size))
