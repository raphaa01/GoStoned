import assert from "node:assert/strict";
import test from "node:test";
import { canonicalizeKataGoScoringRequest } from "./canonical";
import { KataGoScoringError } from "./errors";
import { scoringRequestFixture } from "./testFixtures";

function expectInvalidRequest(value: unknown) {
  assert.throws(
    () => canonicalizeKataGoScoringRequest(value),
    (error) => error instanceof KataGoScoringError && error.code === "invalid_request",
  );
}

test("canonical request identity is stable, immutable, and binds every scoring authority", () => {
  const input = scoringRequestFixture();
  const first = canonicalizeKataGoScoringRequest(input);
  const second = canonicalizeKataGoScoringRequest(structuredClone(input));
  assert.equal(first.requestIdentity, second.requestIdentity);
  assert.match(first.requestIdentity, /^sha256:[0-9a-f]{64}$/);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.board), true);
  assert.equal(Object.isFrozen(first.board[0]), true);
  assert.equal(Object.isFrozen(first.moves), true);
  assert.equal(Object.isFrozen(first.rules), true);

  const variants = [
    { ...input, gameId: "44444444-4444-4444-8444-444444444444" },
    { ...input, scoringRevision: 2 },
    { ...input, playerToMove: "black" as const },
    { ...input, rules: { ...input.rules, rulesVersion: "1989-v2" } },
    { ...input, rules: { ...input.rules, komi: 7.5 } },
    { ...input, rules: { ...input.rules, handicap: 2 } },
    { ...input, engine: { ...input.engine, modelVersion: "b18-model-v2" } },
    { ...input, engine: { ...input.engine, configVersion: "scoring-fast-v2" } },
    { ...input, maxVisits: 64 },
  ];
  for (const variant of variants) {
    assert.notEqual(canonicalizeKataGoScoringRequest(variant).requestIdentity, first.requestIdentity);
  }
});

test("canonical request rejects incomplete, stale, non-pass, and non-exact evidence", () => {
  const input = scoringRequestFixture();
  expectInvalidRequest({ ...input, unexpected: true });
  expectInvalidRequest({ ...input, gameId: "not-a-game-id" });
  expectInvalidRequest({ ...input, stoppedBoardHash: input.stoppedBoardHash.replace("B", ".") });
  expectInvalidRequest({ ...input, moves: input.moves.slice(1) });
  expectInvalidRequest({
    ...input,
    moves: input.moves.map((move, index) => index === 0 ? { ...move, moveNumber: 2 } : move),
  });
  expectInvalidRequest({
    ...input,
    moves: input.moves.map((move, index) => index === input.moves.length - 2
      ? { ...move, isPass: false, x: 0, y: 0 }
      : move),
  });
  expectInvalidRequest({
    ...input,
    moves: input.moves.map((move, index) => index === input.moves.length - 1
      ? { ...move, boardHash: move.boardHash.replace("B", ".") }
      : move),
  });
  expectInvalidRequest({ ...input, rules: { ...input.rules, extra: "field" } });
  expectInvalidRequest({ ...input, rules: { ...input.rules, komi: 6.25 } });
  expectInvalidRequest({ ...input, rules: { ...input.rules, handicap: 10 } });
  expectInvalidRequest({ ...input, engine: { ...input.engine, modelVersion: "" } });
  expectInvalidRequest({ ...input, maxVisits: 1_001 });
});

test("canonical request snapshots caller-owned arrays", () => {
  const input = scoringRequestFixture();
  const canonical = canonicalizeKataGoScoringRequest(input);
  (input.board[1] as Array<"black" | "white" | null>)[1] = null;
  (input.moves as unknown as Array<(typeof input.moves)[number]>).pop();
  assert.equal(canonical.board[1][1], "black");
  assert.equal(canonical.moves.length, 5);
});
