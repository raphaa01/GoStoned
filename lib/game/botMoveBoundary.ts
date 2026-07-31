import { createHash } from "node:crypto";
import { boardHash } from "./goEngine";
import type { Board, BoardSize, Stone } from "./types";
import {
  botConfigurationKey,
  botExecutionMatchesBinding,
  type BotExecutionIdentity,
  type BotGameConfiguration,
  type BotOpponentBinding,
  type CalibratedBotProfile,
} from "../matchmaking/calibratedBotPolicy";

export const BOT_MOVE_CONTRACT_VERSION = "provider-neutral-bot-move-v1" as const;
export const BOT_MOVE_RETRY_POLICY_VERSION = "bot-move-deadline-retry-v1" as const;

export type BotMoveHistoryItem = Readonly<{
  moveNumber: number;
  color: Stone;
  x: number | null;
  y: number | null;
  isPass: boolean;
  boardHash: string;
}>;

export type BotMoveRequest = Readonly<{
  contractVersion: typeof BOT_MOVE_CONTRACT_VERSION;
  retryPolicyVersion: typeof BOT_MOVE_RETRY_POLICY_VERSION;
  gameId: string;
  nextMoveNumber: number;
  boardSize: BoardSize;
  board: Board;
  boardHash: string;
  moves: readonly BotMoveHistoryItem[];
  toMove: Stone;
  configuration: BotGameConfiguration;
  profile: CalibratedBotProfile;
  binding: BotOpponentBinding;
  deadlineMs: number;
  maximumAttempts: 1 | 2 | 3;
}>;

export type CanonicalBotMoveRequest = Readonly<Omit<BotMoveRequest, "board" | "moves"> & {
  board: ReadonlyArray<ReadonlyArray<Stone | null>>;
  moves: readonly BotMoveHistoryItem[];
  requestIdentity: string;
}>;

export type BotGeneratedMove =
  | Readonly<{ kind: "play"; x: number; y: number }>
  | Readonly<{ kind: "pass" }>
  | Readonly<{ kind: "resign" }>;

export type BotMoveProviderResponse = Readonly<{
  requestIdentity: string;
  execution: BotExecutionIdentity;
  move: BotGeneratedMove;
}>;

export type BotMoveResult = Readonly<{
  contractVersion: typeof BOT_MOVE_CONTRACT_VERSION;
  requestIdentity: string;
  profileId: string;
  profileFingerprint: string;
  move: BotGeneratedMove;
  attempts: number;
  latencyMs: number;
}>;

export type BotMoveErrorCode =
  | "invalid_request"
  | "request_aborted"
  | "request_timeout"
  | "provider_unavailable"
  | "invalid_response"
  | "stale_response"
  | "retries_exhausted";

export class BotMoveError extends Error {
  constructor(
    public readonly code: BotMoveErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "BotMoveError";
  }
}

export interface BotMoveProvider {
  readonly providerKind: string;
  generateMove(
    request: CanonicalBotMoveRequest,
    signal: AbortSignal,
  ): Promise<BotMoveProviderResponse>;
}

const GAME_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function invalidRequest(message: string): never {
  throw new BotMoveError("invalid_request", message);
}

