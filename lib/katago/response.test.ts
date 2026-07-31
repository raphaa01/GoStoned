import assert from "node:assert/strict";
import test from "node:test";
import { canonicalizeKataGoScoringRequest } from "./canonical";
import { KataGoScoringError } from "./errors";
import { validateKataGoScoringResponse } from "./response";
import { providerResponseFixture, scoringRequestFixture } from "./testFixtures";

function expectedError(code: string) {
  return (error: unknown) => error instanceof KataGoScoringError && error.code === code;
}

test("response validation marks only complete, consistently dead, high-confidence opponent-owned groups", () => {
  const request = canonicalizeKataGoScoringRequest(scoringRequestFixture());
  const ownership = request.board.map((row) => row.map(() => 0));
  ownership[1][1] = -0.96;
  ownership[1][2] = -0.91;
  const response = providerResponseFixture(request, {
    ownership,
    assessments: [
      { x: 1, y: 1, status: "dead", confidence: 0.94 },
      { x: 2, y: 1, status: "dead", confidence: 0.9 },
      { x: 7, y: 7, status: "alive", confidence: 1 },
    ],
  });
  const proposal = validateKataGoScoringResponse(response, request, "deterministic");
  assert.deepEqual(proposal.deadStones, [{ x: 1, y: 1 }, { x: 2, y: 1 }]);
  assert.equal(proposal.groups.length, 2);
  assert.deepEqual(proposal.groups[0], {
    color: "black",
    stones: [{ x: 1, y: 1 }, { x: 2, y: 1 }],
    suggestedDead: true,
    confidence: 0.9,
    opponentOwnership: 0.91,
    reason: "suggested-dead",
  });
  assert.equal(Object.isFrozen(proposal.deadStones), true);
  assert.equal(Object.isFrozen(proposal.groups[0].stones), true);
});

test("low confidence, seki, inconsistent status, and weak ownership conservatively remain alive", () => {
  const request = canonicalizeKataGoScoringRequest(scoringRequestFixture());
  const cases = [
    {
      reason: "low-confidence",
      statuses: [
        { x: 1, y: 1, status: "dead" as const, confidence: 0.99 },
        { x: 2, y: 1, status: "dead" as const, confidence: 0.84 },
      ],
      ownership: [-0.95, -0.95],
    },
    {
      reason: "seki",
      statuses: [
        { x: 1, y: 1, status: "seki" as const, confidence: 0.99 },
        { x: 2, y: 1, status: "seki" as const, confidence: 0.99 },
      ],
      ownership: [-0.95, -0.95],
    },
    {
      reason: "inconsistent-status",
      statuses: [
        { x: 1, y: 1, status: "dead" as const, confidence: 0.99 },
        { x: 2, y: 1, status: "alive" as const, confidence: 0.99 },
      ],
      ownership: [-0.95, -0.95],
    },
    {
      reason: "ownership-not-opponent",
      statuses: [
        { x: 1, y: 1, status: "dead" as const, confidence: 0.99 },
        { x: 2, y: 1, status: "dead" as const, confidence: 0.99 },
      ],
      ownership: [-0.95, -0.79],
    },
  ];
  for (const item of cases) {
    const ownership = request.board.map((row) => row.map(() => 0));
    ownership[1][1] = item.ownership[0];
    ownership[1][2] = item.ownership[1];
    const response = providerResponseFixture(request, {
      ownership,
      assessments: [
        ...item.statuses,
        { x: 7, y: 7, status: "alive", confidence: 1 },
      ],
    });
    const proposal = validateKataGoScoringResponse(response, request, "deterministic");
    assert.deepEqual(proposal.deadStones, [], item.reason);
    assert.equal(proposal.groups[0].reason, item.reason);
  }
});

test("response validation rejects stale position, rules, and model evidence", () => {
  const request = canonicalizeKataGoScoringRequest(scoringRequestFixture());
  const response = providerResponseFixture(request);
  for (const stale of [
    { ...response, requestIdentity: `sha256:${"0".repeat(64)}` },
    { ...response, scoringRevision: response.scoringRevision + 1 },
    { ...response, stoppedBoardHash: response.stoppedBoardHash.replace("B", ".") },
    { ...response, rules: { ...response.rules, rulesVersion: "1989-v2" } },
  ]) {
    assert.throws(
      () => validateKataGoScoringResponse(stale, request, "hosted-http"),
      expectedError("stale_response"),
    );
  }
  assert.throws(
    () => validateKataGoScoringResponse({
      ...response,
      engine: { ...response.engine, modelVersion: "wrong-model" },
    }, request, "hosted-http"),
    expectedError("model_mismatch"),
  );
});

test("response validation rejects partial, duplicate, empty-point, nonfinite, and excess-visit data", () => {
  const request = canonicalizeKataGoScoringRequest(scoringRequestFixture());
  const response = providerResponseFixture(request);
  const malformed = [
    { ...response, unexpected: true },
    { ...response, stones: response.stones.slice(1) },
    { ...response, stones: [response.stones[0], response.stones[0], response.stones[2]] },
    { ...response, stones: response.stones.map((stone, index) => index === 0 ? { ...stone, x: 0, y: 0 } : stone) },
    { ...response, stones: response.stones.map((stone, index) => index === 0 ? { ...stone, confidence: Number.NaN } : stone) },
    { ...response, ownership: response.ownership.map((row, y) => row.map((point, x) => x === 0 && y === 0 ? 1.1 : point)) },
    { ...response, engine: { ...response.engine, visits: request.maxVisits + 1 } },
  ];
  for (const value of malformed) {
    assert.throws(
      () => validateKataGoScoringResponse(value, request, "local-http"),
      expectedError("invalid_response"),
    );
  }
});
