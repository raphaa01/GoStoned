import {
  applyMove,
  boardHash,
  countLiberties,
  getGroup,
  getNeighbors,
} from "@/lib/game/goEngine";
import type { Board, Position, Stone } from "@/lib/game/types";

export type LearnStone = Position & { color: Stone };

export type LearnMove = Readonly<{
  color: Stone;
  position: Position | null;
  captured: readonly Position[];
  board: Board;
}>;

export type LearnGamePosition = Readonly<{
  board: Board;
  turn: Stone;
  history: readonly string[];
  moves: readonly LearnMove[];
  consecutivePasses: number;
  capturedWhiteByBlack: number;
  capturedBlackByWhite: number;
}>;

export type LearnMoveResult =
  | Readonly<{ ok: true; position: LearnGamePosition; captured: readonly Position[] }>
  | Readonly<{ ok: false; error: "occupied" | "out_of_bounds" | "suicide" | "ko" }>;

export function pointKey({ x, y }: Position): string {
  return `${x}:${y}`;
}

export function samePoint(left: Position, right: Position): boolean {
  return left.x === right.x && left.y === right.y;
}

export function opposite(color: Stone): Stone {
  return color === "black" ? "white" : "black";
}

export function boardFromStones(size: number, stones: readonly LearnStone[]): Board {
  const board: Board = Array.from({ length: size }, () => Array<Stone | null>(size).fill(null));
  for (const stone of stones) {
    if (stone.x < 0 || stone.y < 0 || stone.x >= size || stone.y >= size) {
      throw new RangeError(`Teaching stone ${pointKey(stone)} is outside ${size}x${size}.`);
    }
    if (board[stone.y][stone.x]) throw new Error(`Duplicate teaching stone on ${pointKey(stone)}.`);
    board[stone.y][stone.x] = stone.color;
  }
  return board;
}

export function stonesFromBoard(board: Board): LearnStone[] {
  return board.flatMap((row, y) => row.flatMap((color, x) => color ? [{ x, y, color }] : []));
}

export function createLearnGame(size: number, stones: readonly LearnStone[] = []): LearnGamePosition {
  const board = boardFromStones(size, stones);
  return {
    board,
    turn: "black",
    history: [boardHash(board)],
    moves: [],
    consecutivePasses: 0,
    capturedWhiteByBlack: 0,
    capturedBlackByWhite: 0,
  };
}

export function withLearnTurn(position: LearnGamePosition, turn: Stone): LearnGamePosition {
  return { ...position, turn };
}

export function playLearnMove(position: LearnGamePosition, point: Position): LearnMoveResult {
  const applied = applyMove(position.board, position.turn, point.x, point.y);
  if (!applied.ok) return { ok: false, error: applied.error };
  const hash = boardHash(applied.board);
  if (position.history.length >= 2 && hash === position.history[position.history.length - 2]) {
    return { ok: false, error: "ko" };
  }
  const move: LearnMove = {
    color: position.turn,
    position: { ...point },
    captured: applied.captured,
    board: applied.board,
  };
  return {
    ok: true,
    captured: applied.captured,
    position: {
      board: applied.board,
      turn: opposite(position.turn),
      history: [...position.history, hash],
      moves: [...position.moves, move],
      consecutivePasses: 0,
      capturedWhiteByBlack: position.capturedWhiteByBlack
        + (position.turn === "black" ? applied.captured.length : 0),
      capturedBlackByWhite: position.capturedBlackByWhite
        + (position.turn === "white" ? applied.captured.length : 0),
    },
  };
}

export function passLearnMove(position: LearnGamePosition): LearnGamePosition {
  const move: LearnMove = {
    color: position.turn,
    position: null,
    captured: [],
    board: position.board,
  };
  return {
    ...position,
    turn: opposite(position.turn),
    history: [...position.history, boardHash(position.board)],
    moves: [...position.moves, move],
    consecutivePasses: position.consecutivePasses + 1,
  };
}

export function groupLiberties(board: Board, start: Position): Position[] {
  const keys = new Map<string, Position>();
  for (const stone of getGroup(board, start)) {
    for (const neighbor of getNeighbors(board, stone)) {
      if (board[neighbor.y][neighbor.x] === null) keys.set(pointKey(neighbor), neighbor);
    }
  }
  return [...keys.values()];
}

