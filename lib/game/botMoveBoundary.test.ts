import assert from "node:assert/strict";
import test from "node:test";
import {
  BOT_MOVE_CONTRACT_VERSION,
  BOT_MOVE_RETRY_POLICY_VERSION,
  BotMoveClient,
  BotMoveError,
  DeterministicBotMoveProvider,
  canonicalizeBotMoveRequest,
  type BotMoveErrorCode,
  type BotMoveProvider,
  type BotMoveProviderResponse,
  type BotMoveRequest,
  type CanonicalBotMoveRequest,
} from "./botMoveBoundary";
import { boardHash, createEmptyBoard } from "./goEngine";
import {
  CALIBRATED_BOT_PROFILE_CONTRACT_VERSION,
  createBotOpponentBinding,
  type BotGameConfiguration,
  type CalibratedBotProfile,
} from "../matchmaking/calibratedBotPolicy";

const configuration: BotGameConfiguration = {
  boardSize: 9,
  timeControl: "rapid",
  rulesProfile: "japanese-1989-gostone-v1",
  rulesVersion: "japanese-1989-gostone-contract-v1",
  komi: 6.5,
  handicap: 0,
};

function profile(): CalibratedBotProfile {
  return {
    contractVersion: CALIBRATED_BOT_PROFILE_CONTRACT_VERSION,
    profileId: "bot:boundary-test:v1",
    transparentName: "Boundary Test Bot",
    engineFamily: "deterministic-test",
    engineVersion: "engine-v1",
    modelVersion: "model-v1",
    configVersion: "config-v1",
    fixedRating: 1500,
    fixedRatingDeviation: 80,
    supportedConfigurations: [configuration],
    handicapMode: "even",
  };
}

function request(overrides: Partial<BotMoveRequest> = {}): BotMoveRequest {
  const bot = profile();
  const board = createEmptyBoard(9);
  return {
    contractVersion: BOT_MOVE_CONTRACT_VERSION,
    retryPolicyVersion: BOT_MOVE_RETRY_POLICY_VERSION,
    gameId: "123e4567-e89b-42d3-a456-426614174000",
    nextMoveNumber: 1,
    boardSize: 9,
    board,
    boardHash: boardHash(board),
    moves: [],
    toMove: "black",
    configuration,
    profile: bot,
    binding: createBotOpponentBinding(bot, configuration),
    deadlineMs: 1_000,
    maximumAttempts: 1,
    ...overrides,
  };
}

function execution(input: CanonicalBotMoveRequest) {
  return {
    profileId: input.profile.profileId,
    engineFamily: input.profile.engineFamily,
    engineVersion: input.profile.engineVersion,
    modelVersion: input.profile.modelVersion,
    configVersion: input.profile.configVersion,
  };
}

async function rejectsWithCode(
  promise: Promise<unknown>,
  code: BotMoveErrorCode,
): Promise<void> {
  await assert.rejects(promise, (error: unknown) =>
    error instanceof BotMoveError && error.code === code
  );
}

test("canonical requests are stable, content-bound snapshots", () => {
  const input = request();
  const canonical = canonicalizeBotMoveRequest(input);
  const same = canonicalizeBotMoveRequest(request());
  assert.equal(canonical.requestIdentity, same.requestIdentity);
  assert.match(canonical.requestIdentity, /^sha256:[0-9a-f]{64}$/);
  assert.notEqual(
    canonical.requestIdentity,
    canonicalizeBotMoveRequest(request({ deadlineMs: 2_000 })).requestIdentity,
  );

  input.board[0][0] = "black";
  (input.profile.supportedConfigurations as BotGameConfiguration[])[0] = {
    ...configuration,
    komi: 7.5,
  };
  assert.equal(canonical.board[0][0], null);
  assert.equal(canonical.profile.supportedConfigurations[0].komi, 6.5);
  assert.equal(Object.isFrozen(canonical), true);
  assert.equal(Object.isFrozen(canonical.board[0]), true);
  assert.equal(Object.isFrozen(canonical.profile), true);
});

