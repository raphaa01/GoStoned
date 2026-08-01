import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { NextRequest } from "next/server";
import type { Pool } from "pg";
import { POST as submitBotMove } from "@/app/api/games/[gameId]/bot-move/route";
import { POST as submitMove } from "@/app/api/games/[gameId]/moves/route";
import { POST as resignGame } from "@/app/api/games/[gameId]/resign/route";
import { POST as confirmScore } from "@/app/api/games/[gameId]/scoring/confirm/route";
import { POST as setDeadGroup } from "@/app/api/games/[gameId]/scoring/dead-stones/route";
import { POST as resumePlay } from "@/app/api/games/[gameId]/scoring/resume/route";
import { EXPECTED_PLAYER_HEADER } from "@/lib/auth/playerBinding";
import { SESSION_COOKIE } from "@/lib/auth/session";
import {
  assertEmptyGameMutationBody,
  assertGameMutationMetadata,
  EMPTY_GAME_MUTATION_BODY_TIMEOUT_MS,
  gameMutationRouteError,
  MAX_GAME_MUTATION_BODY_BYTES,
  readGameMutationJson,
} from "./gameMutationRequest";
import { MAX_PERSISTED_GAME_VERSION } from "./gamePolling";
import { GameServiceError } from "./gameService";

const gameId = "33333333-3333-4333-8333-333333333333";
const playerKey = "user:11111111-1111-4111-8111-111111111111";
const SERVICE_BOUNDARY_SENTINEL = "expected game service boundary";

type MutationHandler = (
  request: NextRequest,
  context: { params: Promise<{ gameId: string }> },
) => Promise<Response>;

const mutations: Array<{
  name: string;
  path: string;
  handler: MutationHandler;
  body: string | null;
}> = [
  {
    name: "move",
    path: "moves",
    handler: submitMove,
    body: JSON.stringify({ x: 2, y: 3, expectedVersion: 0 }),
  },
  { name: "resign", path: "resign", handler: resignGame, body: null },
  {
    name: "score confirmation",
    path: "scoring/confirm",
    handler: confirmScore,
    body: JSON.stringify({ expectedRevision: 2 }),
  },
  {
    name: "dead-stone edit",
    path: "scoring/dead-stones",
    handler: setDeadGroup,
    body: JSON.stringify({ x: 2, y: 3, dead: true, expectedRevision: 2 }),
  },
  {
    name: "resume",
    path: "scoring/resume",
    handler: resumePlay,
    body: JSON.stringify({ expectedRevision: 2, claim: "dead", x: 2, y: 3 }),
  },
  {
    name: "verified local bot move",
    path: "bot-move",
    handler: submitBotMove,
    body: JSON.stringify({ action: "move", x: 2, y: 3, expectedVersion: 0 }),
  },
];

class RequestBoundaryPool {
  readonly statements: string[] = [];
  rateReservations = 0;
  serviceBoundaryAttempts = 0;

  async connect() {
    this.serviceBoundaryAttempts += 1;
    throw new Error(SERVICE_BOUNDARY_SENTINEL);
  }

  async query(sql: string) {
    const normalized = sql.replace(/\s+/g, " ").trim();
    this.statements.push(normalized);
    if (normalized.includes("FROM user_sessions s")) {
      return {
        rows: [{
          id: playerKey.slice("user:".length),
          username: "player",
          display_name: "Player",
          expires_at: new Date(Date.now() + 60_000),
        }],
        rowCount: 1,
      };
    }
    if (normalized.includes("INSERT INTO auth_rate_limits")) {
      this.rateReservations += 1;
      return {
        rows: [{
          attempts: 1,
          window_started_at: new Date(),
          blocked_until: null,
          retry_after_seconds: 60,
        }],
        rowCount: 1,
      };
    }
    if (normalized.includes("FROM game_bots")) {
      return {
        rows: [{
          bot_player_key: "bot:44444444-4444-4444-8444-444444444444",
          color: "black",
          target_rating: 1_200,
        }],
        rowCount: 1,
      };
    }
    throw new Error(`Game service must not be reached: ${normalized}`);
  }
}

