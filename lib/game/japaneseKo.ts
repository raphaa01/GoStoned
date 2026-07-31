import {
  applyMove,
  boardHash,
  countLiberties,
  createEmptyBoard,
  getGroup,
  getNeighbors,
  type PrisonerLedger,
} from "./goEngine";
import type {
  Board,
  BoardSize,
  Intersection,
  MoveError,
  Position,
  Stone,
  StoredMove,
} from "./types";
import {
  JAPANESE_1989_CONTRACT_ID,
  JAPANESE_1989_RULES_PROFILE,
} from "./japanesePolicyContract";

/**
 * A normal-play Article 6 ko restriction. This deliberately does not model
 * the distinct, per-ko pass procedure used for life-and-death confirmation
 * after play has stopped under Article 7.2.
 */
export type JapaneseSimpleKoRestriction = Readonly<{
  prohibitedPlayer: Stone;
  recapturePoint: Readonly<Position>;
  capturingStone: Readonly<Position>;
  createdByMoveNumber: number;
  boardBeforeCaptureHash: string;
}>;

type JapaneseSimpleKoMoveError =
  | MoveError
  | "invalid_coordinate"
  | "invalid_color"
  | "invalid_move_number"
  | "ko";

export type JapanesePersistedMove = StoredMove & Readonly<{
  boardHash: string;
}>;

export type JapaneseReadonlyBoard = readonly (readonly Intersection[])[];

export type JapaneseNormalPlayReplayErrorCode =
  | "invalid_board_size"
  | "invalid_move_sequence"
  | "invalid_color"
  | "invalid_pass_flag"
  | "invalid_pass_coordinates"
  | "missing_coordinates"
  | "invalid_coordinates"
  | "missing_board_hash"
  | "board_hash_mismatch"
  | "illegal_move";

export class JapaneseNormalPlayReplayError extends Error {
  constructor(
    public readonly code: JapaneseNormalPlayReplayErrorCode,
    public readonly moveNumber: number | null,
    message: string,
  ) {
    super(message);
    this.name = "JapaneseNormalPlayReplayError";
  }
}

type JapaneseSimpleKoMoveResult =
  | Readonly<{
      ok: true;
      board: Board;
      boardHash: string;
      captured: readonly Position[];
      koRestrictions: readonly JapaneseSimpleKoRestriction[];
    }>
  | Readonly<{
      ok: false;
      board: Board;
      error: JapaneseSimpleKoMoveError;
      koRestrictions: readonly JapaneseSimpleKoRestriction[];
    }>;

export type JapaneseNormalPlayReplayResult = Readonly<{
  contractId: typeof JAPANESE_1989_CONTRACT_ID;
  rulesProfile: typeof JAPANESE_1989_RULES_PROFILE;
  scope: "normal-play-board-legality";
  board: JapaneseReadonlyBoard;
  prisoners: PrisonerLedger;
  positionHistory: readonly string[];
  koRestrictions: readonly JapaneseSimpleKoRestriction[];
}>;

function opposite(color: Stone): Stone {
  return color === "black" ? "white" : "black";
}

function samePosition(left: Position, right: Position): boolean {
  return left.x === right.x && left.y === right.y;
}

function freezePosition(position: Position): Readonly<Position> {
  return Object.freeze({ x: position.x, y: position.y });
}

function freezeRestrictions(
  restrictions: readonly JapaneseSimpleKoRestriction[],
): readonly JapaneseSimpleKoRestriction[] {
  return Object.freeze(restrictions.map((restriction) => Object.freeze({
    prohibitedPlayer: restriction.prohibitedPlayer,
    recapturePoint: freezePosition(restriction.recapturePoint),
    capturingStone: freezePosition(restriction.capturingStone),
    createdByMoveNumber: restriction.createdByMoveNumber,
    boardBeforeCaptureHash: restriction.boardBeforeCaptureHash,
  })));
}

function freezeBoard(board: Board): JapaneseReadonlyBoard {
  for (const row of board) Object.freeze(row);
  return Object.freeze(board);
}

type LocalSimpleKo = Readonly<{
  prohibitedPlayer: Stone;
  recapturePoint: Readonly<Position>;
  capturingStone: Readonly<Position>;
}>;

function deriveLocalSimpleKo(
  board: Board,
  color: Stone,
  move: Position,
  captured: readonly Position[],
): LocalSimpleKo | null {
  if (captured.length !== 1) return null;

  const group = getGroup(board, move);
  if (group.length !== 1 || countLiberties(board, group) !== 1) return null;

  const capturedStone = captured[0];
  if (!samePosition(getOnlyLiberty(board, group[0]), capturedStone)) return null;

  return Object.freeze({
    prohibitedPlayer: opposite(color),
    recapturePoint: freezePosition(capturedStone),
    capturingStone: freezePosition(move),
  });
}

