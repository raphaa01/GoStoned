import { applyMove } from "@/lib/game/goEngine";
import type { Board, GameState, Position, Stone } from "@/lib/game/types";

export type PendingMovePreview = Position & { color: Stone };
export type PendingGameMovePreview = PendingMovePreview & {
  gameId: string;
  baseVersion: number;
};

export function previewPendingGameMove(
  game: Pick<GameState, "id" | "version" | "status" | "phase" | "turn" | "board">,
  pendingMove: PendingGameMovePreview | null,
): OptimisticBoardPreview {
  if (!pendingMove || pendingMove.gameId !== game.id
    || pendingMove.baseVersion !== game.version
    || game.status !== "active" || game.phase !== "play"
    || pendingMove.color !== game.turn) {
    return { board: game.board, applied: false };
  }
  return previewPendingMove(game.board, pendingMove);
}

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