async function withExpectedServiceBoundary(action: () => Promise<Response>): Promise<Response> {
  const previousConsoleError = console.error;
  const logged: unknown[][] = [];
  console.error = (...args: unknown[]) => {
    logged.push(args);
  };
  try {
    const response = await action();
    assert.equal(logged.length, 1);
    assert.equal(logged[0][0], "API request failed:");
    assert.ok(logged[0][1] instanceof Error);
    assert.equal((logged[0][1] as Error).message, SERVICE_BOUNDARY_SENTINEL);
    return response;
  } finally {
    console.error = previousConsoleError;
  }
}

async function withPool<T>(pool: RequestBoundaryPool, action: () => Promise<T>): Promise<T> {
  const previousPool = globalThis.goStonedDbPool;
  globalThis.goStonedDbPool = pool as unknown as Pool;
  globalThis.goStoneEphemeralRateLimits = new Map();
  try {
    return await action();
  } finally {
    globalThis.goStonedDbPool = previousPool;
  }
}

function mutationRequest(
  mutation: (typeof mutations)[number],
  options: {
    authenticated?: boolean;
    body?: BodyInit | null;
    contentType?: string;
    origin?: string;
    secFetchSite?: string;
    url?: string;
  } = {},
): NextRequest {
  const body = options.body === undefined ? mutation.body : options.body;
  return new NextRequest(
    options.url ?? `https://gostone.test/api/games/${gameId}/${mutation.path}`,
    {
      method: "POST",
      headers: {
        ...(options.authenticated === false
          ? {}
          : { Cookie: `${SESSION_COOKIE}=${"a".repeat(43)}` }),
        [EXPECTED_PLAYER_HEADER]: playerKey,
        "x-real-ip": "203.0.113.190",
        "sec-fetch-site": options.secFetchSite ?? "same-origin",
        ...(body === null ? {} : {
          "Content-Type": options.contentType ?? "application/json",
        }),
        ...(options.origin ? { Origin: options.origin } : {}),
      },
      ...(body === null ? {} : { body }),
    },
  );
}

const context = { params: Promise.resolve({ gameId }) };

function invalidMutationError(error: unknown): boolean {
  return error instanceof GameServiceError
    && error.status === 400
    && error.code === "invalid_game_mutation_request";
}

function streamedResignation(
  body: ReadableStream<Uint8Array>,
  options: { headers?: HeadersInit; signal?: AbortSignal } = {},
): NextRequest {
  return new NextRequest(`https://gostone.test/api/games/${gameId}/resign`, {
    method: "POST",
    body,
    duplex: "half",
    ...options,
  });
}

test("game mutation metadata is rejected before identity or persistent rate-limit access", async (t) => {
  for (const mutation of mutations) {
    await t.test(mutation.name, async () => {
      const cases: Array<{
        request: NextRequest;
        context?: { params: Promise<{ gameId: string }> };
        status: number;
        code: string;
      }> = [
        {
          request: mutationRequest(mutation, { origin: "https://attacker.test" }),
          status: 403,
          code: "request_rejected",
        },
        {
          request: mutationRequest(mutation, { origin: "not a valid origin" }),
          status: 403,
          code: "request_rejected",
        },
        {
          request: mutationRequest(mutation, { secFetchSite: "cross-site" }),
          status: 403,
          code: "request_rejected",
        },
        {
          request: mutationRequest(mutation, {
            url: `https://gostone.test/api/games/${gameId}/${mutation.path}?unsupported=1`,
          }),
          status: 400,
          code: "invalid_game_mutation_request",
        },
        {
          request: mutationRequest(mutation),
          context: { params: Promise.resolve({ gameId: "NOT-A-UUID" }) },
          status: 404,
          code: "game_not_found",
        },
      ];
      if (mutation.body !== null) {
        cases.push({
          request: mutationRequest(mutation, { contentType: "text/plain" }),
          status: 403,
          code: "request_rejected",
        });
      } else {
        cases.push({
          request: mutationRequest(mutation, { body: "{}" }),
          status: 400,
          code: "invalid_game_mutation_request",
        });
      }

      for (const invalid of cases) {
        const pool = new RequestBoundaryPool();
        const response = await withPool(pool, () => mutation.handler(
          invalid.request,
          invalid.context ?? context,
        ));
        assert.equal(response.status, invalid.status);
        assert.equal((await response.json()).code, invalid.code);
        assert.equal(pool.statements.length, 0);
      }
    });
  }
});

