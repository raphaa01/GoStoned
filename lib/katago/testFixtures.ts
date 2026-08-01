import {
  KATAGO_CONFIDENCE_POLICY_VERSION,
  KATAGO_SCORING_CONTRACT_VERSION,
  type CanonicalKataGoScoringRequest,
  type KataGoScoringRequest,
  type KataGoStoneAssessment,
} from "./contracts";
import { kataGoBoardHash } from "./canonical";

export function scoringRequestFixture(): KataGoScoringRequest {
  const board = Array.from({ length: 9 }, () => Array<"black" | "white" | null>(9).fill(null));
  board[1][1] = "black";
  board[1][2] = "black";
  board[7][7] = "white";
  const stoppedBoardHash = kataGoBoardHash(board);
  return {
    contractVersion: KATAGO_SCORING_CONTRACT_VERSION,
    analysisPurpose: "initial-suggestion",
    gameId: "33333333-3333-4333-8333-333333333333",
    stoppedBoardHash,
    stoppedMoveNumber: 5,
    scoringRevision: 1,
    boardSize: 9,
    board,
    moves: [
      { moveNumber: 1, color: "black", x: 1, y: 1, isPass: false, boardHash: stoppedBoardHash },
      { moveNumber: 2, color: "white", x: 7, y: 7, isPass: false, boardHash: stoppedBoardHash },
      { moveNumber: 3, color: "black", x: 2, y: 1, isPass: false, boardHash: stoppedBoardHash },
      { moveNumber: 4, color: "white", x: null, y: null, isPass: true, boardHash: stoppedBoardHash },
      { moveNumber: 5, color: "black", x: null, y: null, isPass: true, boardHash: stoppedBoardHash },
    ],
    rules: {
      ruleset: "japanese",
      rulesProfile: "japanese-1989-gostone-v1",
      rulesVersion: "1989-v1",
      scoringMethod: "territory",
      komi: 6.5,
      handicap: 0,
    },
    playerToMove: "white",
    engine: {
      engineVersion: "v1.17.0",
      modelVersion: "b18-model-v1",
      configVersion: "scoring-fast-v1",
    },
    maxVisits: 32,
    confidencePolicyVersion: KATAGO_CONFIDENCE_POLICY_VERSION,
  };
}

export function providerResponseFixture(
  request: CanonicalKataGoScoringRequest,
  options: Readonly<{
    assessments?: readonly KataGoStoneAssessment[];
    ownership?: readonly (readonly number[])[];
  }> = {},
) {
  const assessments = options.assessments ?? request.board.flatMap((row, y) =>
    row.flatMap((point, x) => point
      ? [{ x, y, status: "alive" as const, confidence: 1 }]
      : []),
  );
  return {
    contractVersion: request.contractVersion,
    analysisPurpose: request.analysisPurpose,
    requestIdentity: request.requestIdentity,
    gameId: request.gameId,
    stoppedBoardHash: request.stoppedBoardHash,
    stoppedMoveNumber: request.stoppedMoveNumber,
    scoringRevision: request.scoringRevision,
    boardSize: request.boardSize,
    rules: request.rules,
    playerToMove: request.playerToMove,
    engine: {
      name: "KataGo",
      ...request.engine,
      visits: request.maxVisits,
    },
    ownership: options.ownership ?? request.board.map((row) => row.map(() => 0)),
    stones: assessments,
  };
}
