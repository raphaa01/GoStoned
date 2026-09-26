import {
  applyMove,
  countLiberties,
  getGroup,
  replayMoves,
  replayMovesWithPrisoners,
} from "@/lib/game/goEngine";
import type { Board, Position, Stone } from "@/lib/game/types";
import {
  botStrengthForRating,
  GOSTONE_BOT_MODEL,
  type GoStoneBotPosition,
} from "./modelV1";

function boardOffset(size: number): number {
  return (GOSTONE_BOT_MODEL.maximumBoardSize - size) / 2;
}

function previousBoard(position: GoStoneBotPosition, movesAgo: number): Board | null {
  const moveCount = position.moves.length - movesAgo;
  if (moveCount < 0) return null;
  return replayMoves(position.boardSize, [...position.moves.slice(0, moveCount)]);
}

function simpleKoPoint(position: GoStoneBotPosition, beforeLastMove: Board | null): Position | null {
  const lastMove = position.moves.at(-1);
  if (
    !beforeLastMove
    || !lastMove
    || lastMove.isPass
    || lastMove.x === null
    || lastMove.y === null
  ) return null;
  const applied = applyMove(beforeLastMove, lastMove.color, lastMove.x, lastMove.y);
  if (!applied.ok || applied.captured.length !== 1) return null;
  const group = getGroup(applied.board, { x: lastMove.x, y: lastMove.y });
  return group.length === 1 && countLiberties(applied.board, group) === 1
    ? applied.captured[0]
    : null;
}

export function buildLegacyV4Features(position: GoStoneBotPosition): Float32Array {
  const size = position.boardSize;
  const area = GOSTONE_BOT_MODEL.maximumBoardSize ** 2;
  const features = new Float32Array(12 * area);
  const offset = boardOffset(size);
  const replay = replayMovesWithPrisoners(size, [...position.moves]);
  const lastMove = position.moves.at(-1);
  const consecutivePasses = lastMove?.isPass
    ? position.moves.at(-2)?.isPass ? 2 : 1
    : 0;
  const strength = botStrengthForRating(position.targetRating);
  const boardArea = size * size;
  const set = (plane: number, x: number, y: number, value: number) => {
    const padded = (y + offset) * GOSTONE_BOT_MODEL.maximumBoardSize + x + offset;
    features[plane * area + padded] = value;
  };
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const stone = position.board[y][x];
      set(0, x, y, stone === "black" ? 1 : 0);
      set(1, x, y, stone === "white" ? 1 : 0);
      set(2, x, y, position.toMove === "black" ? 1 : 0);
      set(3, x, y, position.toMove === "white" ? 1 : 0);
      set(4, x, y, 1);
      set(5, x, y, Math.max(-1, Math.min(1, position.komi / 20)));
      set(6, x, y, Math.min(1, position.moves.length / boardArea));
      set(7, x, y, strength);
      set(8, x, y, Math.min(1, replay.prisoners.capturedWhiteByBlack / boardArea));
      set(9, x, y, Math.min(1, replay.prisoners.capturedBlackByWhite / boardArea));
      set(10, x, y, Math.min(1, consecutivePasses / 2));
    }
  }
  if (lastMove && !lastMove.isPass && lastMove.x !== null && lastMove.y !== null) {
    set(11, lastMove.x, lastMove.y, 1);
  }
  return features;
}

export function buildV8Features(position: GoStoneBotPosition): Float32Array {
  const size = position.boardSize;
  const area = GOSTONE_BOT_MODEL.maximumBoardSize ** 2;
  const features = new Float32Array(GOSTONE_BOT_MODEL.inputPlanes * area);
  const offset = boardOffset(size);
  const replay = replayMovesWithPrisoners(size, [...position.moves]);
  const lastMove = position.moves.at(-1);
  const consecutivePasses = lastMove?.isPass
    ? position.moves.at(-2)?.isPass ? 2 : 1
    : 0;
  const strength = botStrengthForRating(position.targetRating);
  const boardArea = size * size;
  const history = [previousBoard(position, 1), previousBoard(position, 2)] as const;
  const koPoint = simpleKoPoint(position, history[0]);

  const set = (plane: number, x: number, y: number, value: number) => {
    const padded = (y + offset) * GOSTONE_BOT_MODEL.maximumBoardSize + x + offset;
    features[plane * area + padded] = value;
  };

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const stone = position.board[y][x];
      set(0, x, y, stone === "black" ? 1 : 0);
      set(1, x, y, stone === "white" ? 1 : 0);
      set(2, x, y, position.toMove === "black" ? 1 : 0);
      set(3, x, y, position.toMove === "white" ? 1 : 0);
      set(4, x, y, 1);
      set(5, x, y, Math.max(-1, Math.min(1, position.komi / 20)));
      set(6, x, y, Math.min(1, position.moves.length / boardArea));
      set(7, x, y, strength);
      set(8, x, y, Math.min(1, replay.prisoners.capturedWhiteByBlack / boardArea));
      set(9, x, y, Math.min(1, replay.prisoners.capturedBlackByWhite / boardArea));
      set(10, x, y, Math.min(1, consecutivePasses / 2));
    }
  }
  if (lastMove && !lastMove.isPass && lastMove.x !== null && lastMove.y !== null) {
    set(11, lastMove.x, lastMove.y, 1);
  }
  if (koPoint) set(12, koPoint.x, koPoint.y, 1);

  const visited = new Set<string>();
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const color = position.board[y][x];
      const key = `${x}:${y}`;
      if (!color || visited.has(key)) continue;
      const group = getGroup(position.board, { x, y });
      group.forEach((stone) => visited.add(`${stone.x}:${stone.y}`));
      const libertyCount = countLiberties(position.board, group);
      const libertyBucket = libertyCount === 1 ? 0 : libertyCount === 2 ? 1 : 2;
      const colorOffset = color === "black" ? 0 : 1;
      group.forEach((stone) => set(13 + libertyBucket * 2 + colorOffset, stone.x, stone.y, 1));
    }
  }

  history.forEach((board, historyIndex) => {
    if (!board) return;
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const stone: Stone | null = board[y][x];
        set(19 + historyIndex * 2, x, y, stone === "black" ? 1 : 0);
        set(20 + historyIndex * 2, x, y, stone === "white" ? 1 : 0);
      }
    }
  });

  return features;
}