function deriveVerifiedSimpleKoRestriction(
  previousBoard: Board,
  board: Board,
  color: Stone,
  move: Position,
  captured: readonly Position[],
  moveNumber: number,
): JapaneseSimpleKoRestriction | null {
  const localKo = deriveLocalSimpleKo(board, color, move, captured);
  if (!localKo) return null;

  const recapture = applyMove(
    board,
    localKo.prohibitedPlayer,
    localKo.recapturePoint.x,
    localKo.recapturePoint.y,
  );
  if (!recapture.ok || boardHash(recapture.board) !== boardHash(previousBoard)) return null;
  return Object.freeze({
    ...localKo,
    createdByMoveNumber: moveNumber,
    boardBeforeCaptureHash: boardHash(previousBoard),
  });
}

function getOnlyLiberty(board: Board, stone: Position): Position {
  return getNeighbors(board, stone).find(
    (position) => board[position.y][position.x] === null,
  ) ?? { x: -1, y: -1 };
}

function restrictionStillDescribesKo(
  board: Board,
  restriction: JapaneseSimpleKoRestriction,
): boolean {
  const attempt = applyMove(
    board,
    restriction.prohibitedPlayer,
    restriction.recapturePoint.x,
    restriction.recapturePoint.y,
  );
  if (!attempt.ok) return false;

  const reverse = deriveLocalSimpleKo(
    attempt.board,
    restriction.prohibitedPlayer,
    restriction.recapturePoint,
    attempt.captured,
  );
  return reverse !== null
    && samePosition(reverse.recapturePoint, restriction.capturingStone)
    && samePosition(reverse.capturingStone, restriction.recapturePoint);
}

function normalizeRestrictions(
  board: Board,
  restrictions: readonly JapaneseSimpleKoRestriction[],
): readonly JapaneseSimpleKoRestriction[] {
  return restrictions.filter((restriction) => restrictionStillDescribesKo(board, restriction));
}

/**
 * Applies one stone placement under the Japanese 1989 Article 6 simple-ko
 * rule. A pass is intentionally absent from this API: normal-play passes do
 * not count as a placement elsewhere and therefore preserve the current ko
 * restrictions. The replay primitive below applies that rule to persisted
 * passes.
 */
function applyJapaneseSimpleKoMove(
  currentBoard: Board,
  color: Stone,
  x: number,
  y: number,
  currentRestrictions: readonly JapaneseSimpleKoRestriction[],
  moveNumber: number,
): JapaneseSimpleKoMoveResult {
  if (color !== "black" && color !== "white") {
    return {
      ok: false,
      board: currentBoard,
      error: "invalid_color",
      koRestrictions: currentRestrictions,
    };
  }
  if (!Number.isSafeInteger(moveNumber) || moveNumber < 1) {
    return {
      ok: false,
      board: currentBoard,
      error: "invalid_move_number",
      koRestrictions: currentRestrictions,
    };
  }
  if (!Number.isInteger(x) || !Number.isInteger(y)) {
    return {
      ok: false,
      board: currentBoard,
      error: "invalid_coordinate",
      koRestrictions: currentRestrictions,
    };
  }

  const restrictions = normalizeRestrictions(currentBoard, currentRestrictions);
  const result = applyMove(currentBoard, color, x, y);
  if (!result.ok) {
    return {
      ok: false,
      board: currentBoard,
      error: result.error,
      koRestrictions: currentRestrictions,
    };
  }

  if (restrictions.some((restriction) => (
    restriction.prohibitedPlayer === color
    && restriction.recapturePoint.x === x
    && restriction.recapturePoint.y === y
  ))) {
    return {
      ok: false,
      board: currentBoard,
      error: "ko",
      koRestrictions: currentRestrictions,
    };
  }

  const nextRestrictions = [...normalizeRestrictions(
    result.board,
    restrictions.filter((restriction) => restriction.prohibitedPlayer !== color),
  )];
  const createdRestriction = deriveVerifiedSimpleKoRestriction(
    currentBoard,
    result.board,
    color,
    { x, y },
    result.captured,
    moveNumber,
  );
  if (createdRestriction) nextRestrictions.push(createdRestriction);

  return {
    ok: true,
    board: result.board,
    boardHash: boardHash(result.board),
    captured: Object.freeze(result.captured.map(freezePosition)),
    koRestrictions: freezeRestrictions(nextRestrictions),
  };
}

