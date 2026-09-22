import { GOSTONE_BOT_MODEL } from "@/lib/bot/modelV1";
import { GameServiceError } from "@/lib/game/gameService";
import {
  replayJapaneseNormalPlayBoardLegality,
  type JapanesePersistedMove,
} from "@/lib/game/japaneseKo";
import {
  scoreJapaneseTerritory,
  type JapaneseTerritoryScore,
} from "@/lib/game/japaneseScoring";
import type { Board, BoardSize, Position } from "@/lib/game/types";

export type TrainingSettlementInput = Readonly<{
  boardSize: BoardSize;
  moves: readonly JapanesePersistedMove[];
  proposal: Readonly<{
    contractVersion: "gostone-japanese-settlement-v1";
    modelVersion: string;
    modelSha256: string;
    authority: "proposal-only";
    stoppedMoveNumber: number;
    deadStones: readonly Position[];
    uncertainStones: readonly Position[];
    neutralRegionSeeds: readonly Position[];
  }>;
}>;

export type TrainingSettlementResult = Readonly<{
  modelName: typeof GOSTONE_BOT_MODEL.modelName;
  modelVersion: typeof GOSTONE_BOT_MODEL.modelVersion;
  score: JapaneseTerritoryScore;
}>;

function invalidTrainingScore(message: string): GameServiceError {
  return new GameServiceError(message, 400, "invalid_training_score");
}

function mutableBoard(board: readonly (readonly ("black" | "white" | null)[])[]): Board {
  return board.map((row) => [...row]);
}

export function scoreTrainingSettlement(
  input: TrainingSettlementInput,
): TrainingSettlementResult {
  const { proposal } = input;
  if (
    proposal.contractVersion !== "gostone-japanese-settlement-v1"
    || proposal.authority !== "proposal-only"
    || proposal.modelVersion !== GOSTONE_BOT_MODEL.modelVersion
    || proposal.modelSha256 !== GOSTONE_BOT_MODEL.artifactSha256
  ) {
    throw invalidTrainingScore("The training score does not match the active browser model.");
  }
  if (
    input.moves.length < 2
    || !input.moves.at(-1)?.isPass
    || !input.moves.at(-2)?.isPass
    || proposal.stoppedMoveNumber !== input.moves.length
  ) {
    throw invalidTrainingScore("The training position has not ended with two passes.");
  }
  if (proposal.uncertainStones.length > 0) {
    throw new GameServiceError(
      "The browser model still considers at least one group uncertain.",
      409,
      "training_score_uncertain",
    );
  }

  let replayed;
  try {
    replayed = replayJapaneseNormalPlayBoardLegality(input.boardSize, input.moves);
  } catch {
    throw invalidTrainingScore("The training move record is invalid.");
  }
  let score: JapaneseTerritoryScore;
  try {
    score = scoreJapaneseTerritory({
      board: mutableBoard(replayed.board),
      prisoners: replayed.prisoners,
      deadStones: [...proposal.deadStones],
      agreedNeutralRegionSeeds: [...proposal.neutralRegionSeeds],
      komi: GOSTONE_BOT_MODEL.komi,
    });
  } catch {
    throw invalidTrainingScore("The browser model proposal cannot be scored under Japanese rules.");
  }

  return Object.freeze({
    modelName: GOSTONE_BOT_MODEL.modelName,
    modelVersion: GOSTONE_BOT_MODEL.modelVersion,
    score,
  });
}
