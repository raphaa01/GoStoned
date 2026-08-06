import type { Stone } from "./types";

export type JapaneseRepetitionMove = Readonly<{
  moveNumber: number;
  color: Stone;
  isPass: boolean;
  boardHash: string;
}>;

export type JapaneseRepetitionEvidence = Readonly<{
  moveNumber: number;
  repeatedFromMoveNumber: number;
  boardHash: string;
}>;

/**
 * Japanese 1989 Article 12 does not turn long cycles into an illegal move.
 * It permits the move under simple-ko, then lets both players agree that the
 * resulting whole-board position repeated. Passes are excluded because they
 * intentionally preserve the board and begin the separate scoring lifecycle.
 */
export function currentJapaneseWholeBoardRepetition(
  moves: readonly JapaneseRepetitionMove[],
): JapaneseRepetitionEvidence | null {
  const current = moves.at(-1);
  if (!current || current.isPass || !/^[BW.]+(?:\/[BW.]+)*$/.test(current.boardHash)) {
    return null;
  }
  for (let index = moves.length - 2; index >= 0; index -= 1) {
    const prior = moves[index];
    if (prior.boardHash === current.boardHash) {
      return Object.freeze({
        moveNumber: current.moveNumber,
        repeatedFromMoveNumber: prior.moveNumber,
        boardHash: current.boardHash,
      });
    }
  }
  return null;
}