/**
 * Reconstructs a persisted normal-play record and rejects any Article 6 ko
 * recapture that should never have been stored. Global repetition is retained
 * in positionHistory for later no-result adjudication; it is not rejected as
 * positional superko. This is intentionally a board-legality audit, not a
 * complete game audit: turn and scoring-resume authorization require an
 * immutable phase-event stream before the dormant Japanese profile can be
 * activated. Every persisted board hash is nevertheless recomputed here and
 * must match, including the unchanged hash recorded for a pass.
 */
export function replayJapaneseNormalPlayBoardLegality(
  size: BoardSize,
  moves: readonly JapanesePersistedMove[],
): JapaneseNormalPlayReplayResult {
  if (size !== 9 && size !== 13 && size !== 19) {
    throw new JapaneseNormalPlayReplayError(
      "invalid_board_size",
      null,
      "Japanese normal-play replay requires a supported board size.",
    );
  }
  let board = createEmptyBoard(size);
  let restrictions: readonly JapaneseSimpleKoRestriction[] = Object.freeze([]);
  let expectedMoveNumber = 1;
  let capturedWhiteByBlack = 0;
  let capturedBlackByWhite = 0;
  const positionHistory = [boardHash(board)];

  for (const move of moves) {
    if (move.moveNumber !== expectedMoveNumber) {
      throw new JapaneseNormalPlayReplayError(
        "invalid_move_sequence",
        move.moveNumber,
        `Stored move sequence expected ${expectedMoveNumber}, received ${move.moveNumber}.`,
      );
    }
    if (move.color !== "black" && move.color !== "white") {
      throw new JapaneseNormalPlayReplayError(
        "invalid_color",
        move.moveNumber,
        `Stored move ${move.moveNumber} has an invalid color.`,
      );
    }
    if (typeof move.isPass !== "boolean") {
      throw new JapaneseNormalPlayReplayError(
        "invalid_pass_flag",
        move.moveNumber,
        `Stored move ${move.moveNumber} has a non-boolean pass flag.`,
      );
    }

    if (move.isPass) {
      if (move.x !== null || move.y !== null) {
        throw new JapaneseNormalPlayReplayError(
          "invalid_pass_coordinates",
          move.moveNumber,
          `Stored pass ${move.moveNumber} has coordinates.`,
        );
      }
    } else {
      if (move.x === null || move.y === null) {
        throw new JapaneseNormalPlayReplayError(
          "missing_coordinates",
          move.moveNumber,
          `Stored move ${move.moveNumber} has no coordinates.`,
        );
      }
      if (!Number.isInteger(move.x) || !Number.isInteger(move.y)) {
        throw new JapaneseNormalPlayReplayError(
          "invalid_coordinates",
          move.moveNumber,
          `Stored move ${move.moveNumber} has non-integer coordinates.`,
        );
      }

      const result = applyJapaneseSimpleKoMove(
        board,
        move.color,
        move.x,
        move.y,
        restrictions,
        move.moveNumber,
      );
      if (!result.ok) {
        throw new JapaneseNormalPlayReplayError(
          "illegal_move",
          move.moveNumber,
          `Stored move ${move.moveNumber} is invalid (${result.error}).`,
        );
      }
      board = result.board;
      restrictions = result.koRestrictions;
      if (move.color === "black") capturedWhiteByBlack += result.captured.length;
      else capturedBlackByWhite += result.captured.length;
    }

    const computedHash = boardHash(board);
    if (typeof move.boardHash !== "string" || move.boardHash.length === 0) {
      throw new JapaneseNormalPlayReplayError(
        "missing_board_hash",
        move.moveNumber,
        `Stored move ${move.moveNumber} has no board hash.`,
      );
    }
    if (move.boardHash !== computedHash) {
      throw new JapaneseNormalPlayReplayError(
        "board_hash_mismatch",
        move.moveNumber,
        `Stored move ${move.moveNumber} board hash does not match replay.`,
      );
    }
    positionHistory.push(computedHash);
    expectedMoveNumber += 1;
  }

  return Object.freeze({
    contractId: JAPANESE_1989_CONTRACT_ID,
    rulesProfile: JAPANESE_1989_RULES_PROFILE,
    scope: "normal-play-board-legality",
    board: freezeBoard(board),
    prisoners: Object.freeze({
      capturedWhiteByBlack,
      capturedBlackByWhite,
    }),
    positionHistory: Object.freeze(positionHistory),
    koRestrictions: restrictions,
  });
}
