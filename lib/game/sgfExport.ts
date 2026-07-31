import {
  CURRENT_CHINESE_RULES_PROFILE,
  LEGACY_IMMEDIATE_AREA_PROFILE,
  type RulesProfile,
  type Ruleset,
  type ScoringMethod,
} from "./rulesPolicy";
import { JAPANESE_1989_RULES_PROFILE } from "./japanesePolicyContract";
import type { BoardSize, Position, Stone } from "./types";

export const SGF_EXPORT_CONTRACT_VERSION = "gostone-sgf-export-v1" as const;
export const VERIFIED_HANDICAP_EVIDENCE_VERSION =
  "gostone-fixed-handicap-v1" as const;

export type SgfExportRules = Readonly<{
  ruleset: Ruleset;
  rulesProfile: RulesProfile;
  scoringMethod: ScoringMethod;
  komi: number;
  handicap: number;
}>;

export type SgfExportMove = Readonly<{
  moveNumber: number;
  color: Stone;
  x: number | null;
  y: number | null;
  isPass: boolean;
}>;

export type VerifiedHandicapEvidence = Readonly<{
  kind: "verified-fixed-placement";
  version: typeof VERIFIED_HANDICAP_EVIDENCE_VERSION;
  stones: readonly Position[];
}>;

export type SgfTerminalResult =
  | Readonly<{ kind: "score"; winner: Stone; margin: number }>
  | Readonly<{ kind: "resignation"; winner: Stone }>
  | Readonly<{ kind: "timeout"; winner: Stone }>
  | Readonly<{ kind: "forfeit"; winner: Stone }>
  | Readonly<{ kind: "draw" }>
  | Readonly<{
      kind: "no-result";
      reason:
        | "cyclic-repetition"
        | "no-participation"
        | "adjudication-unavailable"
        | "adjudication-invalid"
        | "adjudication-low-confidence";
    }>;

export type SgfBotDisclosure = Readonly<{
  provider: string;
  model: string;
  version?: string;
}>;

export type SgfExportPlayers = Readonly<{
  blackName?: string;
  whiteName?: string;
}>;

export type SgfExportBots = Readonly<{
  black?: SgfBotDisclosure;
  white?: SgfBotDisclosure;
}>;

/**
 * Immutable evidence needed to export one persisted game without deriving or
 * reinterpreting its rules or terminal outcome.
 */
export type SgfExportInput = Readonly<{
  gameId: string;
  boardSize: BoardSize;
  rules: SgfExportRules;
  moves: readonly SgfExportMove[];
  result: SgfTerminalResult;
  handicapEvidence?: VerifiedHandicapEvidence;
  players?: SgfExportPlayers;
  bots?: SgfExportBots;
}>;

export type SgfExportErrorCode =
  | "invalid_input"
  | "invalid_game_id"
  | "invalid_board_size"
  | "invalid_rules"
  | "invalid_komi"
  | "invalid_handicap"
  | "invalid_handicap_evidence"
  | "invalid_move"
  | "invalid_result"
  | "invalid_metadata";

export class SgfExportError extends Error {
  constructor(
    public readonly code: SgfExportErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "SgfExportError";
  }
}

type PlainObject = Record<string, unknown>;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NO_RESULT_REASONS = new Set([
  "cyclic-repetition",
  "no-participation",
  "adjudication-unavailable",
  "adjudication-invalid",
  "adjudication-low-confidence",
]);

function isPlainObject(value: unknown): value is PlainObject {
  if (value === null || typeof value !== "object") return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function requireExactKeys(
  value: unknown,
  required: readonly string[],
  optional: readonly string[],
  code: SgfExportErrorCode,
  label: string,
): asserts value is PlainObject {
  if (!isPlainObject(value)) {
    throw new SgfExportError(code, `${label} must be a plain object.`);
  }
  const allowed = new Set([...required, ...optional]);
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.some((key) => typeof key !== "string")) {
    throw new SgfExportError(code, `${label} contains an unsupported field.`);
  }
  const keys = ownKeys as string[];
  if (required.some((key) => !Object.prototype.hasOwnProperty.call(value, key))) {
    throw new SgfExportError(code, `${label} is missing a required field.`);
  }
  if (keys.some((key) => !allowed.has(key))) {
    throw new SgfExportError(code, `${label} contains an unsupported field.`);
  }
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) {
      throw new SgfExportError(code, `${label} fields must be enumerable data properties.`);
    }
  }
}

