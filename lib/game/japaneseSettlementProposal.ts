import { createHash } from "node:crypto";
import type { PrisonerLedger } from "./goEngine";
import {
  JAPANESE_1989_RULES_PROFILE,
  JAPANESE_SETTLEMENT_PROPOSAL_DIGEST_VERSION,
} from "./japanesePolicyContract";
import type { Position, Stone } from "./types";

const POSTGRES_INT_MAX = 2_147_483_647;
const CANONICAL_GAME_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export type JapaneseSettlementRulesIdentity = Readonly<{
  rules: "japanese";
  rulesProfile: typeof JAPANESE_1989_RULES_PROFILE;
  scoringMethod: "territory";
  komi: 6.5 | "6.5";
  handicap: 0;
}>;

export type JapaneseSettlementDeadStone = Readonly<Position & { color: Stone }>;

export type JapaneseSettlementProposalInput = Readonly<{
  gameId: string;
  stoppedBoardHash: string;
  stoppedMoveNumber: number;
  revision: number;
  rulesIdentity: JapaneseSettlementRulesIdentity;
  prisoners: PrisonerLedger;
  deadStones: readonly JapaneseSettlementDeadStone[];
  neutralRegionSeeds: readonly Readonly<Position>[];
}>;

export type JapaneseSettlementProposalErrorCode =
  | "invalid_proposal"
  | "invalid_game_id"
  | "invalid_board_hash"
  | "invalid_stopped_move_number"
  | "invalid_revision"
  | "rules_identity_mismatch"
  | "invalid_prisoner_ledger"
  | "invalid_dead_stone"
  | "duplicate_dead_stone"
  | "dead_stone_board_mismatch"
  | "invalid_neutral_region_seed"
  | "duplicate_neutral_region_seed";

export class JapaneseSettlementProposalError extends Error {
  constructor(
    public readonly code: JapaneseSettlementProposalErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "JapaneseSettlementProposalError";
  }
}

type UnknownRecord = Record<string, unknown>;

function proposalError(code: JapaneseSettlementProposalErrorCode, message: string): never {
  throw new JapaneseSettlementProposalError(code, message);
}

function snapshotExactRecord(
  value: unknown,
  expectedKeys: readonly string[],
  code: JapaneseSettlementProposalErrorCode,
  label: string,
): UnknownRecord {
  try {
    if (
      typeof value !== "object"
      || value === null
      || Array.isArray(value)
      || Object.getPrototypeOf(value) !== Object.prototype
    ) {
      return proposalError(code, `${label} must be a plain record.`);
    }

    const descriptors = Object.getOwnPropertyDescriptors(value);
    const ownKeys = Reflect.ownKeys(descriptors);
    if (
      ownKeys.length !== expectedKeys.length
      || ownKeys.some((key) => typeof key !== "string" || !expectedKeys.includes(key))
    ) {
      return proposalError(code, `${label} must contain exactly its documented fields.`);
    }

    const snapshot: UnknownRecord = {};
    for (const key of expectedKeys) {
      const descriptor = descriptors[key];
      if (
        !descriptor
        || descriptor.enumerable !== true
        || !("value" in descriptor)
      ) {
        return proposalError(
          code,
          `${label}.${key} must be an own enumerable data property.`,
        );
      }
      snapshot[key] = descriptor.value;
    }
    return snapshot;
  } catch {
    return proposalError(code, `${label} could not be inspected safely.`);
  }
}

function assertPostgresInteger(
  value: unknown,
  minimum: number,
  code: "invalid_stopped_move_number" | "invalid_revision" | "invalid_prisoner_ledger",
  label: string,
): asserts value is number {
  if (
    typeof value !== "number"
    || !Number.isSafeInteger(value)
    || value < minimum
    || value > POSTGRES_INT_MAX
  ) {
    proposalError(code, `${label} must be a PostgreSQL integer between ${minimum} and ${POSTGRES_INT_MAX}.`);
  }
}

function parseStoppedBoardHash(value: unknown): readonly string[] {
  if (typeof value !== "string") {
    return proposalError("invalid_board_hash", "The stopped board hash must be a string.");
  }
  const rows = value.split("/");
  const size = rows.length;
  if (
    (size !== 9 && size !== 13 && size !== 19)
    || rows.some((row) => row.length !== size || !/^[BW.]+$/.test(row))
  ) {
    return proposalError(
      "invalid_board_hash",
      "The stopped board hash must encode one square 9x9, 13x13, or 19x19 board.",
    );
  }
  return rows;
}