test("the deterministic provider picks the first empty point reproducibly", async () => {
  const input = request();
  input.board[0][0] = "black";
  const client = new BotMoveClient(new DeterministicBotMoveProvider());
  const result = await client.generateMove({
    ...input,
    boardHash: boardHash(input.board),
  });
  assert.deepEqual(result.move, { kind: "play", x: 1, y: 0 });
  assert.equal(result.attempts, 1);
  assert.equal(result.profileId, input.profile.profileId);
  assert.equal(result.profileFingerprint, input.binding.profileFingerprint);
});

test("malformed requests fail before any provider call", async () => {
  let calls = 0;
  const provider: BotMoveProvider = {
    providerKind: "counting-test",
    async generateMove(input) {
      calls += 1;
      return { requestIdentity: input.requestIdentity, execution: execution(input), move: { kind: "pass" } };
    },
  };
  const client = new BotMoveClient(provider);
  await rejectsWithCode(client.generateMove(request({ boardHash: "wrong" })), "invalid_request");
  await rejectsWithCode(client.generateMove(request({ deadlineMs: 9 })), "invalid_request");
  await rejectsWithCode(client.generateMove(request({
    nextMoveNumber: 2,
    moves: [{
      moveNumber: 1,
      color: "black",
      x: 9,
      y: 0,
      isPass: false,
      boardHash: boardHash(createEmptyBoard(9)),
    }],
  })), "invalid_request");
  assert.equal(calls, 0);
});

test("stale, unbound, missing, and occupied responses have stable errors", async () => {
  const stale: BotMoveProvider = {
    providerKind: "stale-test",
    async generateMove(input) {
      return { requestIdentity: "sha256:stale", execution: execution(input), move: { kind: "pass" } };
    },
  };
  await rejectsWithCode(new BotMoveClient(stale).generateMove(request()), "stale_response");

  const unbound: BotMoveProvider = {
    providerKind: "unbound-test",
    async generateMove(input) {
      return {
        requestIdentity: input.requestIdentity,
        execution: { ...execution(input), modelVersion: "other-model" },
        move: { kind: "pass" },
      };
    },
  };
  await rejectsWithCode(new BotMoveClient(unbound).generateMove(request()), "invalid_response");

  const missing: BotMoveProvider = {
    providerKind: "missing-test",
    async generateMove() {
      return undefined as unknown as BotMoveProviderResponse;
    },
  };
  await rejectsWithCode(new BotMoveClient(missing).generateMove(request()), "invalid_response");

  const occupiedBoard = createEmptyBoard(9);
  occupiedBoard[0][0] = "black";
  const occupied = new DeterministicBotMoveProvider(() => ({ kind: "play", x: 0, y: 0 }));
  await rejectsWithCode(new BotMoveClient(occupied).generateMove(request({
    board: occupiedBoard,
    boardHash: boardHash(occupiedBoard),
  })), "invalid_response");
});

test("only provider-unavailable failures retry, within one total deadline", async () => {
  let calls = 0;
  const provider: BotMoveProvider = {
    providerKind: "retry-test",
    async generateMove(input) {
      calls += 1;
      if (calls < 3) throw new Error("temporary provider failure");
      return {
        requestIdentity: input.requestIdentity,
        execution: execution(input),
        move: { kind: "pass" },
      };
    },
  };
  const result = await new BotMoveClient(provider).generateMove(request({ maximumAttempts: 3 }));
  assert.equal(calls, 3);
  assert.equal(result.attempts, 3);
  assert.deepEqual(result.move, { kind: "pass" });

  calls = 0;
  await rejectsWithCode(
    new BotMoveClient(provider).generateMove(request({ maximumAttempts: 2 })),
    "retries_exhausted",
  );
  assert.equal(calls, 2);
});

test("deadline and caller abort terminate providers that never settle", async () => {
  const never: BotMoveProvider = {
    providerKind: "never-test",
    async generateMove() {
      return await new Promise<BotMoveProviderResponse>(() => undefined);
    },
  };
  await rejectsWithCode(
    new BotMoveClient(never).generateMove(request({ deadlineMs: 10 })),
    "request_timeout",
  );

  const controller = new AbortController();
  const pending = new BotMoveClient(never).generateMove(
    request({ deadlineMs: 1_000 }),
    { signal: controller.signal },
  );
  controller.abort();
  await rejectsWithCode(pending, "request_aborted");
});