export function allGroups(board: Board, color?: Stone): Position[][] {
  const seen = new Set<string>();
  const groups: Position[][] = [];
  for (let y = 0; y < board.length; y += 1) {
    for (let x = 0; x < board.length; x += 1) {
      const stone = board[y][x];
      if (!stone || (color && stone !== color) || seen.has(`${x}:${y}`)) continue;
      const group = getGroup(board, { x, y });
      group.forEach((point) => seen.add(pointKey(point)));
      groups.push(group);
    }
  }
  return groups;
}

export function legalLearnMoves(position: LearnGamePosition): Array<Position & { captureCount: number; liberties: number }> {
  const legal: Array<Position & { captureCount: number; liberties: number }> = [];
  for (let y = 0; y < position.board.length; y += 1) {
    for (let x = 0; x < position.board.length; x += 1) {
      const result = playLearnMove(position, { x, y });
      if (!result.ok) continue;
      legal.push({
        x,
        y,
        captureCount: result.captured.length,
        liberties: countLiberties(result.position.board, getGroup(result.position.board, { x, y })),
      });
    }
  }
  return legal;
}

function neighborCount(board: Board, point: Position, color: Stone) {
  return getNeighbors(board, point).filter((neighbor) => board[neighbor.y][neighbor.x] === color).length;
}

const TEACHER_ANCHORS: readonly Position[] = [
  { x: 6, y: 2 }, { x: 6, y: 6 }, { x: 2, y: 6 }, { x: 2, y: 2 },
  { x: 4, y: 2 }, { x: 6, y: 4 }, { x: 4, y: 6 }, { x: 2, y: 4 },
];

export function chooseLearnBotMove(
  position: LearnGamePosition,
  mode: "capture" | "teacher" | "beginner",
): Position | null {
  const legal = legalLearnMoves(position);
  if (legal.length === 0) return null;
  const size = position.board.length;
  const opponent = opposite(position.turn);
  const occupied = position.board.flat().filter(Boolean).length;
  if (mode !== "capture" && (position.moves.length >= 70 || occupied >= Math.floor(size * size * 0.72))) return null;

  let best: Position | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const move of legal) {
    const center = (size - 1) / 2;
    const distance = Math.abs(move.x - center) + Math.abs(move.y - center);
    const ownNeighbors = neighborCount(position.board, move, position.turn);
    const opponentNeighbors = neighborCount(position.board, move, opponent);
    let score = move.captureCount * (mode === "capture" ? 10_000 : 500);
    score += ownNeighbors * (mode === "capture" ? 18 : 9);
    score += opponentNeighbors * (mode === "capture" ? 12 : mode === "beginner" ? 7 : 3);
    score += Math.min(move.liberties, 4) * 4;
    if (move.liberties === 1 && move.captureCount === 0) score -= 90;
    score -= distance * (mode === "capture" ? 2 : 0.35);

    if (mode !== "capture") {
      const anchorIndex = TEACHER_ANCHORS.findIndex((anchor) => samePoint(anchor, move));
      if (anchorIndex >= 0) score += Math.max(0, 28 - anchorIndex * 2);
      if (mode === "teacher" && opponentNeighbors > 0 && move.captureCount === 0) score -= 5;
    }
    // Stable tie-breaking keeps the teacher predictable and testable.
    score -= (move.y * size + move.x) / 10_000;
    if (score > bestScore) {
      bestScore = score;
      best = { x: move.x, y: move.y };
    }
  }
  return best;
}

export function territoryPoints(board: Board, owner: Stone): Position[] {
  const result: Position[] = [];
  const visited = new Set<string>();
  for (let y = 0; y < board.length; y += 1) {
    for (let x = 0; x < board.length; x += 1) {
      if (board[y][x] !== null || visited.has(`${x}:${y}`)) continue;
      const region: Position[] = [];
      const borders = new Set<Stone>();
      const pending = [{ x, y }];
      while (pending.length) {
        const point = pending.pop()!;
        const key = pointKey(point);
        if (visited.has(key)) continue;
        visited.add(key);
        region.push(point);
        for (const neighbor of getNeighbors(board, point)) {
          const stone = board[neighbor.y][neighbor.x];
          if (stone) borders.add(stone);
          else if (!visited.has(pointKey(neighbor))) pending.push(neighbor);
        }
      }
      if (borders.size === 1 && borders.has(owner)) result.push(...region);
    }
  }
  return result;
}
