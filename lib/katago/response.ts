import {
  KATAGO_CONFIDENCE_POLICY_VERSION,
  KATAGO_DEAD_CONFIDENCE_THRESHOLD,
  KATAGO_OPPONENT_OWNERSHIP_THRESHOLD,
  KATAGO_SCORING_CONTRACT_VERSION,
  type CanonicalKataGoScoringRequest,
  type KataGoColor,
  type KataGoGroupDecisionReason,
  type KataGoGroupProposal,
  type KataGoPosition,
  type KataGoProviderKind,
  type KataGoScoringProposal,
  type KataGoScoringResponse,
  type KataGoStoneAssessment,
  type KataGoStoneStatus,
} from "./contracts";
import { kataGoError } from "./errors";

type PlainRecord = Record<string, unknown>;

function invalidResponse(message: string): never {
  throw kataGoError("invalid_response", message);
}

function staleResponse(message: string): never {
  throw kataGoError("stale_response", message);
}

function plainRecord(value: unknown, name: string): PlainRecord {
  if (
    typeof value !== "object"
    || value === null
    || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype
  ) {
    return invalidResponse(`${name} must be a plain object.`);
  }
  return value as PlainRecord;
}

function exactKeys(value: PlainRecord, expected: readonly string[], name: string): void {
  const keys = Object.keys(value).sort();
  const required = [...expected].sort();
  if (keys.length !== required.length || keys.some((key, index) => key !== required[index])) {
    invalidResponse(`${name} must contain exactly its documented fields.`);
  }
}

function sameRecord(left: object, right: object): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function positionKey(position: KataGoPosition): string {
  return `${position.x}:${position.y}`;
}

function sortedPositions(positions: readonly KataGoPosition[]): readonly KataGoPosition[] {
  return Object.freeze(
    [...positions]
      .sort((left, right) => left.y - right.y || left.x - right.x)
      .map(({ x, y }) => Object.freeze({ x, y })),
  );
}

function connectedGroup(
  request: CanonicalKataGoScoringRequest,
  start: KataGoPosition,
): readonly KataGoPosition[] {
  const color = request.board[start.y]?.[start.x];
  if (!color) return Object.freeze([]);
  const found: KataGoPosition[] = [];
  const pending = [start];
  const visited = new Set<string>();
  while (pending.length > 0) {
    const current = pending.pop()!;
    const key = positionKey(current);
    if (visited.has(key)) continue;
    visited.add(key);
    if (request.board[current.y]?.[current.x] !== color) continue;
    found.push(current);
    for (const [x, y] of [
      [current.x - 1, current.y],
      [current.x + 1, current.y],
      [current.x, current.y - 1],
      [current.x, current.y + 1],
    ]) {
      if (x >= 0 && y >= 0 && x < request.boardSize && y < request.boardSize) {
        pending.push({ x, y });
      }
    }
  }
  return sortedPositions(found);
}

function parseOwnership(value: unknown, request: CanonicalKataGoScoringRequest): readonly (readonly number[])[] {
  if (!Array.isArray(value) || value.length !== request.boardSize) {
    return invalidResponse("ownership must have one row per board row.");
  }
  return Object.freeze(value.map((row, y) => {
    if (!Array.isArray(row) || row.length !== request.boardSize) {
      return invalidResponse(`ownership row ${y} has the wrong length.`);
    }
    return Object.freeze(row.map((point) => {
      if (typeof point !== "number" || !Number.isFinite(point) || point < -1 || point > 1) {
        return invalidResponse("ownership values must be finite numbers from -1 through 1.");
      }
      return point;
    }));
  }));
}

function stoneStatus(value: unknown): KataGoStoneStatus {
  if (value !== "dead" && value !== "alive" && value !== "seki" && value !== "unknown") {
    return invalidResponse("stone assessment status is unsupported.");
  }
  return value;
}

