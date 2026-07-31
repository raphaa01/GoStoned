import { createHash } from "node:crypto";
import {
  KATAGO_CONFIDENCE_POLICY_VERSION,
  KATAGO_SCORING_CONTRACT_VERSION,
  type CanonicalKataGoScoringRequest,
  type KataGoBoard,
  type KataGoBoardSize,
  type KataGoCanonicalMove,
  type KataGoColor,
  type KataGoEngineIdentity,
  type KataGoRulesIdentity,
} from "./contracts";
import { kataGoError } from "./errors";

type PlainRecord = Record<string, unknown>;

function invalidRequest(message: string): never {
  throw kataGoError("invalid_request", message);
}

function plainRecord(value: unknown, name: string): PlainRecord {
  if (
    typeof value !== "object"
    || value === null
    || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype
  ) {
    return invalidRequest(`${name} must be a plain object.`);
  }
  return value as PlainRecord;
}

function exactKeys(value: PlainRecord, expected: readonly string[], name: string): void {
  const keys = Object.keys(value).sort();
  const required = [...expected].sort();
  if (keys.length !== required.length || keys.some((key, index) => key !== required[index])) {
    invalidRequest(`${name} must contain exactly its documented fields.`);
  }
}

function versionLabel(value: unknown, name: string): string {
  if (
    typeof value !== "string"
    || value.length < 1
    || value.length > 128
    || !/^[A-Za-z0-9][A-Za-z0-9._:@/+\-]*$/.test(value)
  ) {
    return invalidRequest(`${name} must be a bounded version label.`);
  }
  return value;
}

function color(value: unknown, name: string): KataGoColor {
  if (value !== "black" && value !== "white") {
    return invalidRequest(`${name} must be black or white.`);
  }
  return value;
}

function boardSize(value: unknown): KataGoBoardSize {
  if (value !== 9 && value !== 13 && value !== 19) {
    return invalidRequest("boardSize must be 9, 13, or 19.");
  }
  return value;
}

function validBoardHash(value: unknown, size: KataGoBoardSize, name: string): string {
  if (typeof value !== "string") return invalidRequest(`${name} must be a string.`);
  const rows = value.split("/");
  if (
    rows.length !== size
    || rows.some((row) => row.length !== size || !/^[BW.]+$/.test(row))
  ) {
    return invalidRequest(`${name} must be a canonical ${size}x${size} board hash.`);
  }
  return value;
}

export function kataGoBoardHash(board: KataGoBoard): string {
  return board.map((row) => row.map((point) =>
    point === "black" ? "B" : point === "white" ? "W" : "."
  ).join("")).join("/");
}

function canonicalBoard(value: unknown, size: KataGoBoardSize): KataGoBoard {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length !== size) {
    return invalidRequest(`board must contain exactly ${size} rows.`);
  }
  const board = value.map((row, y) => {
    if (!Array.isArray(row) || Object.getPrototypeOf(row) !== Array.prototype || row.length !== size) {
      return invalidRequest(`board row ${y} must contain exactly ${size} intersections.`);
    }
    return Object.freeze(row.map((point) => {
      if (point !== null && point !== "black" && point !== "white") {
        return invalidRequest("board intersections must be black, white, or null.");
      }
      return point;
    }));
  });
  return Object.freeze(board);
}

function canonicalRules(value: unknown): KataGoRulesIdentity {
  const rules = plainRecord(value, "rules");
  exactKeys(
    rules,
    ["ruleset", "rulesProfile", "rulesVersion", "scoringMethod", "komi", "handicap"],
    "rules",
  );
  const komi = rules.komi;
  if (typeof komi !== "number" || !Number.isFinite(komi) || !Number.isInteger(komi * 2)) {
    invalidRequest("rules.komi must be a finite half-point value.");
  }
  const handicap = rules.handicap;
  if (!Number.isSafeInteger(handicap) || Number(handicap) < 0 || Number(handicap) > 9) {
    invalidRequest("rules.handicap must be an integer from 0 through 9.");
  }
  return Object.freeze({
    ruleset: versionLabel(rules.ruleset, "rules.ruleset"),
    rulesProfile: versionLabel(rules.rulesProfile, "rules.rulesProfile"),
    rulesVersion: versionLabel(rules.rulesVersion, "rules.rulesVersion"),
    scoringMethod: versionLabel(rules.scoringMethod, "rules.scoringMethod"),
    komi: komi as number,
    handicap: handicap as number,
  });
}

function canonicalEngine(value: unknown): KataGoEngineIdentity {
  const engine = plainRecord(value, "engine");
  exactKeys(engine, ["engineVersion", "modelVersion", "configVersion"], "engine");
  return Object.freeze({
    engineVersion: versionLabel(engine.engineVersion, "engine.engineVersion"),
    modelVersion: versionLabel(engine.modelVersion, "engine.modelVersion"),
    configVersion: versionLabel(engine.configVersion, "engine.configVersion"),
  });
}

