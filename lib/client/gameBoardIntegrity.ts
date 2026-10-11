import { applyMove, boardHash, replayMoves } from "@/lib/game/goEngine";
import type { GameState, StoredMove } from "@/lib/game/types";

type GameBoardSnapshot = Pick<GameState, "boardSize" | "moveCount" | "moves" | "board">;

function sameMove(left: StoredMove, right: StoredMove): boolean {
  return left.moveNumber === right.moveNumber && left.color === right.color
    && left.x === right.x && left.y === right.y && left.isPass === right.isPass;
}

/** Check full responses locally; heartbeats and immediate move previews skip this. */
export function gameBoardMatchesHistory(current: GameBoardSnapshot | null, next: GameBoardSnapshot): boolean {
  if (next.moveCount !== next.moves.length || next.board.length !== next.boardSize
    || next.board.some(row => row.length !== next.boardSize
      || row.some(stone => stone !== null && stone !== "black" && stone !== "white"))) return false;
  try {
    const extendsCurrent = current && current.boardSize === next.boardSize
      && next.moves.length >= current.moves.length
      && current.moves.every((move, index) => sameMove(move, next.moves[index]));
    // Usually only one new move needs checking. Reconstruct on initial load,
    // takeback or a changed history, never on each clock heartbeat.
    let expectedBoard = extendsCurrent ? current.board : replayMoves(next.boardSize, next.moves);
    if (extendsCurrent) {
      for (let index = current.moves.length; index < next.moves.length; index++) {
        const move = next.moves[index];
        if (move.moveNumber !== index + 1 || (move.color !== "black" && move.color !== "white")
          || typeof move.isPass !== "boolean") return false;
        if (move.isPass) {
          if (move.x !== null || move.y !== null) return false;
        } else {
          if (!Number.isInteger(move.x) || !Number.isInteger(move.y)) return false;
          const applied = applyMove(expectedBoard, move.color, move.x!, move.y!);
          if (!applied.ok) return false;
          expectedBoard = applied.board;
        }
      }
    }
    return boardHash(expectedBoard) === boardHash(next.board);
  } catch {
    return false;
  }
}