function assertDenseBoundedArray(
  value: unknown,
  maximumLength: number,
  code: "invalid_dead_stone" | "invalid_neutral_region_seed",
  label: string,
): unknown[] {
  try {
    if (
      !Array.isArray(value)
      || Object.getPrototypeOf(value) !== Array.prototype
    ) {
      return proposalError(code, `${label} must be a plain array.`);
    }
    const descriptors = Object.getOwnPropertyDescriptors(value) as unknown as Record<
      PropertyKey,
      PropertyDescriptor
    >;
    const lengthDescriptor = descriptors.length;
    if (
      !lengthDescriptor
      || lengthDescriptor.enumerable !== false
      || !("value" in lengthDescriptor)
      || typeof lengthDescriptor.value !== "number"
      || !Number.isSafeInteger(lengthDescriptor.value)
      || lengthDescriptor.value < 0
      || lengthDescriptor.value > maximumLength
    ) {
      return proposalError(code, `${label} must be an array bounded by the board area.`);
    }
    const length = lengthDescriptor.value;
    const ownKeys = Reflect.ownKeys(descriptors);
    if (
      ownKeys.length !== length + 1
      || ownKeys.some((key) => {
        if (key === "length") return false;
        if (typeof key !== "string" || !/^(0|[1-9]\d*)$/.test(key)) return true;
        const index = Number(key);
        return !Number.isSafeInteger(index) || index < 0 || index >= length;
      })
    ) {
      return proposalError(code, `${label} must contain only dense own array slots.`);
    }

    const snapshot: unknown[] = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (
        !descriptor
        || descriptor.enumerable !== true
        || !("value" in descriptor)
      ) {
        return proposalError(
          code,
          `${label}[${index}] must be an own enumerable data property.`,
        );
      }
      snapshot.push(descriptor.value);
    }
    return snapshot;
  } catch {
    return proposalError(code, `${label} could not be inspected safely.`);
  }
}

function readPosition(
  value: unknown,
  size: number,
  code: "invalid_dead_stone" | "invalid_neutral_region_seed",
  label: string,
): Position {
  const snapshot = snapshotExactRecord(value, ["x", "y"], code, label);
  const { x, y } = snapshot;
  if (
    typeof x !== "number"
    || typeof y !== "number"
    || !Number.isInteger(x)
    || !Number.isInteger(y)
    || x < 0
    || y < 0
    || x >= size
    || y >= size
  ) {
    return proposalError(code, `${label} contains a coordinate outside the stopped board.`);
  }
  return { x, y };
}

function positionKey(position: Position): string {
  return `${position.x}:${position.y}`;
}

function comparePositions(left: Position, right: Position): number {
  return left.y - right.y || left.x - right.x;
}

function validateRulesIdentity(value: unknown): JapaneseSettlementRulesIdentity {
  const snapshot = snapshotExactRecord(
    value,
    ["rules", "rulesProfile", "scoringMethod", "komi", "handicap"],
    "rules_identity_mismatch",
    "The Japanese rules identity",
  );
  if (
    snapshot.rules !== "japanese"
    || snapshot.rulesProfile !== JAPANESE_1989_RULES_PROFILE
    || snapshot.scoringMethod !== "territory"
    || (snapshot.komi !== 6.5 && snapshot.komi !== "6.5")
    || snapshot.handicap !== 0
  ) {
    return proposalError(
      "rules_identity_mismatch",
      "The proposal does not match the inactive Japanese 1989 rules tuple.",
    );
  }
  return {
    rules: snapshot.rules,
    rulesProfile: snapshot.rulesProfile,
    scoringMethod: snapshot.scoringMethod,
    komi: snapshot.komi,
    handicap: snapshot.handicap,
  };
}

function validatePrisoners(value: unknown): PrisonerLedger {
  const snapshot = snapshotExactRecord(
    value,
    ["capturedWhiteByBlack", "capturedBlackByWhite"],
    "invalid_prisoner_ledger",
    "The proposal prisoner ledger",
  );
  assertPostgresInteger(
    snapshot.capturedWhiteByBlack,
    0,
    "invalid_prisoner_ledger",
    "Captured White stones",
  );
  assertPostgresInteger(
    snapshot.capturedBlackByWhite,
    0,
    "invalid_prisoner_ledger",
    "Captured Black stones",
  );
  return {
    capturedWhiteByBlack: snapshot.capturedWhiteByBlack,
    capturedBlackByWhite: snapshot.capturedBlackByWhite,
  };
}

function validateDeadStones(
  value: unknown,
  boardRows: readonly string[],
): JapaneseSettlementDeadStone[] {
  const size = boardRows.length;
  const candidates = assertDenseBoundedArray(
    value,
    size * size,
    "invalid_dead_stone",
    "Dead-stone evidence",
  );
  const seen = new Set<string>();
  const deadStones: JapaneseSettlementDeadStone[] = [];

  for (const candidate of candidates) {
    const snapshot = snapshotExactRecord(
      candidate,
      ["x", "y", "color"],
      "invalid_dead_stone",
      "Dead-stone evidence entry",
    );
    const position = readPosition(
      { x: snapshot.x, y: snapshot.y },
      size,
      "invalid_dead_stone",
      "Dead-stone evidence entry",
    );
    const key = positionKey(position);
    if (seen.has(key)) {
      proposalError("duplicate_dead_stone", "Dead-stone evidence contains the same point twice.");
    }
    seen.add(key);
    if (snapshot.color !== "black" && snapshot.color !== "white") {
      proposalError("invalid_dead_stone", "Dead-stone evidence must identify a stone color.");
    }
    const expectedPoint = snapshot.color === "black" ? "B" : "W";
    if (boardRows[position.y][position.x] !== expectedPoint) {
      proposalError(
        "dead_stone_board_mismatch",
        "Dead-stone evidence must match the color on the stopped board.",
      );
    }
    deadStones.push({ ...position, color: snapshot.color });
  }

  return deadStones.sort((left, right) =>
    comparePositions(left, right) || left.color.localeCompare(right.color),
  );
}

