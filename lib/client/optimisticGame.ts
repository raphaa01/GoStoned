import { applyMove } from "@/lib/game/goEngine";
import type { Board, Position, Stone } from "@/lib/game/types";

export type PendingMovePreview = Position & { color: Stone };

export type OptimisticBoardPreview = {
  board: Board;
  applied: boolean;
};

export function previewPendingMove(
  board: Board,
  pendingMove: PendingMovePreview | null,
): OptimisticBoardPreview {
  if (!pendingMove) return { board, applied: false };

  const result = applyMove(
    board,
    pendingMove.color,
    pendingMove.x,
    pendingMove.y,
  );
  return result.ok
    ? { board: result.board, applied: true }
    : { board, applied: false };
}
