import {
  replayJapaneseNormalPlayBoardLegality,
  type JapaneseNormalPlayReplayResult,
  type JapanesePersistedMove,
} from "./japaneseKo";
import {
  JAPANESE_1989_CONTRACT_ID,
  JAPANESE_1989_RULES_PROFILE,
} from "./japanesePolicyContract";
import type { BoardSize, Stone } from "./types";

const POSTGRES_INT_MAX = 2_147_483_647;
const RESUME_FIELDS = Object.freeze([
  "stoppedMoveNumber",
  "stoppedBoardHash",
  "requestedBy",
] as const);
const MOVE_FIELDS = Object.freeze([
  "moveNumber",
  "color",
  "x",
  "y",
  "isPass",
  "createdAt",
  "boardHash",
] as const);

export type JapaneseResumeAuthorization = Readonly<{
  stoppedMoveNumber: number;
  stoppedBoardHash: string;
  requestedBy: Stone;
}>;

export type JapanesePhaseAuthorityErrorCode =
  | "invalid_moves"
  | "invalid_move_record"
  | "invalid_resume_authorizations"
  | "invalid_resume_authorization"
  | "invalid_resume_sequence"
  | "invalid_turn"
  | "move_while_stopped"
  | "resume_without_stop"
  | "resume_board_hash_mismatch"
  | "unconsumed_resume_authorization";

export class JapanesePhaseAuthorityError extends Error {
  constructor(
    public readonly code: JapanesePhaseAuthorityErrorCode,
    public readonly moveNumber: number | null,
    public readonly authorizationIndex: number | null,
    message: string,
  ) {
    super(message);
    this.name = "JapanesePhaseAuthorityError";
  }
}

export type JapaneseStoppedPhase = Readonly<{
  phase: "stopped";
  toMove: null;
  consecutivePasses: 2;
  stoppedAt: Readonly<{
    moveNumber: number;
    boardHash: string;
  }>;
}>;

export type JapanesePlayingPhase = Readonly<{
  phase: "play";
  toMove: Stone;
  consecutivePasses: 0 | 1;
  stoppedAt: null;
}>;

export type JapanesePhaseAuthorityState = JapanesePlayingPhase | JapaneseStoppedPhase;

export type JapanesePhaseAuthorityResult = Readonly<{
  contractId: typeof JAPANESE_1989_CONTRACT_ID;
  rulesProfile: typeof JAPANESE_1989_RULES_PROFILE;
  scope: "normal-play-phase-authority";
  normalPlay: JapaneseNormalPlayReplayResult;
  resumeAuthorizations: readonly JapaneseResumeAuthorization[];
  state: JapanesePhaseAuthorityState;
}>;

function phaseError(
  code: JapanesePhaseAuthorityErrorCode,
  moveNumber: number | null,
  authorizationIndex: number | null,
  message: string,
): never {
  throw new JapanesePhaseAuthorityError(code, moveNumber, authorizationIndex, message);
}

function opposite(color: Stone): Stone {
  return color === "black" ? "white" : "black";
}

function snapshotMove(value: unknown, moveIndex: number): JapanesePersistedMove {
  try {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return phaseError(
        "invalid_move_record",
        null,
        null,
        "Japanese move evidence must be a plain record.",
      );
    }
    const prototype = Object.getPrototypeOf(value);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const descriptorKeys = Reflect.ownKeys(descriptors);
    if (
      (prototype !== Object.prototype && prototype !== null)
      || descriptorKeys.length !== MOVE_FIELDS.length
      || MOVE_FIELDS.some((field) => !descriptorKeys.includes(field))
    ) {
      return phaseError(
        "invalid_move_record",
        null,
        null,
        "Japanese move evidence must contain exactly its documented fields.",
      );
    }
    for (const field of MOVE_FIELDS) {
      const descriptor = descriptors[field];
      if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
        return phaseError(
          "invalid_move_record",
          null,
          null,
          "Japanese move evidence fields must be enumerable data properties.",
        );
      }
    }
    const moveNumber = descriptors.moveNumber.value;
    if (
      !Number.isSafeInteger(moveNumber)
      || moveNumber < 1
      || moveNumber > POSTGRES_INT_MAX
    ) {
      return phaseError(
        "invalid_move_record",
        null,
        null,
        "Japanese move evidence has an invalid move number.",
      );
    }
    return Object.freeze({
      moveNumber,
      color: descriptors.color.value,
      x: descriptors.x.value,
      y: descriptors.y.value,
      isPass: descriptors.isPass.value,
      createdAt: descriptors.createdAt.value,
      boardHash: descriptors.boardHash.value,
    });
  } catch (error) {
    if (error instanceof JapanesePhaseAuthorityError) throw error;
    return phaseError(
      "invalid_move_record",
      Number.isSafeInteger(moveIndex + 1) ? moveIndex + 1 : null,
      null,
      "Japanese move evidence could not be inspected safely.",
    );
  }
}