function validateNeutralRegionSeeds(
  value: unknown,
  boardRows: readonly string[],
  deadStones: readonly JapaneseSettlementDeadStone[],
): Position[] {
  const size = boardRows.length;
  const candidates = assertDenseBoundedArray(
    value,
    size * size,
    "invalid_neutral_region_seed",
    "Neutral-region evidence",
  );
  const deadKeys = new Set(deadStones.map(positionKey));
  const seen = new Set<string>();
  const seeds: Position[] = [];

  for (const candidate of candidates) {
    const position = readPosition(
      candidate,
      size,
      "invalid_neutral_region_seed",
      "Neutral-region evidence",
    );
    const key = positionKey(position);
    if (seen.has(key)) {
      proposalError(
        "duplicate_neutral_region_seed",
        "Neutral-region evidence contains the same point twice.",
      );
    }
    seen.add(key);
    if (boardRows[position.y][position.x] !== "." && !deadKeys.has(key)) {
      proposalError(
        "invalid_neutral_region_seed",
        "A neutral-region seed must be empty after agreed dead stones are removed.",
      );
    }
    seeds.push(position);
  }

  return seeds.sort(comparePositions);
}

/**
 * Serializes exact Japanese settlement evidence without activating the dormant
 * rules profile. Territory, group, seki, and life/death semantics remain owned
 * by the Japanese scoring engine; this boundary validates evidence identity.
 */
export function serializeJapaneseSettlementProposalV1(
  input: JapaneseSettlementProposalInput,
): string {
  const proposal = snapshotExactRecord(
    input,
    [
      "gameId",
      "stoppedBoardHash",
      "stoppedMoveNumber",
      "revision",
      "rulesIdentity",
      "prisoners",
      "deadStones",
      "neutralRegionSeeds",
    ],
    "invalid_proposal",
    "The Japanese settlement proposal",
  );
  if (typeof proposal.gameId !== "string" || !CANONICAL_GAME_ID.test(proposal.gameId)) {
    return proposalError("invalid_game_id", "The proposal game ID must be a canonical lowercase UUID.");
  }
  const boardRows = parseStoppedBoardHash(proposal.stoppedBoardHash);
  assertPostgresInteger(
    proposal.stoppedMoveNumber,
    2,
    "invalid_stopped_move_number",
    "Stopped move number",
  );
  assertPostgresInteger(proposal.revision, 1, "invalid_revision", "Proposal revision");
  const rulesIdentity = validateRulesIdentity(proposal.rulesIdentity);
  const prisoners = validatePrisoners(proposal.prisoners);
  const deadStones = validateDeadStones(proposal.deadStones, boardRows);
  const neutralRegionSeeds = validateNeutralRegionSeeds(
    proposal.neutralRegionSeeds,
    boardRows,
    deadStones,
  );

  return JSON.stringify([
    JAPANESE_SETTLEMENT_PROPOSAL_DIGEST_VERSION,
    ["game-id", proposal.gameId],
    ["stopped-board-hash", proposal.stoppedBoardHash],
    ["stopped-move-number", String(proposal.stoppedMoveNumber)],
    ["revision", String(proposal.revision)],
    ["rules-identity", [
      ["rules", rulesIdentity.rules],
      ["rules-profile", rulesIdentity.rulesProfile],
      ["scoring-method", rulesIdentity.scoringMethod],
      ["komi-half-points", "13"],
      ["handicap", String(rulesIdentity.handicap)],
    ]],
    ["prisoner-ledger", [
      ["captured-white-by-black", String(prisoners.capturedWhiteByBlack)],
      ["captured-black-by-white", String(prisoners.capturedBlackByWhite)],
    ]],
    ["sorted-dead-stones", deadStones.map(({ x, y, color }) => [
      String(x),
      String(y),
      color,
    ])],
    ["sorted-neutral-region-seeds", neutralRegionSeeds.map(({ x, y }) => [
      String(x),
      String(y),
    ])],
  ]);
}

export function hashJapaneseSettlementProposalV1(
  input: JapaneseSettlementProposalInput,
): string {
  return createHash("sha256")
    .update(serializeJapaneseSettlementProposalV1(input), "utf8")
    .digest("hex");
}
