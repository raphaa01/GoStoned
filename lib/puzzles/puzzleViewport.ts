import type { Board } from "@/lib/game/types";

export function localPuzzleViewportSize(board: Board): number {
  let furthestCoordinate = 0;
  for (let y = 0; y < board.length; y += 1) {
    for (let x = 0; x < board.length; x += 1) {
      if (board[y]?.[x]) furthestCoordinate = Math.max(furthestCoordinate, x, y);
    }
  }
  return Math.min(board.length, Math.max(7, furthestCoordinate + 2));
}