test("every game mutation requires a session before game or persistent actor access", async (t) => {
  for (const mutation of mutations) {
    await t.test(mutation.name, async () => {
      const pool = new RequestBoundaryPool();
      const response = await withPool(pool, () => mutation.handler(
        mutationRequest(mutation, { authenticated: false }),
        context,
      ));
      assert.equal(response.status, 401);
      assert.equal((await response.json()).code, "session_expired");
      assert.equal(pool.rateReservations, 0);
      assert.equal(pool.serviceBoundaryAttempts, 0);
      assert.equal(pool.statements.some((sql) => /\bFROM games\b/.test(sql)), false);
      assert.equal(
        pool.statements.some((sql) => /moves|game_scoring_resume_events|game_scoring_state/.test(sql)),
        false,
      );
    });
  }
});

test("invalid JSON mutations consume actor-bound budgets but never reach game services", async (t) => {
  for (const mutation of mutations.filter(({ body }) => body !== null)) {
    await t.test(mutation.name, async () => {
      const validObject = JSON.parse(mutation.body!) as Record<string, unknown>;
      const invalidBodies: BodyInit[] = [
        "",
        "not-json",
        "null",
        "[]",
        "1",
        JSON.stringify({ ...validObject, extra: true }),
        JSON.stringify({ ...validObject, extra: "x".repeat(MAX_GAME_MUTATION_BODY_BYTES) }),
        new Uint8Array([0xc3, 0x28]),
      ];
      for (const body of invalidBodies) {
        const pool = new RequestBoundaryPool();
        const response = await withPool(pool, () => mutation.handler(
          mutationRequest(mutation, { body }),
          context,
        ));
        assert.equal(response.status, 400);
        assert.equal((await response.json()).code, "invalid_game_mutation_request");
        assert.equal(pool.rateReservations, 4);
        assert.equal(pool.statements.some((sql) => /\bFROM games\b/.test(sql)), false);
        assert.equal(
          pool.statements.some((sql) => /\b(?:moves|game_scoring_state)\b/.test(sql)),
          false,
        );
      }
    });
  }
});

test("valid game mutation payloads pass route semantics and reach the service boundary", async () => {
  const move = mutations[0];
  const validCases: Array<{
    name: string;
    mutation: (typeof mutations)[number];
    body: BodyInit | null;
  }> = [
    { name: "move", mutation: move, body: JSON.stringify({ x: 2, y: 3, expectedVersion: 0 }) },
    { name: "pass", mutation: move, body: JSON.stringify({ isPass: true, expectedVersion: 0 }) },
    {
      name: "explicit non-pass",
      mutation: move,
      body: JSON.stringify({ x: 2, y: 3, isPass: false, expectedVersion: MAX_PERSISTED_GAME_VERSION }),
    },
    {
      name: "score confirmation",
      mutation: mutations[2],
      body: mutations[2].body,
    },
    { name: "dead-stone edit", mutation: mutations[3], body: mutations[3].body },
    { name: "scoring resume", mutation: mutations[4], body: mutations[4].body },
    { name: "bodyless resignation", mutation: mutations[1], body: null },
    { name: "verified local bot move", mutation: mutations[5], body: mutations[5].body },
  ];

  for (const valid of validCases) {
    const pool = new RequestBoundaryPool();
    const response = await withPool(pool, () => withExpectedServiceBoundary(
      () => valid.mutation.handler(
        mutationRequest(valid.mutation, { body: valid.body }),
        context,
      ),
    ));
    assert.equal(response.status, 500, valid.name);
    assert.equal((await response.json()).code, "internal_error", valid.name);
    assert.equal(pool.rateReservations, 4, valid.name);
    assert.equal(pool.serviceBoundaryAttempts, 1, valid.name);
  }
});

