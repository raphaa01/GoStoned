import { getGroup, scoreChinese } from "./goEngine";
import type { Board, Position, Score, Stone } from "./types";

export type MarkedDeadGroup = {
  key: string;
  color: Stone;
  stones: Position[];
  representative: Position;
};

function positionKey(position: Position): string {
  return `${position.x}:${position.y}`;
}

export function sortPositions(positions: Position[]): Position[] {
  return [...positions].sort((left, right) => left.y - right.y || left.x - right.x);
}

export function groupMarkedDeadStones(
  board: Board,
  deadStones: Position[],
): MarkedDeadGroup[] {
  const deadKeys = new Set(deadStones.map(positionKey));
  const visited = new Set<string>();
  const groups: MarkedDeadGroup[] = [];

  for (const position of sortPositions(deadStones)) {
    const key = positionKey(position);
    if (visited.has(key)) continue;
    const color = board[position.y]?.[position.x];
    if (!color) continue;
    const stones = sortPositions(
      getGroup(board, position).filter((stone) => deadKeys.has(positionKey(stone))),
    );
    if (stones.length === 0) continue;
    for (const stone of stones) visited.add(positionKey(stone));
    const representative = stones[0];
    groups.push({
      key: positionKey(representative),
      color,
      stones,
      representative,
    });
  }

  return groups;
}

export function toggleDeadGroup(
  board: Board,
  currentDeadStones: Position[],
  position: Position,
  dead: boolean,
): { deadStones: Position[]; changed: boolean } {
  if (!Number.isInteger(position.x) || !Number.isInteger(position.y)) {
    throw new Error("A dead-stone proposal needs integer x and y coordinates.");
  }

  const group = getGroup(board, position);
  if (group.length === 0) {
    throw new Error("Only a stone group can be marked dead or alive.");
  }

  const marked = new Map(currentDeadStones.map((stone) => [positionKey(stone), stone]));
  let changed = false;
  for (const stone of group) {
    const key = positionKey(stone);
    if (dead && !marked.has(key)) {
      marked.set(key, stone);
      changed = true;
    } else if (!dead && marked.delete(key)) {
      changed = true;
    }
  }

  return { deadStones: sortPositions([...marked.values()]), changed };
}

export function removeDeadStones(board: Board, deadStones: Position[]): Board {
  const scoredBoard = board.map((row) => [...row]);
  for (const { x, y } of deadStones) {
    if (y >= 0 && y < scoredBoard.length && x >= 0 && x < scoredBoard[y].length) {
      scoredBoard[y][x] = null;
    }
  }
  return scoredBoard;
}

export function scoreChineseAgreement(
  board: Board,
  deadStones: Position[],
  komi: number,
): Score {
  return scoreChinese(removeDeadStones(board, deadStones), komi);
}

export function resumeTurnForClaim(requester: Stone, claim: "dead" | "alive"): Stone {
  if (claim === "dead") return requester;
  return requester === "black" ? "white" : "black";
}

export function scoringDeadlineExpired(expiresAt: Date, now: Date): boolean {
  return expiresAt.getTime() <= now.getTime();
}