function requireDenseArray(
  value: unknown,
  code: SgfExportErrorCode,
  label: string,
): asserts value is unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    throw new SgfExportError(code, `${label} must be an array.`);
  }
  const expectedKeys = new Set([
    "length",
    ...Array.from({ length: value.length }, (_, index) => String(index)),
  ]);
  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.some((key) => typeof key !== "string" || !expectedKeys.has(key))
    || ownKeys.length !== expectedKeys.size
  ) {
    throw new SgfExportError(code, `${label} must be a dense array without extra fields.`);
  }
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) {
      throw new SgfExportError(code, `${label} entries must be enumerable data properties.`);
    }
  }
}

function requireBoundedText(
  value: unknown,
  label: string,
  maximumLength = 256,
): string {
  if (typeof value !== "string" || value.length === 0 || value.length > maximumLength) {
    throw new SgfExportError(
      "invalid_metadata",
      `${label} must be a non-empty string of at most ${maximumLength} characters.`,
    );
  }
  if (/\u0000/.test(value)) {
    throw new SgfExportError("invalid_metadata", `${label} must not contain NUL.`);
  }
  return value;
}

function validateRules(value: unknown): SgfExportRules {
  requireExactKeys(
    value,
    ["ruleset", "rulesProfile", "scoringMethod", "komi", "handicap"],
    [],
    "invalid_rules",
    "Rules evidence",
  );
  const { ruleset, rulesProfile, scoringMethod, komi, handicap } = value;
  const japanese = rulesProfile === JAPANESE_1989_RULES_PROFILE
    && ruleset === "japanese"
    && scoringMethod === "territory";
  const currentChinese = rulesProfile === CURRENT_CHINESE_RULES_PROFILE
    && ruleset === "chinese"
    && scoringMethod === "area";
  const legacyChinese = rulesProfile === LEGACY_IMMEDIATE_AREA_PROFILE
    && ruleset === "chinese"
    && scoringMethod === "area";

  if (!japanese && !currentChinese && !legacyChinese) {
    throw new SgfExportError(
      "invalid_rules",
      "The persisted rules tuple does not match a supported versioned profile.",
    );
  }
  if (typeof komi !== "number" || !Number.isFinite(komi) || !Number.isInteger(komi * 2)) {
    throw new SgfExportError("invalid_komi", "Persisted komi must be a finite half-point value.");
  }
  if (
    (japanese && komi !== 6.5)
    || (currentChinese && komi !== 7.5)
    || (legacyChinese && komi !== 6.5 && komi !== 7.5)
  ) {
    throw new SgfExportError(
      "invalid_komi",
      "Persisted komi is not valid for the versioned rules profile.",
    );
  }
  if (
    typeof handicap !== "number"
    || !Number.isInteger(handicap)
    || handicap < 0
    || handicap > 9
  ) {
    throw new SgfExportError("invalid_handicap", "Persisted handicap must be an integer from 0 to 9.");
  }
  if (!japanese && handicap !== 0) {
    throw new SgfExportError(
      "invalid_handicap",
      "Historical Chinese GoStone profiles support only even games.",
    );
  }
  if (japanese && handicap === 1) {
    throw new SgfExportError(
      "invalid_handicap",
      "A fixed Japanese handicap must contain between 2 and 9 setup stones.",
    );
  }
  return value as SgfExportRules;
}

function validatePosition(
  value: unknown,
  boardSize: BoardSize,
  code: SgfExportErrorCode,
  label: string,
): Position {
  requireExactKeys(value, ["x", "y"], [], code, label);
  if (
    !Number.isInteger(value.x)
    || !Number.isInteger(value.y)
    || (value.x as number) < 0
    || (value.y as number) < 0
    || (value.x as number) >= boardSize
    || (value.y as number) >= boardSize
  ) {
    throw new SgfExportError(code, `${label} is outside the board.`);
  }
  return { x: value.x as number, y: value.y as number };
}

function validateHandicapEvidence(
  rules: SgfExportRules,
  boardSize: BoardSize,
  value: unknown,
): readonly Position[] {
  if (rules.handicap === 0) {
    if (value !== undefined) {
      throw new SgfExportError(
        "invalid_handicap_evidence",
        "Even games must not contain handicap placement evidence.",
      );
    }
    return [];
  }

  requireExactKeys(
    value,
    ["kind", "version", "stones"],
    [],
    "invalid_handicap_evidence",
    "Handicap evidence",
  );
  if (
    value.kind !== "verified-fixed-placement"
    || value.version !== VERIFIED_HANDICAP_EVIDENCE_VERSION
    || !Array.isArray(value.stones)
  ) {
    throw new SgfExportError(
      "invalid_handicap_evidence",
      "Handicap evidence must be verified, versioned, and complete.",
    );
  }
  requireDenseArray(value.stones, "invalid_handicap_evidence", "Handicap stones");
  if (value.stones.length !== rules.handicap) {
    throw new SgfExportError(
      "invalid_handicap_evidence",
      "Handicap evidence must contain exactly the persisted number of stones.",
    );
  }
  const stones = value.stones.map((stone, index) => (
    validatePosition(stone, boardSize, "invalid_handicap_evidence", `Handicap stone ${index + 1}`)
  ));
  if (new Set(stones.map(({ x, y }) => `${x}:${y}`)).size !== stones.length) {
    throw new SgfExportError(
      "invalid_handicap_evidence",
      "Verified handicap setup stones must be unique.",
    );
  }
  return stones.sort((left, right) => left.x - right.x || left.y - right.y);
}

