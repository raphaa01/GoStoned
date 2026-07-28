import { getGroup, getNeighbors, type PrisonerLedger } from "./goEngine";
import type { ScoredOutcome } from "./scoreContract";
import type { Board, Position, Stone } from "./types";

export type JapaneseScoringErrorCode =
  | "invalid_board"
  | "invalid_komi"
  | "invalid_prisoners"
  | "invalid_dead_stone"
  | "partial_dead_group"
  | "invalid_neutral_region"
  | "dead_stone_not_in_opponent_territory";

export class JapaneseScoringError extends Error {
  constructor(
    public readonly code: JapaneseScoringErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "JapaneseScoringError";
  }
}

export type JapanesePointOutcome = ScoredOutcome;

export type JapaneseTerritoryScore = Readonly<{
  method: "territory";
  livingBlackStones: number;
  livingWhiteStones: number;
  blackTerritory: number;
  whiteTerritory: number;
  damePoints: number;
  territoryExcludedByAgreement: number;
  capturedWhiteByBlack: number;
  capturedBlackByWhite: number;
  deadWhiteAwardedToBlack: number;
  deadBlackAwardedToWhite: number;
  blackPrisonersFinal: number;
  whitePrisonersFinal: number;
  komi: number;
  blackTotal: number;
  whiteTotal: number;
  outcome: JapanesePointOutcome;
}>;

type TerritoryMap = {
  blackStones: number;
  whiteStones: number;
  blackTerritory: number;
  whiteTerritory: number;
  damePoints: number;
  territoryExcludedByAgreement: number;
  owners: Map<string, Stone | null>;
};

function positionKey(position: Position): string {
  return `${position.x}:${position.y}`;
}

function opposite(color: Stone): Stone {
  return color === "black" ? "white" : "black";
}

function assertBoard(board: Board): void {
  if (
    ![9, 13, 19].includes(board.length)
    || board.some((row) =>
      row.length !== board.length
      || row.some((point) => point !== null && point !== "black" && point !== "white"),
    )
  ) {
    throw new JapaneseScoringError(
      "invalid_board",
      "Japanese settlement requires a square 9x9, 13x13, or 19x19 board.",
    );
  }
}

function assertPosition(board: Board, position: Position, code: JapaneseScoringErrorCode): void {
  if (
    !Number.isInteger(position.x)
    || !Number.isInteger(position.y)
    || position.y < 0
    || position.y >= board.length
    || position.x < 0
    || position.x >= board[position.y].length
  ) {
    throw new JapaneseScoringError(code, "The settlement contains an invalid board coordinate.");
  }
}

function validatePrisoners(prisoners: PrisonerLedger): void {
  if (
    !Number.isInteger(prisoners.capturedWhiteByBlack)
    || prisoners.capturedWhiteByBlack < 0
    || !Number.isInteger(prisoners.capturedBlackByWhite)
    || prisoners.capturedBlackByWhite < 0
  ) {
    throw new JapaneseScoringError(
      "invalid_prisoners",
      "Prisoner counts must be non-negative integers derived from the move record.",
    );
  }
}

function validateDeadStones(board: Board, deadStones: Position[]): Set<string> {
  const keys = new Set<string>();
  for (const position of deadStones) {
    assertPosition(board, position, "invalid_dead_stone");
    const key = positionKey(position);
    if (keys.has(key) || board[position.y][position.x] === null) {
      throw new JapaneseScoringError(
        "invalid_dead_stone",
        "Dead-stone agreement must identify each occupied point exactly once.",
      );
    }
    keys.add(key);
  }

  for (const position of deadStones) {
    if (getGroup(board, position).some((stone) => !keys.has(positionKey(stone)))) {
      throw new JapaneseScoringError(
        "partial_dead_group",
        "Dead-stone agreement must include every stone in a connected group.",
      );
    }
  }
  return keys;
}

function removeAgreedDeadStones(board: Board, deadKeys: ReadonlySet<string>): Board {
  return board.map((row, y) =>
    row.map((point, x) => (deadKeys.has(`${x}:${y}`) ? null : point)),
  );
}

function validateNeutralSeeds(board: Board, seeds: Position[]): Set<string> {
  const keys = new Set<string>();
  for (const position of seeds) {
    assertPosition(board, position, "invalid_neutral_region");
    const key = positionKey(position);
    if (keys.has(key) || board[position.y][position.x] !== null) {
      throw new JapaneseScoringError(
        "invalid_neutral_region",
        "Each agreed neutral-region seed must identify a distinct empty point.",
      );
    }
    keys.add(key);
  }
  return keys;
}