function snapshotMoves(value: unknown): readonly JapanesePersistedMove[] {
  try {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
      return phaseError(
        "invalid_moves",
        null,
        null,
        "Japanese move evidence must be a plain array.",
      );
    }
    const descriptors = Object.getOwnPropertyDescriptors(value) as unknown as Record<
      PropertyKey,
      PropertyDescriptor
    >;
    const lengthDescriptor = descriptors.length;
    if (
      !lengthDescriptor
      || !("value" in lengthDescriptor)
      || !Number.isSafeInteger(lengthDescriptor.value)
      || lengthDescriptor.value < 0
      || lengthDescriptor.value > POSTGRES_INT_MAX
    ) {
      return phaseError(
        "invalid_moves",
        null,
        null,
        "Japanese move evidence has an invalid array length.",
      );
    }
    const length = lengthDescriptor.value as number;
    const descriptorKeys = Reflect.ownKeys(descriptors);
    if (
      descriptorKeys.some((key) => {
        if (key === "length") return false;
        if (typeof key !== "string" || !/^(?:0|[1-9]\d*)$/.test(key)) return true;
        return Number(key) >= length;
      })
    ) {
      return phaseError(
        "invalid_moves",
        null,
        null,
        "Japanese move evidence must contain only dense own array slots.",
      );
    }
    const moves: JapanesePersistedMove[] = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
        return phaseError(
          "invalid_moves",
          null,
          null,
          "Japanese move evidence must contain only dense own array slots.",
        );
      }
      moves.push(snapshotMove(descriptor.value, index));
    }
    return Object.freeze(moves);
  } catch (error) {
    if (error instanceof JapanesePhaseAuthorityError) throw error;
    return phaseError(
      "invalid_moves",
      null,
      null,
      "Japanese move evidence could not be inspected safely.",
    );
  }
}

function snapshotResumeAuthorization(
  value: unknown,
  authorizationIndex: number,
): JapaneseResumeAuthorization {
  try {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return phaseError(
        "invalid_resume_authorization",
        null,
        authorizationIndex,
        "A Japanese resume authorization must be a plain record.",
      );
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      return phaseError(
        "invalid_resume_authorization",
        null,
        authorizationIndex,
        "A Japanese resume authorization must be a plain record.",
      );
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const ownKeys = Reflect.ownKeys(descriptors);
    if (
      ownKeys.length !== RESUME_FIELDS.length
      || RESUME_FIELDS.some((field) => !ownKeys.includes(field))
    ) {
      return phaseError(
        "invalid_resume_authorization",
        null,
        authorizationIndex,
        "A Japanese resume authorization must contain exactly its documented fields.",
      );
    }
    for (const field of RESUME_FIELDS) {
      const descriptor = descriptors[field];
      if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
        return phaseError(
          "invalid_resume_authorization",
          null,
          authorizationIndex,
          "Japanese resume authorization fields must be enumerable data properties.",
        );
      }
    }

    const stoppedMoveNumber = descriptors.stoppedMoveNumber.value;
    const stoppedBoardHash = descriptors.stoppedBoardHash.value;
    const requestedBy = descriptors.requestedBy.value;
    if (
      !Number.isSafeInteger(stoppedMoveNumber)
      || stoppedMoveNumber < 2
      || stoppedMoveNumber > POSTGRES_INT_MAX
      || typeof stoppedBoardHash !== "string"
      || stoppedBoardHash.length === 0
      || (requestedBy !== "black" && requestedBy !== "white")
    ) {
      return phaseError(
        "invalid_resume_authorization",
        Number.isSafeInteger(stoppedMoveNumber)
          && stoppedMoveNumber >= 2
          && stoppedMoveNumber <= POSTGRES_INT_MAX
          ? stoppedMoveNumber
          : null,
        authorizationIndex,
        "A Japanese resume authorization contains invalid evidence.",
      );
    }
    return Object.freeze({ stoppedMoveNumber, stoppedBoardHash, requestedBy });
  } catch (error) {
    if (error instanceof JapanesePhaseAuthorityError) throw error;
    return phaseError(
      "invalid_resume_authorization",
      null,
      authorizationIndex,
      "A Japanese resume authorization could not be inspected safely.",
    );
  }
}

