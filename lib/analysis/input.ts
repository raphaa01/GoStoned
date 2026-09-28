import type { GameState } from "@/lib/game/types";
import { toGtpCoordinate } from "./coordinates";
import { ANALYSIS_ENGINE_CONTRACT_VERSION, type AnalysisInput } from "./types";

export function gameAnalysisInput(game: GameState): AnalysisInput {
  return {
    contractVersion: ANALYSIS_ENGINE_CONTRACT_VERSION,
    gameId: game.id,
    gameVersion: game.version,
    boardSize: game.boardSize,
    komi: game.komi,
    rules: game.ruleset,
    moves: game.moves.map((move) => ({
      color: move.color,
      move: toGtpCoordinate(game.boardSize, move),
    })),
  };
}