function mapTerritory(board: Board, neutralSeeds: ReadonlySet<string>): TerritoryMap {
  let blackStones = 0;
  let whiteStones = 0;
  let blackTerritory = 0;
  let whiteTerritory = 0;
  let damePoints = 0;
  let territoryExcludedByAgreement = 0;
  const owners = new Map<string, Stone | null>();
  const visited = new Set<string>();

  for (let y = 0; y < board.length; y += 1) {
    for (let x = 0; x < board[y].length; x += 1) {
      const stone = board[y][x];
      if (stone === "black") {
        blackStones += 1;
        continue;
      }
      if (stone === "white") {
        whiteStones += 1;
        continue;
      }
      const startKey = `${x}:${y}`;
      if (visited.has(startKey)) continue;

      const region: Position[] = [];
      const borders = new Set<Stone>();
      const stack: Position[] = [{ x, y }];
      while (stack.length > 0) {
        const current = stack.pop()!;
        const key = positionKey(current);
        if (visited.has(key)) continue;
        visited.add(key);
        region.push(current);
        for (const neighbor of getNeighbors(board, current)) {
          const neighborStone = board[neighbor.y][neighbor.x];
          if (neighborStone) borders.add(neighborStone);
          else if (!visited.has(positionKey(neighbor))) stack.push(neighbor);
        }
      }

      const naturalOwner = borders.size === 1 ? [...borders][0] : null;
      const neutralSeedCount = region.reduce(
        (count, point) => count + Number(neutralSeeds.has(positionKey(point))),
        0,
      );
      if (neutralSeedCount > 1 || (neutralSeedCount === 1 && naturalOwner === null)) {
        throw new JapaneseScoringError(
          "invalid_neutral_region",
          "Each agreed neutral region requires exactly one seed and must otherwise be territory.",
        );
      }
      const excludedByAgreement = neutralSeedCount === 1;
      const owner = excludedByAgreement ? null : naturalOwner;
      for (const point of region) owners.set(positionKey(point), owner);
      if (owner === "black") blackTerritory += region.length;
      else if (owner === "white") whiteTerritory += region.length;
      else if (excludedByAgreement) territoryExcludedByAgreement += region.length;
      else damePoints += region.length;
    }
  }

  return {
    blackStones,
    whiteStones,
    blackTerritory,
    whiteTerritory,
    damePoints,
    territoryExcludedByAgreement,
    owners,
  };
}

/**
 * Settles an already stopped position under Articles 8–10 of the 1989
 * Japanese Rules of Go. Captures must come from the authoritative move log.
 * Callers must provide one jointly agreed seed for every otherwise-owned empty
 * region that is dame under Article 8 (notably eyes belonging to seki groups).
 * This function deliberately does not infer life, death, or seki.
 * @see https://www.nihonkiin.or.jp/match/kiyaku/zenbun.htm
 */
export function scoreJapaneseTerritory(input: {
  board: Board;
  prisoners: PrisonerLedger;
  deadStones: Position[];
  agreedNeutralRegionSeeds: Position[];
  komi: number;
}): JapaneseTerritoryScore {
  const { board, prisoners, deadStones, agreedNeutralRegionSeeds, komi } = input;
  assertBoard(board);
  validatePrisoners(prisoners);
  if (!Number.isFinite(komi) || !Number.isInteger(komi * 2)) {
    throw new JapaneseScoringError(
      "invalid_komi",
      "Japanese settlement requires a finite half-point komi.",
    );
  }

  const deadKeys = validateDeadStones(board, deadStones);
  const scoredBoard = removeAgreedDeadStones(board, deadKeys);
  const neutralSeeds = validateNeutralSeeds(scoredBoard, agreedNeutralRegionSeeds);
  const territory = mapTerritory(scoredBoard, neutralSeeds);

  let blackDeadStones = 0;
  let whiteDeadStones = 0;
  for (const position of deadStones) {
    const color = board[position.y][position.x]!;
    if (territory.owners.get(positionKey(position)) !== opposite(color)) {
      throw new JapaneseScoringError(
        "dead_stone_not_in_opponent_territory",
        "Japanese rules remove agreed dead stones only from the opponent's territory.",
      );
    }
    if (color === "black") blackDeadStones += 1;
    else whiteDeadStones += 1;
  }

  const blackPrisonersFinal = prisoners.capturedWhiteByBlack + whiteDeadStones;
  const whitePrisonersFinal = prisoners.capturedBlackByWhite + blackDeadStones;
  const blackTotal = territory.blackTerritory + blackPrisonersFinal;
  const whiteTotal = territory.whiteTerritory + whitePrisonersFinal + komi;
  const outcome: JapanesePointOutcome = blackTotal === whiteTotal
    ? { kind: "jigo" }
    : {
        kind: "points",
        winner: blackTotal > whiteTotal ? "black" : "white",
        margin: Math.abs(blackTotal - whiteTotal),
      };

  return {
    method: "territory",
    livingBlackStones: territory.blackStones,
    livingWhiteStones: territory.whiteStones,
    blackTerritory: territory.blackTerritory,
    whiteTerritory: territory.whiteTerritory,
    damePoints: territory.damePoints,
    territoryExcludedByAgreement: territory.territoryExcludedByAgreement,
    capturedWhiteByBlack: prisoners.capturedWhiteByBlack,
    capturedBlackByWhite: prisoners.capturedBlackByWhite,
    deadWhiteAwardedToBlack: whiteDeadStones,
    deadBlackAwardedToWhite: blackDeadStones,
    blackPrisonersFinal,
    whitePrisonersFinal,
    komi,
    blackTotal,
    whiteTotal,
    outcome,
  };
}