function snapshotResumeAuthorizations(
  value: unknown,
  moveCount: number,
): readonly JapaneseResumeAuthorization[] {
  try {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
      return phaseError(
        "invalid_resume_authorizations",
        null,
        null,
        "Japanese resume authorizations must be an array.",
      );
    }
    const descriptors = Object.getOwnPropertyDescriptors(value) as unknown as Record<
      PropertyKey,
      PropertyDescriptor
    >;
    const lengthDescriptor = descriptors.length;
    if (
      !lengthDescriptor
      || !("value" in lengthDescriptor)
      || !Number.isSafeInteger(lengthDescriptor.value)
      || lengthDescriptor.value < 0
      || lengthDescriptor.value > Math.floor(moveCount / 2)
    ) {
      return phaseError(
        "invalid_resume_authorizations",
        null,
        null,
        "Japanese resume authorizations exceed the possible number of stopped phases.",
      );
    }
    const length = lengthDescriptor.value as number;
    const ownKeys = Reflect.ownKeys(descriptors);
    if (ownKeys.some((key) => {
      if (key === "length") return false;
      if (typeof key !== "string" || !/^(?:0|[1-9]\d*)$/.test(key)) return true;
      return Number(key) >= length;
    })) {
      return phaseError(
        "invalid_resume_authorizations",
        null,
        null,
        "Japanese resume authorizations must contain only dense own array slots.",
      );
    }

    const authorizations: JapaneseResumeAuthorization[] = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
        return phaseError(
          "invalid_resume_authorizations",
          null,
          index,
          "Japanese resume authorizations must contain only dense own array slots.",
        );
      }
      authorizations.push(snapshotResumeAuthorization(descriptor.value, index));
    }
    for (let index = 1; index < authorizations.length; index += 1) {
      if (authorizations[index].stoppedMoveNumber <= authorizations[index - 1].stoppedMoveNumber) {
        return phaseError(
          "invalid_resume_sequence",
          authorizations[index].stoppedMoveNumber,
          index,
          "Japanese resume authorizations must reference unique stopped phases in order.",
        );
      }
    }
    return Object.freeze(authorizations);
  } catch (error) {
    if (error instanceof JapanesePhaseAuthorityError) throw error;
    return phaseError(
      "invalid_resume_authorizations",
      null,
      null,
      "Japanese resume authorizations could not be inspected safely.",
    );
  }
}

function freezePlayingState(
  toMove: Stone,
  consecutivePasses: 0 | 1,
): JapanesePlayingPhase {
  return Object.freeze({
    phase: "play",
    toMove,
    consecutivePasses,
    stoppedAt: null,
  });
}

function freezeStoppedState(moveNumber: number, boardHash: string): JapaneseStoppedPhase {
  return Object.freeze({
    phase: "stopped",
    toMove: null,
    consecutivePasses: 2,
    stoppedAt: Object.freeze({ moveNumber, boardHash }),
  });
}

/**
 * Adds turn and pass-pass/resume authority to the dormant Japanese normal-play
 * replay. A resume authorization is immutable evidence for one exact stopped
 * board; its requester's opponent receives the first move after resumption.
 * Settlement proposals and results deliberately remain outside this boundary.
 */
export function replayJapanesePhaseAuthority(
  size: BoardSize,
  moves: readonly JapanesePersistedMove[],
  resumeAuthorizations: readonly JapaneseResumeAuthorization[],
): JapanesePhaseAuthorityResult {
  const moveSnapshot = snapshotMoves(moves);
  const authorizations = snapshotResumeAuthorizations(
    resumeAuthorizations,
    moveSnapshot.length,
  );
  const normalPlay = replayJapaneseNormalPlayBoardLegality(size, moveSnapshot);
  let state: JapanesePhaseAuthorityState = freezePlayingState("black", 0);
  let authorizationIndex = 0;

  for (const move of moveSnapshot) {
    if (state.phase === "stopped") {
      return phaseError(
        "move_while_stopped",
        move.moveNumber,
        authorizationIndex < authorizations.length ? authorizationIndex : null,
        "A Japanese normal-play move requires explicit resume authorization after pass-pass.",
      );
    }
    if (move.color !== state.toMove) {
      return phaseError(
        "invalid_turn",
        move.moveNumber,
        null,
        `Stored move ${move.moveNumber} is not by the authorized player.`,
      );
    }

    const consecutivePasses = move.isPass ? state.consecutivePasses + 1 : 0;
    const nextAuthorization = authorizations[authorizationIndex];
    if (consecutivePasses === 2) {
      const boardHash = normalPlay.positionHistory[move.moveNumber];
      state = freezeStoppedState(move.moveNumber, boardHash);
      if (nextAuthorization?.stoppedMoveNumber === move.moveNumber) {
        if (nextAuthorization.stoppedBoardHash !== boardHash) {
          return phaseError(
            "resume_board_hash_mismatch",
            move.moveNumber,
            authorizationIndex,
            "Japanese resume authorization does not match the stopped board.",
          );
        }
        state = freezePlayingState(opposite(nextAuthorization.requestedBy), 0);
        authorizationIndex += 1;
      }
      continue;
    }

    if (nextAuthorization?.stoppedMoveNumber === move.moveNumber) {
      return phaseError(
        "resume_without_stop",
        move.moveNumber,
        authorizationIndex,
        "Japanese resume authorization must reference a pass-pass stopped phase.",
      );
    }
    state = freezePlayingState(
      opposite(move.color),
      consecutivePasses as 0 | 1,
    );
  }

  if (authorizationIndex !== authorizations.length) {
    const authorization = authorizations[authorizationIndex];
    return phaseError(
      "unconsumed_resume_authorization",
      authorization.stoppedMoveNumber,
      authorizationIndex,
      "Japanese resume authorization does not correspond to a consumed stopped phase.",
    );
  }

  return Object.freeze({
    contractId: JAPANESE_1989_CONTRACT_ID,
    rulesProfile: JAPANESE_1989_RULES_PROFILE,
    scope: "normal-play-phase-authority",
    normalPlay,
    resumeAuthorizations: authorizations,
    state,
  });
}