test("invalid semantic payloads are metered and stop before the service boundary", async () => {
  const move = mutations[0];
  const invalidCases: Array<{
    name: string;
    mutation: (typeof mutations)[number];
    body: string;
  }> = [
    {
      name: "pass with coordinates",
      mutation: move,
      body: JSON.stringify({ x: 2, y: 3, isPass: true, expectedVersion: 0 }),
    },
    {
      name: "explicit non-pass without coordinates",
      mutation: move,
      body: JSON.stringify({ isPass: false, expectedVersion: 0 }),
    },
    {
      name: "missing expected version",
      mutation: move,
      body: JSON.stringify({ x: 2, y: 3 }),
    },
    {
      name: "missing pass expected version",
      mutation: move,
      body: JSON.stringify({ isPass: true }),
    },
    {
      name: "fractional expected version",
      mutation: move,
      body: JSON.stringify({ x: 2, y: 3, expectedVersion: 0.5 }),
    },
    {
      name: "negative expected version",
      mutation: move,
      body: JSON.stringify({ x: 2, y: 3, expectedVersion: -1 }),
    },
    {
      name: "overflow expected version",
      mutation: move,
      body: JSON.stringify({ x: 2, y: 3, expectedVersion: MAX_PERSISTED_GAME_VERSION + 1 }),
    },
    {
      name: "fractional move",
      mutation: move,
      body: JSON.stringify({ x: 2.5, y: 3, expectedVersion: 0 }),
    },
    {
      name: "unsafe move integer",
      mutation: move,
      body: JSON.stringify({ x: Number.MAX_SAFE_INTEGER + 1, y: 3, expectedVersion: 0 }),
    },
    {
      name: "zero confirmation revision",
      mutation: mutations[2],
      body: JSON.stringify({ expectedRevision: 0 }),
    },
    {
      name: "fractional confirmation revision",
      mutation: mutations[2],
      body: JSON.stringify({ expectedRevision: 1.5 }),
    },
    {
      name: "wrong dead state",
      mutation: mutations[3],
      body: JSON.stringify({ x: 2, y: 3, dead: "true", expectedRevision: 2 }),
    },
    {
      name: "zero dead-stone revision",
      mutation: mutations[3],
      body: JSON.stringify({ x: 2, y: 3, dead: true, expectedRevision: 0 }),
    },
    {
      name: "unsafe dead-stone coordinate",
      mutation: mutations[3],
      body: JSON.stringify({
        x: Number.MAX_SAFE_INTEGER + 1,
        y: 3,
        dead: true,
        expectedRevision: 2,
      }),
    },
    {
      name: "unsupported resume claim",
      mutation: mutations[4],
      body: JSON.stringify({ expectedRevision: 2, claim: "seki", x: 2, y: 3 }),
    },
    {
      name: "zero resume revision",
      mutation: mutations[4],
      body: JSON.stringify({ expectedRevision: 0, claim: "dead", x: 2, y: 3 }),
    },
    {
      name: "fractional resume coordinate",
      mutation: mutations[4],
      body: JSON.stringify({ expectedRevision: 2, claim: "alive", x: 2, y: 3.5 }),
    },
  ];

  for (const invalid of invalidCases) {
    const pool = new RequestBoundaryPool();
    const response = await withPool(pool, () => invalid.mutation.handler(
      mutationRequest(invalid.mutation, { body: invalid.body }),
      context,
    ));
    assert.equal(response.status, 400, invalid.name);
    assert.equal((await response.json()).code, "invalid_game_mutation_request", invalid.name);
    assert.equal(pool.rateReservations, 4, invalid.name);
    assert.equal(pool.serviceBoundaryAttempts, 0, invalid.name);
    assert.equal(pool.statements.some((sql) => /\bFROM games\b/.test(sql)), false, invalid.name);
  }
});