function validateRequest(request: BotMoveRequest): void {
  if (request.contractVersion !== BOT_MOVE_CONTRACT_VERSION) {
    invalidRequest("The bot move contract version is unsupported.");
  }
  if (request.retryPolicyVersion !== BOT_MOVE_RETRY_POLICY_VERSION) {
    invalidRequest("The bot move retry policy version is unsupported.");
  }
  if (!GAME_ID.test(request.gameId)) invalidRequest("The game id is invalid.");
  if (request.boardSize !== 9 && request.boardSize !== 13 && request.boardSize !== 19) {
    invalidRequest("The board size is unsupported.");
  }
  if (
    request.board.length !== request.boardSize
    || request.board.some((row) =>
      row.length !== request.boardSize
      || row.some((point) => point !== null && point !== "black" && point !== "white")
    )
  ) invalidRequest("The board must be a supported square Go position.");
  if (boardHash(request.board.map((row) => [...row])) !== request.boardHash) {
    invalidRequest("The board hash does not match the board.");
  }
  if (
    !Number.isSafeInteger(request.nextMoveNumber)
    || request.nextMoveNumber !== request.moves.length + 1
  ) invalidRequest("The next move number must continue the complete history.");
  for (let index = 0; index < request.moves.length; index += 1) {
    const move = request.moves[index];
    if (
      move.moveNumber !== index + 1
      || (move.color !== "black" && move.color !== "white")
      || typeof move.boardHash !== "string"
      || move.boardHash.length === 0
      || (move.isPass && (move.x !== null || move.y !== null))
      || (!move.isPass && (
        !Number.isInteger(move.x)
        || !Number.isInteger(move.y)
        || (move.x as number) < 0
        || (move.y as number) < 0
        || (move.x as number) >= request.boardSize
        || (move.y as number) >= request.boardSize
      ))
    ) invalidRequest("The move history is incomplete or malformed.");
  }
  if (
    request.moves.length > 0
    && request.moves.at(-1)?.boardHash !== request.boardHash
  ) invalidRequest("The current board must match the final move evidence.");
  if (request.toMove !== "black" && request.toMove !== "white") {
    invalidRequest("The player to move is invalid.");
  }
  if (request.configuration.boardSize !== request.boardSize) {
    invalidRequest("The bot configuration board size does not match the position.");
  }
  if (botConfigurationKey(request.configuration) !== request.binding.configurationKey) {
    invalidRequest("The bot binding does not match the game configuration.");
  }
  const expectedExecution = {
    profileId: request.profile.profileId,
    engineFamily: request.profile.engineFamily,
    engineVersion: request.profile.engineVersion,
    modelVersion: request.profile.modelVersion,
    configVersion: request.profile.configVersion,
  };
  if (!botExecutionMatchesBinding(request.binding, request.profile, expectedExecution)) {
    invalidRequest("The bot profile does not match its fixed opponent binding.");
  }
  if (!Number.isSafeInteger(request.deadlineMs) || request.deadlineMs < 10 || request.deadlineMs > 30_000) {
    invalidRequest("The bot move deadline must be 10 through 30000 milliseconds.");
  }
  if (![1, 2, 3].includes(request.maximumAttempts)) {
    invalidRequest("The bot move attempt count must be 1 through 3.");
  }
}

function canonicalRecord(request: BotMoveRequest): Record<string, unknown> {
  return {
    contractVersion: request.contractVersion,
    retryPolicyVersion: request.retryPolicyVersion,
    gameId: request.gameId,
    nextMoveNumber: request.nextMoveNumber,
    boardSize: request.boardSize,
    boardHash: request.boardHash,
    moves: request.moves.map((move) => ({
      moveNumber: move.moveNumber,
      color: move.color,
      x: move.x,
      y: move.y,
      isPass: move.isPass,
      boardHash: move.boardHash,
    })),
    toMove: request.toMove,
    configurationKey: request.binding.configurationKey,
    profileId: request.binding.profileId,
    profileFingerprint: request.binding.profileFingerprint,
    deadlineMs: request.deadlineMs,
    maximumAttempts: request.maximumAttempts,
  };
}

export function canonicalizeBotMoveRequest(
  request: BotMoveRequest,
): CanonicalBotMoveRequest {
  validateRequest(request);
  const requestIdentity = `sha256:${createHash("sha256")
    .update(JSON.stringify(canonicalRecord(request)), "utf8")
    .digest("hex")}`;
  const board = Object.freeze(request.board.map((row) => Object.freeze([...row])));
  const moves = Object.freeze(request.moves.map((move) => Object.freeze({ ...move })));
  const configuration = Object.freeze({ ...request.configuration });
  const profile = Object.freeze({
    ...request.profile,
    supportedConfigurations: Object.freeze(
      request.profile.supportedConfigurations.map((item) => Object.freeze({ ...item })),
    ),
  });
  const binding = Object.freeze({ ...request.binding });
  return Object.freeze({
    ...request,
    board,
    moves,
    configuration,
    profile,
    binding,
    requestIdentity,
  });
}

function validateMove(
  request: CanonicalBotMoveRequest,
  response: unknown,
): BotGeneratedMove {
  if (!response || typeof response !== "object") {
    throw new BotMoveError("invalid_response", "The bot provider returned no structured response.");
  }
  const candidate = response as Partial<BotMoveProviderResponse>;
  if (candidate.requestIdentity !== request.requestIdentity) {
    throw new BotMoveError("stale_response", "The bot response belongs to another position.");
  }
  if (
    !candidate.execution
    || !botExecutionMatchesBinding(request.binding, request.profile, candidate.execution)
  ) {
    throw new BotMoveError("invalid_response", "The bot response used an unbound execution profile.");
  }
  if (!candidate.move || typeof candidate.move !== "object" || !("kind" in candidate.move)) {
    throw new BotMoveError("invalid_response", "The bot provider returned no move.");
  }
  if (candidate.move.kind === "pass" || candidate.move.kind === "resign") {
    return Object.freeze({ kind: candidate.move.kind });
  }
  if (
    candidate.move.kind !== "play"
    || !Number.isInteger(candidate.move.x)
    || !Number.isInteger(candidate.move.y)
    || candidate.move.x < 0
    || candidate.move.y < 0
    || candidate.move.x >= request.boardSize
    || candidate.move.y >= request.boardSize
    || request.board[candidate.move.y][candidate.move.x] !== null
  ) {
    throw new BotMoveError("invalid_response", "The bot response is not a playable board point.");
  }
  return Object.freeze({ kind: "play", x: candidate.move.x, y: candidate.move.y });
}

