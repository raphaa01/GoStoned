import type { GoStoneBotMove } from "@/lib/bot/modelV1";
import {
  applyMove,
  boardHash,
  createEmptyBoard,
  type PrisonerLedger,
} from "@/lib/game/goEngine";
import {
  JapaneseNormalPlayReplayError,
  replayJapaneseNormalPlayBoardLegality,
  type JapanesePersistedMove,
} from "@/lib/game/japaneseKo";
import type { Board, BoardSize, Stone } from "@/lib/game/types";

export const TRAINING_KYU_MIN = 1;
export const TRAINING_KYU_MAX = 28;

export type TrainingPosition = Readonly<{
  boardSize: BoardSize;
  board: Board;
  moves: readonly JapanesePersistedMove[];
  prisoners: PrisonerLedger;
  turn: Stone;
  consecutivePasses: number;
}>;

export type TrainingActionResult =
  | Readonly<{ ok: true; position: TrainingPosition }>
  | Readonly<{
      ok: false;
      error: "ko" | "occupied" | "out_of_bounds" | "suicide" | "invalid_move";
    }>;

function opposite(color: Stone): Stone {
  return color === "black" ? "white" : "black";
}

function mutableBoard(board: readonly (readonly (Stone | null)[])[]): Board {
  return board.map((row) => [...row]);
}

export function kyuToBotRating(kyu: number): number {
  if (!Number.isInteger(kyu) || kyu < TRAINING_KYU_MIN || kyu > TRAINING_KYU_MAX) {
    throw new RangeError(`Training rank must be ${TRAINING_KYU_MIN} through ${TRAINING_KYU_MAX} kyu.`);
  }
  const continuous = 600
    + ((TRAINING_KYU_MAX - kyu) / (TRAINING_KYU_MAX - TRAINING_KYU_MIN)) * 1_500;
  return Math.round(continuous / 50) * 50;
}

export function createTrainingPosition(boardSize: BoardSize): TrainingPosition {
  return Object.freeze({
    boardSize,
    board: createEmptyBoard(boardSize),
    moves: Object.freeze([]),
    prisoners: Object.freeze({
      capturedWhiteByBlack: 0,
      capturedBlackByWhite: 0,
    }),
    turn: "black",
    consecutivePasses: 0,
  });
}

export function applyTrainingAction(
  position: TrainingPosition,
  action: GoStoneBotMove,
  createdAt = new Date().toISOString(),
): TrainingActionResult {
  const moveNumber = position.moves.length + 1;
  let move: JapanesePersistedMove;

  if (action.kind === "pass") {
    move = {
      moveNumber,
      color: position.turn,
      x: null,
      y: null,
      isPass: true,
      createdAt,
      boardHash: boardHash(position.board),
    };
  } else {
    const applied = applyMove(position.board, position.turn, action.x, action.y);
    if (!applied.ok) return { ok: false, error: applied.error };
    move = {
      moveNumber,
      color: position.turn,
      x: action.x,
      y: action.y,
      isPass: false,
      createdAt,
      boardHash: boardHash(applied.board),
    };
  }

  const moves = Object.freeze([...position.moves, Object.freeze(move)]);
  try {
    const replayed = replayJapaneseNormalPlayBoardLegality(position.boardSize, moves);
    return {
      ok: true,
      position: Object.freeze({
        boardSize: position.boardSize,
        board: mutableBoard(replayed.board),
        moves,
        prisoners: replayed.prisoners,
        turn: opposite(position.turn),
        consecutivePasses: action.kind === "pass" ? position.consecutivePasses + 1 : 0,
      }),
    };
  } catch (error) {
    if (
      error instanceof JapaneseNormalPlayReplayError
      && error.code === "illegal_move"
      && /\(ko\)/.test(error.message)
    ) {
      return { ok: false, error: "ko" };
    }
    return { ok: false, error: "invalid_move" };
  }
}