test("bounded parser accepts every current client payload shape", async () => {
  const validCases: Array<{
    body: Record<string, unknown>;
    fields: readonly (readonly string[])[];
  }> = [
    {
      body: { x: 2, y: 3, expectedVersion: 0 },
      fields: [
        ["x", "y", "expectedVersion"],
        ["isPass", "expectedVersion"],
        ["x", "y", "isPass", "expectedVersion"],
      ],
    },
    {
      body: { isPass: true, expectedVersion: MAX_PERSISTED_GAME_VERSION },
      fields: [
        ["x", "y", "expectedVersion"],
        ["isPass", "expectedVersion"],
        ["x", "y", "isPass", "expectedVersion"],
      ],
    },
    {
      body: { x: 2, y: 3, isPass: false, expectedVersion: 7 },
      fields: [
        ["x", "y", "expectedVersion"],
        ["isPass", "expectedVersion"],
        ["x", "y", "isPass", "expectedVersion"],
      ],
    },
    { body: { expectedRevision: 2 }, fields: [["expectedRevision"]] },
    {
      body: { x: 2, y: 3, dead: true, expectedRevision: 2 },
      fields: [["x", "y", "dead", "expectedRevision"]],
    },
    {
      body: { expectedRevision: 2, claim: "dead", x: 2, y: 3 },
      fields: [["expectedRevision", "claim", "x", "y"]],
    },
  ];

  for (const entry of validCases) {
    const request = new NextRequest(`https://gostone.test/api/games/${gameId}/moves`, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify(entry.body),
    });
    assert.doesNotThrow(() => assertGameMutationMetadata(request, gameId, "json"));
    assert.deepEqual(await readGameMutationJson(request, entry.fields), entry.body);
  }

  const resign = new NextRequest(`https://gostone.test/api/games/${gameId}/resign`, {
    method: "POST",
  });
  assert.doesNotThrow(() => assertGameMutationMetadata(resign, gameId, "none"));
  await assert.doesNotReject(assertEmptyGameMutationBody(resign));

  const networkNormalizedResign = streamedResignation(new ReadableStream<Uint8Array>({
    start(controller) {
      controller.close();
    },
  }));
  await assert.doesNotReject(
    assertEmptyGameMutationBody(networkNormalizedResign),
  );
});