function validateMoves(
  value: unknown,
  boardSize: BoardSize,
  handicap: number,
): readonly SgfExportMove[] {
  requireDenseArray(value, "invalid_move", "Move evidence");
  const initialColor: Stone = handicap > 0 ? "white" : "black";
  return value.map((move, index) => {
    requireExactKeys(
      move,
      ["moveNumber", "color", "x", "y", "isPass"],
      [],
      "invalid_move",
      `Move ${index + 1}`,
    );
    if (move.moveNumber !== index + 1) {
      throw new SgfExportError("invalid_move", "Move numbers must be dense and start at 1.");
    }
    if (move.color !== "black" && move.color !== "white") {
      throw new SgfExportError("invalid_move", `Move ${index + 1} has an invalid player color.`);
    }
    if (index === 0 && move.color !== initialColor) {
      throw new SgfExportError("invalid_move", "The first played move has the wrong player color.");
    }
    if (typeof move.isPass !== "boolean") {
      throw new SgfExportError("invalid_move", `Move ${index + 1} has an invalid pass flag.`);
    }
    if (move.isPass) {
      if (move.x !== null || move.y !== null) {
        throw new SgfExportError("invalid_move", `Pass ${index + 1} must not contain coordinates.`);
      }
    } else {
      validatePosition(
        { x: move.x, y: move.y },
        boardSize,
        "invalid_move",
        `Move ${index + 1}`,
      );
    }
    return move as SgfExportMove;
  });
}

function validateResult(value: unknown): SgfTerminalResult {
  if (!isPlainObject(value) || typeof value.kind !== "string") {
    throw new SgfExportError("invalid_result", "Terminal result must be an explicit outcome object.");
  }
  switch (value.kind) {
    case "score":
      requireExactKeys(value, ["kind", "winner", "margin"], [], "invalid_result", "Score result");
      if (
        (value.winner !== "black" && value.winner !== "white")
        || typeof value.margin !== "number"
        || !Number.isFinite(value.margin)
        || value.margin <= 0
        || !Number.isInteger(value.margin * 2)
      ) {
        throw new SgfExportError("invalid_result", "A score result requires a winner and positive half-point margin.");
      }
      break;
    case "resignation":
    case "timeout":
    case "forfeit":
      requireExactKeys(value, ["kind", "winner"], [], "invalid_result", "Decisive result");
      if (value.winner !== "black" && value.winner !== "white") {
        throw new SgfExportError("invalid_result", "A decisive result requires a winner.");
      }
      break;
    case "draw":
      requireExactKeys(value, ["kind"], [], "invalid_result", "Draw result");
      break;
    case "no-result":
      requireExactKeys(value, ["kind", "reason"], [], "invalid_result", "No-result outcome");
      if (typeof value.reason !== "string" || !NO_RESULT_REASONS.has(value.reason)) {
        throw new SgfExportError("invalid_result", "No-result requires a stable machine reason.");
      }
      break;
    default:
      throw new SgfExportError("invalid_result", "The terminal result kind is unsupported.");
  }
  return value as SgfTerminalResult;
}

function validatePlayers(value: unknown): SgfExportPlayers | undefined {
  if (value === undefined) return undefined;
  requireExactKeys(value, [], ["blackName", "whiteName"], "invalid_metadata", "Player metadata");
  if (value.blackName !== undefined) requireBoundedText(value.blackName, "Black player name");
  if (value.whiteName !== undefined) requireBoundedText(value.whiteName, "White player name");
  return value as SgfExportPlayers;
}

function validateBot(value: unknown, label: string): SgfBotDisclosure {
  requireExactKeys(value, ["provider", "model"], ["version"], "invalid_metadata", label);
  requireBoundedText(value.provider, `${label} provider`, 128);
  requireBoundedText(value.model, `${label} model`, 128);
  if (value.version !== undefined) requireBoundedText(value.version, `${label} version`, 128);
  return value as SgfBotDisclosure;
}

