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
    position: { x: point.x, y: point.y },
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

// Capture Go has a deliberately small, deterministic opponent. Normal 9×9
// moves use GOSTONE_BOT_MODEL in the shared browser worker.
export function chooseLearnBotMove(position: LearnGamePosition): Position | null {
  const legal = legalLearnMoves(position);
  const size = position.board.length;
  let best: Position | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const move of legal) {
    const own = neighborCount(position.board, move, position.turn);
    const enemy = neighborCount(position.board, move, opposite(position.turn));
    const distance = Math.abs(move.x - (size - 1) / 2) + Math.abs(move.y - (size - 1) / 2);
    const score = move.captureCount * 10_000 + own * 18 + enemy * 12
      + Math.min(move.liberties, 4) * 4 - distance * 2
      - (move.liberties === 1 && move.captureCount === 0 ? 90 : 0)
      - (move.y * size + move.x) / 10_000;
    if (score > bestScore) { bestScore = score; best = { x: move.x, y: move.y }; }
  }
  return best;
}

export function storedLearnMoves(position: LearnGamePosition) {
  return position.moves.map((move, index) => ({
    moveNumber: index + 1, color: move.color,
    x: move.position?.x ?? null, y: move.position?.y ?? null,
    isPass: move.position === null, createdAt: "2000-01-01T00:00:00.000Z",
    boardHash: boardHash(move.board),
  }));
}

export type LearnReviewMoment = {
  kind: "reviewAtari" | "reviewConnection" | "reviewCapture";
  board: Board;
  group: Position[];
  emphasis: Position[];
  lastMove: Position | null;
  coordinate: string;
  count: number;
};

export function learnReviewMoments(position: LearnGamePosition): LearnReviewMoment[] {
  const moments: LearnReviewMoment[] = [];
  const kinds = new Set<string>();
  for (const [index, move] of position.moves.entries()) {
    const before = position.moves[index - 1]?.board ?? createLearnGame(position.board.length).board;
    const previousPoint = position.moves[index - 1]?.position ?? null;
    if (move.captured.length && !kinds.has(move.color === "white" ? "reviewAtari" : "reviewCapture")) {
      const kind = move.color === "white" ? "reviewAtari" : "reviewCapture";
      const group = getGroup(before, move.captured[0]);
      moments.push({ kind, board: before, group, emphasis: groupLiberties(before, group[0]), lastMove: previousPoint, coordinate: "", count: group.length });
      kinds.add(kind);
    }
    if (move.color === "black" && move.position && !kinds.has("reviewConnection")) {
      const precedingMoves = position.moves.slice(0, index);
      // A useful rescue connection must touch a weak group. Avoid replaying all
      // 361 intersections for every move when reviewing a 19×19 teaching game.
      const candidateKeys = new Map<string, Position>();
      for (const group of allGroups(before,"black")) {
        const liberties = groupLiberties(before,group[0]);
        if (liberties.length <= 2) for (const point of liberties) candidateKeys.set(pointKey(point),point);
      }
      const precedingPosition = {
        ...createLearnGame(before.length),
        board: before,
        turn: "black" as const,
        moves: precedingMoves,
        history: [boardHash(createLearnGame(before.length).board), ...precedingMoves.map((prior) => boardHash(prior.board))],
      };
      for (const point of candidateKeys.values()) {
        if (samePoint(point, move.position)) continue;
        const groups = getNeighbors(before, point).filter((p) => before[p.y][p.x] === "black").map((p) => getGroup(before, p));
        const unique = new Map(groups.map((g) => [g.map(pointKey).sort().join(","), g]));
        if (unique.size < 2 || ![...unique.values()].some((g) => groupLiberties(before, g[0]).length <= 2)) continue;
        const connection = playLearnMove(precedingPosition,point);
        if (!connection.ok || groupLiberties(connection.position.board,point).length < 2) continue;
        moments.push({ kind: "reviewConnection", board: before, group: [...unique.values()].flat(), emphasis: [point], lastMove: previousPoint, coordinate: `${"ABCDEFGHJKLMNOPQRST"[point.x]}${before.length - point.y}`, count: unique.size });
        kinds.add("reviewConnection");
        break;
      }
    }
    if (moments.length >= 3) break;
  }
  return moments;
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