test("bodyless mutation validation is byte-exact, abortable, and time bounded", async () => {
  for (const contentLength of ["", "+0", "-0", "0e0", "1", "0, 0"]) {
    const request = streamedResignation(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.close();
      },
    }), { headers: { "Content-Length": contentLength } });
    await assert.rejects(assertEmptyGameMutationBody(request), invalidMutationError);
  }

  const exactZero = streamedResignation(new ReadableStream<Uint8Array>({
    start(controller) {
      controller.close();
    },
  }), { headers: { "Content-Length": "00" } });
  await assert.doesNotReject(assertEmptyGameMutationBody(exactZero));

  for (const headers of [undefined, { "Content-Length": "0" }]) {
    const request = streamedResignation(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1]));
      },
      cancel() {
        return new Promise<void>(() => undefined);
      },
    }), { headers });
    await assert.rejects(
      Promise.race([
        assertEmptyGameMutationBody(request),
        new Promise((_, reject) => setTimeout(
          () => reject(new Error("body cancellation blocked rejection")),
          100,
        )),
      ]),
      invalidMutationError,
    );
  }

  const streamError = streamedResignation(new ReadableStream<Uint8Array>({
    start(controller) {
      controller.error(new Error("transport failed"));
    },
  }));
  await assert.rejects(assertEmptyGameMutationBody(streamError), invalidMutationError);

  for (const [chunkCount, accepted] of [[8, true], [9, false]] as const) {
    const emptyChunks = streamedResignation(new ReadableStream<Uint8Array>({
      start(controller) {
        for (let chunk = 0; chunk < chunkCount; chunk += 1) {
          controller.enqueue(new Uint8Array());
        }
        controller.close();
      },
    }));
    if (accepted) {
      await assert.doesNotReject(assertEmptyGameMutationBody(emptyChunks));
    } else {
      await assert.rejects(assertEmptyGameMutationBody(emptyChunks), invalidMutationError);
    }
  }

  const abortController = new AbortController();
  const aborted = streamedResignation(new ReadableStream<Uint8Array>({
    pull() {
      return new Promise<void>(() => undefined);
    },
  }), { signal: abortController.signal });
  const abortedValidation = assertEmptyGameMutationBody(aborted);
  abortController.abort();
  await assert.rejects(
    Promise.race([
      abortedValidation,
      new Promise((_, reject) => setTimeout(
        () => reject(new Error("request abort did not settle body validation")),
        100,
      )),
    ]),
    invalidMutationError,
  );

  const stalled = streamedResignation(new ReadableStream<Uint8Array>({
    pull() {
      return new Promise<void>(() => undefined);
    },
  }));
  await assert.rejects(
    Promise.race([
      assertEmptyGameMutationBody(stalled),
      new Promise((_, reject) => setTimeout(
        () => reject(new Error("body validation exceeded its deadline")),
        EMPTY_GAME_MUTATION_BODY_TIMEOUT_MS + 250,
      )),
    ]),
    invalidMutationError,
  );
});

test("resignation meters the address before reading a network body", () => {
  const route = readFileSync(
    new URL("../../app/api/games/[gameId]/resign/route.ts", import.meta.url),
    "utf8",
  );
  const metadata = route.indexOf("assertGameMutationMetadata(");
  const addressBudget = route.indexOf("consumeEphemeralIpPolicyRateLimit(");
  const bodyRead = route.indexOf("assertEmptyGameMutationBody(");
  const identity = route.indexOf("resolvePlayerKey(");
  assert.ok(metadata >= 0 && metadata < addressBudget);
  assert.ok(addressBudget < bodyRead);
  assert.ok(bodyRead < identity);
});

test("bounded parser rejects malformed, non-object, oversized, non-UTF-8, and excess input", async () => {
  const invalidBodies: Array<BodyInit | null> = [
    null,
    "",
    "not-json",
    "null",
    "[]",
    JSON.stringify({ expectedRevision: 2, extra: true }),
    JSON.stringify({ expectedRevision: "x".repeat(MAX_GAME_MUTATION_BODY_BYTES) }),
    new Uint8Array([0xc3, 0x28]),
  ];

  for (const body of invalidBodies) {
    const request = new NextRequest(`https://gostone.test/api/games/${gameId}/scoring/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      ...(body === null ? {} : { body }),
    });
    await assert.rejects(
      () => readGameMutationJson(request, [["expectedRevision"]]),
      (error: unknown) =>
        error instanceof GameServiceError
        && error.status === 400
        && error.code === "invalid_game_mutation_request",
    );
  }
});

test("game version conflicts are stable no-store mutation responses", async () => {
  const response = gameMutationRouteError(new GameServiceError(
    "The game changed. Review the latest position before moving.",
    409,
    "game_version_conflict",
  ));
  assert.equal(response.status, 409);
  assert.equal(response.headers.get("cache-control"), "no-store, max-age=0");
  assert.deepEqual(await response.json(), {
    ok: false,
    error: "The game changed. Review the latest position before moving.",
    code: "game_version_conflict",
  });
});