function parseAssessments(
  value: unknown,
  request: CanonicalKataGoScoringRequest,
): readonly KataGoStoneAssessment[] {
  if (!Array.isArray(value)) return invalidResponse("stones must be an array.");
  const occupied = new Set<string>();
  for (let y = 0; y < request.boardSize; y += 1) {
    for (let x = 0; x < request.boardSize; x += 1) {
      if (request.board[y][x]) occupied.add(`${x}:${y}`);
    }
  }
  if (value.length !== occupied.size) {
    return invalidResponse("stones must assess every occupied intersection exactly once.");
  }
  const seen = new Set<string>();
  const assessments = value.map((entry, index) => {
    const assessment = plainRecord(entry, `stones[${index}]`);
    exactKeys(assessment, ["x", "y", "status", "confidence"], `stones[${index}]`);
    if (
      !Number.isSafeInteger(assessment.x)
      || !Number.isSafeInteger(assessment.y)
      || Number(assessment.x) < 0
      || Number(assessment.y) < 0
      || Number(assessment.x) >= request.boardSize
      || Number(assessment.y) >= request.boardSize
    ) {
      return invalidResponse("stone assessment coordinates must be in bounds.");
    }
    const key = `${assessment.x}:${assessment.y}`;
    if (!occupied.has(key) || seen.has(key)) {
      return invalidResponse("stone assessments may identify occupied intersections only once.");
    }
    if (
      typeof assessment.confidence !== "number"
      || !Number.isFinite(assessment.confidence)
      || assessment.confidence < 0
      || assessment.confidence > 1
    ) {
      return invalidResponse("stone assessment confidence must be from 0 through 1.");
    }
    seen.add(key);
    return Object.freeze({
      x: assessment.x as number,
      y: assessment.y as number,
      status: stoneStatus(assessment.status),
      confidence: assessment.confidence,
    });
  });
  return Object.freeze(assessments.sort((left, right) => left.y - right.y || left.x - right.x));
}

function parseResponse(
  value: unknown,
  request: CanonicalKataGoScoringRequest,
): KataGoScoringResponse {
  const response = plainRecord(value, "KataGo scoring response");
  exactKeys(response, [
    "contractVersion",
    "requestIdentity",
    "gameId",
    "stoppedBoardHash",
    "stoppedMoveNumber",
    "scoringRevision",
    "boardSize",
    "rules",
    "playerToMove",
    "engine",
    "ownership",
    "stones",
  ], "KataGo scoring response");
  if (response.contractVersion !== KATAGO_SCORING_CONTRACT_VERSION) {
    invalidResponse("The provider returned an unsupported contract version.");
  }
  for (const [field, expected] of [
    ["requestIdentity", request.requestIdentity],
    ["gameId", request.gameId],
    ["stoppedBoardHash", request.stoppedBoardHash],
    ["stoppedMoveNumber", request.stoppedMoveNumber],
    ["scoringRevision", request.scoringRevision],
    ["boardSize", request.boardSize],
    ["playerToMove", request.playerToMove],
  ] as const) {
    if (response[field] !== expected) staleResponse(`The provider response has stale ${field}.`);
  }
  const rules = plainRecord(response.rules, "response rules");
  exactKeys(
    rules,
    ["ruleset", "rulesProfile", "rulesVersion", "scoringMethod", "komi", "handicap"],
    "response rules",
  );
  if (!sameRecord(rules, request.rules)) staleResponse("The provider response has stale rules identity.");

  const engine = plainRecord(response.engine, "response engine");
  exactKeys(
    engine,
    ["name", "engineVersion", "modelVersion", "configVersion", "visits"],
    "response engine",
  );
  if (engine.name !== "KataGo") invalidResponse("The scoring provider engine must be KataGo.");
  if (
    engine.engineVersion !== request.engine.engineVersion
    || engine.modelVersion !== request.engine.modelVersion
    || engine.configVersion !== request.engine.configVersion
  ) {
    throw kataGoError("model_mismatch", "The provider used a different KataGo model or configuration.");
  }
  if (!Number.isSafeInteger(engine.visits) || Number(engine.visits) < 1 || Number(engine.visits) > request.maxVisits) {
    invalidResponse("The provider visit count is invalid or exceeds the request bound.");
  }

  return Object.freeze({
    contractVersion: KATAGO_SCORING_CONTRACT_VERSION,
    requestIdentity: request.requestIdentity,
    gameId: request.gameId,
    stoppedBoardHash: request.stoppedBoardHash,
    stoppedMoveNumber: request.stoppedMoveNumber,
    scoringRevision: request.scoringRevision,
    boardSize: request.boardSize,
    rules: request.rules,
    playerToMove: request.playerToMove,
    engine: Object.freeze({
      name: "KataGo",
      engineVersion: engine.engineVersion as string,
      modelVersion: engine.modelVersion as string,
      configVersion: engine.configVersion as string,
      visits: engine.visits as number,
    }),
    ownership: parseOwnership(response.ownership, request),
    stones: parseAssessments(response.stones, request),
  });
}