function canonicalMoves(
  value: unknown,
  size: KataGoBoardSize,
  stoppedMoveNumber: number,
  stoppedBoardHash: string,
): readonly KataGoCanonicalMove[] {
  if (
    !Array.isArray(value)
    || Object.getPrototypeOf(value) !== Array.prototype
    || value.length !== stoppedMoveNumber
  ) {
    return invalidRequest("moves must be the complete dense history through stoppedMoveNumber.");
  }
  const moves = value.map((entry, index) => {
    const move = plainRecord(entry, `moves[${index}]`);
    exactKeys(move, ["moveNumber", "color", "x", "y", "isPass", "boardHash"], `moves[${index}]`);
    if (move.moveNumber !== index + 1) {
      invalidRequest("moves must have contiguous one-based move numbers.");
    }
    if (typeof move.isPass !== "boolean") invalidRequest("move isPass values must be boolean.");
    if (move.isPass) {
      if (move.x !== null || move.y !== null) invalidRequest("pass moves may not have coordinates.");
    } else if (
      !Number.isSafeInteger(move.x)
      || !Number.isSafeInteger(move.y)
      || Number(move.x) < 0
      || Number(move.y) < 0
      || Number(move.x) >= size
      || Number(move.y) >= size
    ) {
      invalidRequest("played moves must have in-bounds integer coordinates.");
    }
    return Object.freeze({
      moveNumber: move.moveNumber as number,
      color: color(move.color, `moves[${index}].color`),
      x: move.x as number | null,
      y: move.y as number | null,
      isPass: move.isPass,
      boardHash: validBoardHash(move.boardHash, size, `moves[${index}].boardHash`),
    });
  });
  if (moves.length < 2 || !moves.at(-1)?.isPass || !moves.at(-2)?.isPass) {
    invalidRequest("a scoring-boundary request must end with two consecutive passes.");
  }
  if (moves.at(-1)?.boardHash !== stoppedBoardHash || moves.at(-2)?.boardHash !== stoppedBoardHash) {
    invalidRequest("the pass-pass history must bind to the stopped board hash.");
  }
  return Object.freeze(moves);
}

function canonicalSerialization(request: Omit<CanonicalKataGoScoringRequest, "requestIdentity">): string {
  return JSON.stringify(request);
}

export function canonicalizeKataGoScoringRequest(
  value: unknown,
): CanonicalKataGoScoringRequest {
  const input = plainRecord(value, "KataGo scoring request");
  exactKeys(input, [
    "contractVersion",
    "gameId",
    "stoppedBoardHash",
    "stoppedMoveNumber",
    "scoringRevision",
    "boardSize",
    "board",
    "moves",
    "rules",
    "playerToMove",
    "engine",
    "maxVisits",
    "confidencePolicyVersion",
  ], "KataGo scoring request");
  if (input.contractVersion !== KATAGO_SCORING_CONTRACT_VERSION) {
    invalidRequest("The KataGo scoring contract version is unsupported.");
  }
  if (input.confidencePolicyVersion !== KATAGO_CONFIDENCE_POLICY_VERSION) {
    invalidRequest("The KataGo confidence policy version is unsupported.");
  }
  if (
    typeof input.gameId !== "string"
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.gameId)
  ) {
    invalidRequest("gameId must be a canonical UUID.");
  }
  const size = boardSize(input.boardSize);
  const board = canonicalBoard(input.board, size);
  const stoppedBoardHash = validBoardHash(input.stoppedBoardHash, size, "stoppedBoardHash");
  if (kataGoBoardHash(board) !== stoppedBoardHash) {
    invalidRequest("stoppedBoardHash does not match the supplied stopped board.");
  }
  if (!Number.isSafeInteger(input.stoppedMoveNumber) || Number(input.stoppedMoveNumber) < 2) {
    invalidRequest("stoppedMoveNumber must be a positive scoring-boundary move number.");
  }
  if (!Number.isSafeInteger(input.scoringRevision) || Number(input.scoringRevision) < 1) {
    invalidRequest("scoringRevision must be a positive integer.");
  }
  if (!Number.isSafeInteger(input.maxVisits) || Number(input.maxVisits) < 1 || Number(input.maxVisits) > 1_000) {
    invalidRequest("maxVisits must be an integer from 1 through 1000.");
  }

  const request = Object.freeze({
    contractVersion: KATAGO_SCORING_CONTRACT_VERSION,
    gameId: input.gameId,
    stoppedBoardHash,
    stoppedMoveNumber: input.stoppedMoveNumber as number,
    scoringRevision: input.scoringRevision as number,
    boardSize: size,
    board,
    moves: canonicalMoves(
      input.moves,
      size,
      input.stoppedMoveNumber as number,
      stoppedBoardHash,
    ),
    rules: canonicalRules(input.rules),
    playerToMove: color(input.playerToMove, "playerToMove"),
    engine: canonicalEngine(input.engine),
    maxVisits: input.maxVisits as number,
    confidencePolicyVersion: KATAGO_CONFIDENCE_POLICY_VERSION,
  });
  const requestIdentity = `sha256:${createHash("sha256")
    .update(canonicalSerialization(request))
    .digest("hex")}`;
  return Object.freeze({ ...request, requestIdentity });
}
