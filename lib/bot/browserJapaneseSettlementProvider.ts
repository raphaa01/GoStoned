"use client";

import { proposeJapaneseSettlement } from "./browserBotClient";
import { GOSTONE_BOT_MODEL } from "./modelV1";
import {
  JAPANESE_SETTLEMENT_PROVIDER_CONTRACT,
  type JapaneseSettlementSuggestion,
} from "@/lib/game/japaneseSettlementProvider";
import type { GameState } from "@/lib/game/types";

/**
 * The only adapter the browser model must implement for Japanese scoring.
 * Replacing the model or worker does not change rules, persistence, scoring,
 * confirmation, resumption, or deadline code.
 */
export async function proposeBrowserJapaneseSettlement(
  game: GameState,
  targetRating = 1_200,
): Promise<JapaneseSettlementSuggestion> {
  if (!game.scoring || game.ruleset !== "japanese" || game.phase !== "scoring") {
    throw new Error("A browser settlement suggestion requires an active Japanese scoring position.");
  }
  const proposal = await proposeJapaneseSettlement({
    gameId: game.id,
    boardSize: game.boardSize,
    board: game.board,
    moves: game.moves,
    komi: game.komi,
    targetRating,
    gameVersion: game.version,
    stoppedBoardHash: game.scoring.boardHash,
    scoringRevision: game.scoring.revision,
  });
  return {
    contractVersion: JAPANESE_SETTLEMENT_PROVIDER_CONTRACT,
    authority: "proposal-only",
    gameId: proposal.gameId,
    boardSize: proposal.boardSize,
    stoppedBoardHash: proposal.stoppedBoardHash,
    stoppedMoveNumber: proposal.stoppedMoveNumber,
    scoringRevision: proposal.scoringRevision,
    provider: {
      id: `browser-worker:${GOSTONE_BOT_MODEL.contractVersion}`,
      modelVersion: proposal.modelVersion,
      artifactSha256: proposal.modelSha256,
    },
    deadStones: proposal.deadStones,
    uncertainStones: proposal.uncertainStones,
    neutralRegionSeeds: proposal.neutralRegionSeeds,
  };
}