function decisionForGroup(
  color: KataGoColor,
  stones: readonly KataGoPosition[],
  assessments: ReadonlyMap<string, KataGoStoneAssessment>,
  ownership: KataGoScoringResponse["ownership"],
): KataGoGroupProposal {
  const statuses = stones.map((stone) => assessments.get(positionKey(stone))!);
  const distinctStatuses = new Set(statuses.map(({ status }) => status));
  const confidence = Math.min(...statuses.map(({ confidence: value }) => value));
  const opponentOwnership = Math.min(...stones.map(({ x, y }) =>
    color === "black" ? -ownership[y][x] : ownership[y][x]
  ));
  let reason: KataGoGroupDecisionReason;
  if (statuses.some(({ status }) => status === "seki")) reason = "seki";
  else if (distinctStatuses.size > 1) reason = "inconsistent-status";
  else if (statuses.some(({ status }) => status !== "dead")) reason = "status-not-dead";
  else if (confidence < KATAGO_DEAD_CONFIDENCE_THRESHOLD) reason = "low-confidence";
  else if (opponentOwnership < KATAGO_OPPONENT_OWNERSHIP_THRESHOLD) {
    reason = "ownership-not-opponent";
  } else reason = "suggested-dead";
  return Object.freeze({
    color,
    stones,
    suggestedDead: reason === "suggested-dead",
    confidence,
    opponentOwnership,
    reason,
  });
}

/**
 * Strictly validates the provider wire response, rejects stale identity/model
 * evidence, and derives suggestions only at complete connected-group scope.
 * Ambiguous, low-confidence, seki, or weak-ownership groups remain alive.
 */
export function validateKataGoScoringResponse(
  value: unknown,
  request: CanonicalKataGoScoringRequest,
  providerKind: KataGoProviderKind,
): KataGoScoringProposal {
  const response = parseResponse(value, request);
  const assessmentByPosition = new Map(
    response.stones.map((assessment) => [positionKey(assessment), assessment]),
  );
  const visited = new Set<string>();
  const groups: KataGoGroupProposal[] = [];
  const deadStones: KataGoPosition[] = [];
  for (const assessment of response.stones) {
    const key = positionKey(assessment);
    if (visited.has(key)) continue;
    const stones = connectedGroup(request, assessment);
    for (const stone of stones) visited.add(positionKey(stone));
    const color = request.board[assessment.y][assessment.x];
    if (!color) return invalidResponse("A validated stone assessment lost its board color.");
    const group = decisionForGroup(
      color,
      stones,
      assessmentByPosition,
      response.ownership,
    );
    groups.push(group);
    if (group.suggestedDead) deadStones.push(...group.stones);
  }
  return Object.freeze({
    contractVersion: KATAGO_SCORING_CONTRACT_VERSION,
    confidencePolicyVersion: KATAGO_CONFIDENCE_POLICY_VERSION,
    requestIdentity: request.requestIdentity,
    providerKind,
    gameId: request.gameId,
    stoppedBoardHash: request.stoppedBoardHash,
    stoppedMoveNumber: request.stoppedMoveNumber,
    scoringRevision: request.scoringRevision,
    engine: response.engine,
    deadStones: sortedPositions(deadStones),
    groups: Object.freeze(groups),
  });
}
