import { getGroup } from "./goEngine";
import type { Board, BoardSize, Position } from "./types";

export const JAPANESE_SETTLEMENT_PROVIDER_CONTRACT =
  "gostone-japanese-settlement-provider-v1" as const;

export type JapaneseSettlementSuggestion = Readonly<{
  contractVersion: typeof JAPANESE_SETTLEMENT_PROVIDER_CONTRACT;
  authority: "proposal-only";
  gameId: string;
  boardSize: BoardSize;
  stoppedBoardHash: string;
  stoppedMoveNumber: number;
  scoringRevision: number;
  provider: Readonly<{
    id: string;
    modelVersion: string;
    artifactSha256?: string;
  }>;
  deadStones: readonly Position[];
  uncertainStones: readonly Position[];
  neutralRegionSeeds: readonly Position[];
}>;

export type JapaneseSettlementProvider = Readonly<{
  id: string;
  propose(input: Readonly<{
    gameId: string;
    boardSize: BoardSize;
    board: Board;
    stoppedBoardHash: string;
    stoppedMoveNumber: number;
    scoringRevision: number;
  }>): Promise<JapaneseSettlementSuggestion>;
}>;

export class JapaneseSettlementSuggestionError extends Error {
  constructor(public readonly code: "invalid_suggestion" | "stale_suggestion", message: string) {
    super(message);
    this.name = "JapaneseSettlementSuggestionError";
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedText(value: unknown, maximum = 160): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maximum;
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).sort().join(",") === [...keys].sort().join(",");
}

function positions(value: unknown, boardSize: BoardSize, label: string): Position[] {
  if (!Array.isArray(value) || value.length > boardSize * boardSize) {
    throw new JapaneseSettlementSuggestionError("invalid_suggestion", `${label} is invalid.`);
  }
  const parsed = value.map((candidate) => {
    if (!record(candidate) || Object.keys(candidate).sort().join(",") !== "x,y") {
      throw new JapaneseSettlementSuggestionError("invalid_suggestion", `${label} is invalid.`);
    }
    const { x, y } = candidate;
    if (!Number.isInteger(x) || !Number.isInteger(y)
      || Number(x) < 0 || Number(y) < 0
      || Number(x) >= boardSize || Number(y) >= boardSize) {
      throw new JapaneseSettlementSuggestionError("invalid_suggestion", `${label} is invalid.`);
    }
    return { x: Number(x), y: Number(y) };
  });
  if (new Set(parsed.map(({ x, y }) => `${x}:${y}`)).size !== parsed.length) {
    throw new JapaneseSettlementSuggestionError("invalid_suggestion", `${label} contains duplicates.`);
  }
  return parsed;
}

export function validateJapaneseSettlementSuggestion(
  value: unknown,
  expected: Readonly<{
    gameId: string;
    boardSize: BoardSize;
    board: Board;
    stoppedBoardHash: string;
    stoppedMoveNumber: number;
    scoringRevision: number;
  }>,
): JapaneseSettlementSuggestion {
  if (!record(value)
    || !hasExactKeys(value, [
      "contractVersion", "authority", "gameId", "boardSize", "stoppedBoardHash",
      "stoppedMoveNumber", "scoringRevision", "provider", "deadStones",
      "uncertainStones", "neutralRegionSeeds",
    ])
    || value.contractVersion !== JAPANESE_SETTLEMENT_PROVIDER_CONTRACT
    || value.authority !== "proposal-only"
    || !record(value.provider)
    || !hasExactKeys(
      value.provider,
      value.provider.artifactSha256 === undefined
        ? ["id", "modelVersion"]
        : ["id", "modelVersion", "artifactSha256"],
    )
    || !boundedText(value.provider.id)
    || !boundedText(value.provider.modelVersion)
    || (value.provider.artifactSha256 !== undefined
      && (typeof value.provider.artifactSha256 !== "string"
        || !/^[0-9a-f]{64}$/.test(value.provider.artifactSha256)))) {
    throw new JapaneseSettlementSuggestionError("invalid_suggestion", "The model suggestion contract is invalid.");
  }
  if (value.gameId !== expected.gameId
    || value.boardSize !== expected.boardSize
    || value.stoppedBoardHash !== expected.stoppedBoardHash
    || value.stoppedMoveNumber !== expected.stoppedMoveNumber
    || value.scoringRevision !== expected.scoringRevision) {
    throw new JapaneseSettlementSuggestionError("stale_suggestion", "The model suggestion belongs to another scoring position.");
  }
  const deadStones = positions(value.deadStones, expected.boardSize, "Dead stones");
  const uncertainStones = positions(value.uncertainStones, expected.boardSize, "Uncertain stones");
  const neutralRegionSeeds = positions(value.neutralRegionSeeds, expected.boardSize, "Neutral regions");
  const deadKeys = new Set(deadStones.map(({ x, y }) => `${x}:${y}`));
  const uncertainKeys = new Set(uncertainStones.map(({ x, y }) => `${x}:${y}`));
  for (const point of deadStones) {
    if (!expected.board[point.y][point.x]) {
      throw new JapaneseSettlementSuggestionError("invalid_suggestion", "A proposed dead point is empty.");
    }
    if (uncertainKeys.has(`${point.x}:${point.y}`)
      || getGroup(expected.board, point).some(({ x, y }) => !deadKeys.has(`${x}:${y}`))) {
      throw new JapaneseSettlementSuggestionError("invalid_suggestion", "Model suggestions must mark complete, non-uncertain groups.");
    }
  }
  for (const point of uncertainStones) {
    if (!expected.board[point.y][point.x]
      || getGroup(expected.board, point).some(({ x, y }) => !uncertainKeys.has(`${x}:${y}`))) {
      throw new JapaneseSettlementSuggestionError(
        "invalid_suggestion",
        "Uncertain suggestions must identify complete stone groups.",
      );
    }
  }
  return {
    contractVersion: JAPANESE_SETTLEMENT_PROVIDER_CONTRACT,
    authority: "proposal-only",
    gameId: expected.gameId,
    boardSize: expected.boardSize,
    stoppedBoardHash: expected.stoppedBoardHash,
    stoppedMoveNumber: expected.stoppedMoveNumber,
    scoringRevision: expected.scoringRevision,
    provider: {
      id: value.provider.id as string,
      modelVersion: value.provider.modelVersion as string,
      ...(value.provider.artifactSha256 === undefined
        ? {} : { artifactSha256: value.provider.artifactSha256 as string }),
    },
    deadStones,
    uncertainStones,
    neutralRegionSeeds,
  };
}
