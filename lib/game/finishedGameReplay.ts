import { replayMoves } from "./goEngine";
import type { BoardSize, StoredMove } from "./types";

export type FinishedGameMove = Omit<StoredMove, "createdAt">;

export function finishedGamePosition(size: BoardSize, moves: readonly FinishedGameMove[], index: number) {
  const moveIndex = Math.max(0, Math.min(moves.length, Math.trunc(index)));
  const selected = moves.slice(0, moveIndex).map(move => ({ ...move, createdAt: "" }));
  const move = selected.at(-1);
  return {
    moveIndex,
    board: replayMoves(size, selected),
    lastMove: move && !move.isPass && move.x !== null && move.y !== null
      ? { x: move.x, y: move.y } : null,
  };
}