function providerFailure(error: unknown): BotMoveError {
  if (error instanceof BotMoveError) return error;
  return new BotMoveError("provider_unavailable", "The bot move provider is unavailable.");
}

export class BotMoveClient {
  constructor(private readonly provider: BotMoveProvider) {
    if (provider.providerKind.trim().length === 0) {
      throw new RangeError("Bot move provider kind must not be empty.");
    }
  }

  async generateMove(
    input: BotMoveRequest,
    options: Readonly<{ signal?: AbortSignal }> = {},
  ): Promise<BotMoveResult> {
    const request = canonicalizeBotMoveRequest(input);
    if (options.signal?.aborted) {
      throw new BotMoveError("request_aborted", "The bot move request was aborted.");
    }
    const started = Date.now();
    const deadlineAt = started + request.deadlineMs;
    let lastRetryable: BotMoveError | null = null;
    for (let attempt = 1; attempt <= request.maximumAttempts; attempt += 1) {
      const remaining = deadlineAt - Date.now();
      if (remaining <= 0) {
        throw new BotMoveError("request_timeout", "The bot move deadline expired.");
      }
      const controller = new AbortController();
      let rejectExternalAbort: ((error: BotMoveError) => void) | undefined;
      const aborted = new Promise<never>((_, reject) => {
        rejectExternalAbort = reject;
      });
      const externalAbort = () => {
        controller.abort();
        rejectExternalAbort?.(
          new BotMoveError("request_aborted", "The bot move request was aborted."),
        );
      };
      options.signal?.addEventListener("abort", externalAbort, { once: true });
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new BotMoveError("request_timeout", "The bot move deadline expired."));
        }, remaining);
      });
      try {
        const response = await Promise.race([
          this.provider.generateMove(request, controller.signal),
          timeout,
          aborted,
        ]);
        if (options.signal?.aborted) {
          throw new BotMoveError("request_aborted", "The bot move request was aborted.");
        }
        const move = validateMove(request, response);
        return Object.freeze({
          contractVersion: BOT_MOVE_CONTRACT_VERSION,
          requestIdentity: request.requestIdentity,
          profileId: request.binding.profileId,
          profileFingerprint: request.binding.profileFingerprint,
          move,
          attempts: attempt,
          latencyMs: Date.now() - started,
        });
      } catch (error) {
        const failure = options.signal?.aborted
          ? new BotMoveError("request_aborted", "The bot move request was aborted.")
          : providerFailure(error);
        if (failure.code === "request_timeout" || failure.code === "request_aborted") throw failure;
        if (failure.code !== "provider_unavailable") throw failure;
        lastRetryable = failure;
      } finally {
        if (timer) clearTimeout(timer);
        options.signal?.removeEventListener("abort", externalAbort);
      }
    }
    throw new BotMoveError(
      "retries_exhausted",
      lastRetryable?.message ?? "The bot move retry budget was exhausted.",
    );
  }
}

export class DeterministicBotMoveProvider implements BotMoveProvider {
  readonly providerKind = "deterministic";

  constructor(
    private readonly resolver: (
      request: CanonicalBotMoveRequest,
    ) => BotGeneratedMove = (request) => {
      for (let y = 0; y < request.boardSize; y += 1) {
        for (let x = 0; x < request.boardSize; x += 1) {
          if (request.board[y][x] === null) return { kind: "play", x, y };
        }
      }
      return { kind: "pass" };
    },
  ) {}

  async generateMove(
    request: CanonicalBotMoveRequest,
    signal: AbortSignal,
  ): Promise<BotMoveProviderResponse> {
    if (signal.aborted) {
      throw new BotMoveError("request_aborted", "The deterministic bot request was aborted.");
    }
    return {
      requestIdentity: request.requestIdentity,
      execution: {
        profileId: request.profile.profileId,
        engineFamily: request.profile.engineFamily,
        engineVersion: request.profile.engineVersion,
        modelVersion: request.profile.modelVersion,
        configVersion: request.profile.configVersion,
      },
      move: this.resolver(request),
    };
  }
}
