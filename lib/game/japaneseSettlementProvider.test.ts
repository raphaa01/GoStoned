import assert from "node:assert/strict";
import test from "node:test";
import { boardHash, createEmptyBoard } from "./goEngine";
import {
  JAPANESE_SETTLEMENT_PROVIDER_CONTRACT,
  JapaneseSettlementSuggestionError,
  validateJapaneseSettlementSuggestion,
} from "./japaneseSettlementProvider";

const gameId = "11111111-1111-4111-8111-111111111111";

function fixture() {
  const board = createEmptyBoard(9);
  board[0][0] = "black";
  board[0][1] = "black";
  board[8][8] = "white";
  const stoppedBoardHash = boardHash(board);
  const expected = {
    gameId,
    boardSize: 9 as const,
    board,
    stoppedBoardHash,
    stoppedMoveNumber: 42,
    scoringRevision: 3,
  };
  const suggestion = {
    contractVersion: JAPANESE_SETTLEMENT_PROVIDER_CONTRACT,
    authority: "proposal-only" as const,
    gameId,
    boardSize: 9 as const,
    stoppedBoardHash,
    stoppedMoveNumber: 42,
    scoringRevision: 3,
    provider: {
      id: "partner-browser-ai",
      modelVersion: "compact-go-v1",
      artifactSha256: "a".repeat(64),
    },
    deadStones: [{ x: 0, y: 0 }, { x: 1, y: 0 }],
    uncertainStones: [{ x: 8, y: 8 }],
    neutralRegionSeeds: [{ x: 4, y: 4 }],
  };
  return { expected, suggestion };
}

function expectError(value: unknown, code: JapaneseSettlementSuggestionError["code"]): void {
  const { expected } = fixture();
  assert.throws(
    () => validateJapaneseSettlementSuggestion(value, expected),
    (error: unknown) => error instanceof JapaneseSettlementSuggestionError && error.code === code,
  );
}

test("accepts an exact, position-bound, proposal-only settlement suggestion", () => {
  const { expected, suggestion } = fixture();
  assert.deepEqual(validateJapaneseSettlementSuggestion(suggestion, expected), suggestion);
});

test("rejects suggestions bound to another board, move, revision, or game", () => {
  const { suggestion } = fixture();
  for (const changed of [
    { gameId: "22222222-2222-4222-8222-222222222222" },
    { stoppedBoardHash: "f".repeat(64) },
    { stoppedMoveNumber: 43 },
    { scoringRevision: 4 },
  ]) expectError({ ...suggestion, ...changed }, "stale_suggestion");
});

test("rejects partial, empty, overlapping, and duplicate group evidence", () => {
  const { suggestion } = fixture();
  for (const changed of [
    { deadStones: [{ x: 0, y: 0 }] },
    { deadStones: [{ x: 4, y: 4 }] },
    { uncertainStones: [{ x: 0, y: 0 }] },
    { deadStones: [{ x: 0, y: 0 }, { x: 0, y: 0 }] },
  ]) expectError({ ...suggestion, ...changed }, "invalid_suggestion");
});

test("rejects extension fields and malformed provider identity", () => {
  const { suggestion } = fixture();
  expectError({ ...suggestion, executableDecision: true }, "invalid_suggestion");
  expectError({ ...suggestion, provider: { ...suggestion.provider, endpoint: "remote" } }, "invalid_suggestion");
  expectError({ ...suggestion, provider: { ...suggestion.provider, artifactSha256: "not-a-hash" } }, "invalid_suggestion");
});