function validateBots(value: unknown): SgfExportBots | undefined {
  if (value === undefined) return undefined;
  requireExactKeys(value, [], ["black", "white"], "invalid_metadata", "Bot metadata");
  if (value.black !== undefined) validateBot(value.black, "Black bot");
  if (value.white !== undefined) validateBot(value.white, "White bot");
  return value as SgfExportBots;
}

function canonicalNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function sgfCoordinate({ x, y }: Position): string {
  return `${String.fromCharCode(97 + x)}${String.fromCharCode(97 + y)}`;
}

/** Escape an SGF property value after normalizing line endings. */
export function escapeSgfText(value: string): string {
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/\\/g, "\\\\")
    .replace(/\]/g, "\\]");
}

function escapeSgfSimpleText(value: string): string {
  return escapeSgfText(value.replace(/[\t\n\r\f\v]+/g, " "));
}

function property(identifier: string, value: string, simpleText = true): string {
  return `${identifier}[${simpleText ? escapeSgfSimpleText(value) : escapeSgfText(value)}]`;
}

function botJson(value: SgfBotDisclosure): string {
  return JSON.stringify({
    kind: "bot",
    provider: value.provider,
    model: value.model,
    ...(value.version === undefined ? {} : { version: value.version }),
  });
}

function resultValue(result: SgfTerminalResult): string {
  switch (result.kind) {
    case "score":
      return `${result.winner === "black" ? "B" : "W"}+${canonicalNumber(result.margin)}`;
    case "resignation":
      return `${result.winner === "black" ? "B" : "W"}+R`;
    case "timeout":
      return `${result.winner === "black" ? "B" : "W"}+T`;
    case "forfeit":
      return `${result.winner === "black" ? "B" : "W"}+F`;
    case "draw":
      return "0";
    case "no-result":
      return "Void";
  }
}

/**
 * Serialize one validated persisted record as a deterministic SGF FF[4] game.
 * No current default or scoring implementation is consulted during export.
 */
export function exportGameToSgf(input: SgfExportInput): string {
  requireExactKeys(
    input,
    ["gameId", "boardSize", "rules", "moves", "result"],
    ["handicapEvidence", "players", "bots"],
    "invalid_input",
    "SGF export input",
  );
  if (typeof input.gameId !== "string" || !UUID_PATTERN.test(input.gameId)) {
    throw new SgfExportError("invalid_game_id", "Game ID must be a canonical UUID.");
  }
  if (input.boardSize !== 9 && input.boardSize !== 13 && input.boardSize !== 19) {
    throw new SgfExportError("invalid_board_size", "Board size must be 9, 13, or 19.");
  }

  const rules = validateRules(input.rules);
  const handicapStones = validateHandicapEvidence(
    rules,
    input.boardSize,
    input.handicapEvidence,
  );
  const moves = validateMoves(input.moves, input.boardSize, rules.handicap);
  const result = validateResult(input.result);
  const players = validatePlayers(input.players);
  const bots = validateBots(input.bots);

  const root = [
    property("FF", "4"),
    property("GM", "1"),
    property("CA", "UTF-8"),
    property("AP", `GoStone:${SGF_EXPORT_CONTRACT_VERSION}`),
    property("SZ", String(input.boardSize)),
    property("RU", rules.rulesProfile),
    property("KM", canonicalNumber(rules.komi)),
    property("RE", resultValue(result)),
    property("GSCV", SGF_EXPORT_CONTRACT_VERSION),
    property("GSID", input.gameId),
    property("GSRP", rules.rulesProfile),
    property("GSRS", rules.ruleset),
    property("GSSM", rules.scoringMethod),
  ];
  if (rules.handicap > 0) {
    root.push(property("HA", String(rules.handicap)));
    root.push(`AB${handicapStones.map((stone) => `[${sgfCoordinate(stone)}]`).join("")}`);
  }
  if (result.kind === "no-result") root.push(property("GSNR", result.reason));
  if (players?.blackName !== undefined) root.push(property("PB", players.blackName));
  if (players?.whiteName !== undefined) root.push(property("PW", players.whiteName));
  if (bots?.black !== undefined) root.push(property("GSBOTB", botJson(bots.black), false));
  if (bots?.white !== undefined) root.push(property("GSBOTW", botJson(bots.white), false));

  const nodes = moves.map((move) => {
    const identifier = move.color === "black" ? "B" : "W";
    const coordinate = move.isPass ? "" : sgfCoordinate({ x: move.x!, y: move.y! });
    return `;${property(identifier, coordinate)}`;
  });
  return `(;${root.join("")}${nodes.join("")})\n`;
}
