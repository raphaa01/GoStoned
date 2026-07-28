import assert from "node:assert/strict";
import "dotenv/config";
import { closePool, getPool, query } from "../lib/db";
import { isUnambiguousLocalDatabase } from "../lib/env";
import { RATE_LIMIT_POLICIES } from "../lib/auth/rateLimit";
import { assertSmokeDatabaseIdentity } from "../lib/smokeDatabase";
import { EXPECTED_PLAYER_HEADER } from "../lib/auth/playerBinding";

const baseUrl = process.env.BASE_URL ?? "http://localhost:3000";
const databaseUrl = process.env.DATABASE_URL;
const maximumSmokeRateLimitWaitMs = 30_000;
const scoringDecisionWindowMs =
  RATE_LIMIT_POLICIES.scoringDecisionBurst.windowMinutes * 60_000;

assert.ok(
  Number.isFinite(scoringDecisionWindowMs) &&
    scoringDecisionWindowMs > 0 &&
    scoringDecisionWindowMs <= maximumSmokeRateLimitWaitMs,
  `Live-game smoke scoring window must be between 1ms and ${maximumSmokeRateLimitWaitMs}ms`,
);

const smokeHost = new URL(baseUrl).hostname;
if (smokeHost !== "localhost" && smokeHost !== "127.0.0.1" && smokeHost !== "::1") {
  throw new Error("The live-game smoke test only runs against an isolated local server.");
}
if (!databaseUrl || !isUnambiguousLocalDatabase(databaseUrl)) {
  throw new Error("The live-game smoke test requires an isolated local DATABASE_URL.");
}

async function request<T>(
  path: string,
  init?: RequestInit,
  cookie?: string,
  expectedPlayerKey?: string,
): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      ...init?.headers,
      ...(cookie ? { Cookie: cookie } : {}),
      ...(expectedPlayerKey
        ? { [EXPECTED_PLAYER_HEADER]: expectedPlayerKey }
        : {}),
    },
  });
  const body = (await response.json()) as { ok: boolean; error?: string } & T;
  assert.equal(response.ok, true, `${path}: ${body.error ?? response.statusText}`);
  assert.equal(body.ok, true, `${path}: ${body.error ?? "request failed"}`);
  return body;
}

async function post<T>(
  path: string,
  body: object,
  cookie: string,
  expectedPlayerKey: string,
): Promise<T> {
  return request<T>(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }, cookie, expectedPlayerKey);
}

async function postMove<T>(
  gameId: string,
  move: { x?: number; y?: number; isPass?: boolean },
  cookie: string,
  expectedPlayerKey: string,
): Promise<T> {
  const current = await request<{ game: { version: number } }>(
    `/api/games/${gameId}`,
    undefined,
    cookie,
    expectedPlayerKey,
  );
  return post<T>(
    `/api/games/${gameId}/moves`,
    { ...move, expectedVersion: current.game.version },
    cookie,
    expectedPlayerKey,
  );
}

async function createGuest() {
  const response = await fetch(`${baseUrl}/api/auth/guest`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  const body = (await response.json()) as {
    ok: boolean;
    error?: string;
    identity: { playerKey: string };
  };
  assert.equal(response.status, 201, body.error);
  const cookie = response.headers.get("set-cookie")?.split(";")[0];
  assert.ok(cookie);
  return { cookie, playerKey: body.identity.playerKey };
}

async function run() {
  await assertSmokeDatabaseIdentity(getPool());
  console.log(`Testing live game flow at ${new URL(baseUrl).origin}`);
  const black = await createGuest();
  const white = await createGuest();

  const cookieFree = await fetch(`${baseUrl}/api/matchmaking`);
  assert.equal(cookieFree.status, 401);
  const tampered = await fetch(`${baseUrl}/api/matchmaking`, {
    headers: { Cookie: "gostone_guest_session=tampered-token" },
  });
  assert.equal(tampered.status, 401);

  const first = await post<{ actor: string; matchmaking: { status: string } }>("/api/matchmaking", {
    boardSize: 9,
    timeControl: "rapid",
  }, black.cookie, black.playerKey);
  assert.equal(first.actor, black.playerKey);
  assert.equal(first.matchmaking.status, "waiting");

  const second = await post<{ actor: string; matchmaking: { status: string; gameId: string } }>(
    "/api/matchmaking",
    { boardSize: 9, timeControl: "rapid" },
    white.cookie,
    white.playerKey,
  );
  assert.equal(second.actor, white.playerKey);
  assert.equal(second.matchmaking.status, "matched");
  assert.ok(second.matchmaking.gameId);
  const gameId = second.matchmaking.gameId;

  const firstStatus = await request<{
    actor: string;
    matchmaking: { status: string; gameId: string };
  }>("/api/matchmaking", undefined, black.cookie, black.playerKey);
  assert.equal(firstStatus.actor, black.playerKey);
  assert.equal(firstStatus.matchmaking.gameId, gameId);

  const impersonationAttempt = await fetch(`${baseUrl}/api/games/${gameId}/moves`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: white.cookie,
      [EXPECTED_PLAYER_HEADER]: black.playerKey,
    },
    body: JSON.stringify({ x: 1, y: 1, expectedVersion: 0 }),
  });
  assert.equal(impersonationAttempt.status, 409);
  const impersonationBody = (await impersonationAttempt.json()) as { code?: string };
  assert.equal(impersonationBody.code, "identity_changed");

  const raceBlack = await createGuest();
  const raceWhite = await createGuest();
  await post<{ matchmaking: { status: string } }>("/api/matchmaking", {
    boardSize: 9,
    timeControl: "rapid",
  }, raceBlack.cookie, raceBlack.playerKey);
  const raceMatch = await post<{ matchmaking: { status: string; gameId: string } }>(
    "/api/matchmaking",
    { boardSize: 9, timeControl: "rapid" },
    raceWhite.cookie,
    raceWhite.playerKey,
  );
  assert.equal(raceMatch.matchmaking.status, "matched");
  const raceGameId = raceMatch.matchmaking.gameId;
  assert.ok(raceGameId);

  const initialRaceGame = await request<{ game: { version: number } }>(
    `/api/games/${raceGameId}`,
    undefined,
    raceBlack.cookie,
    raceBlack.playerKey,
  );
  const sameVersionAttempts = await Promise.all([0, 1].map(async () => {
    const response = await fetch(`${baseUrl}/api/games/${raceGameId}/moves`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: raceBlack.cookie,
        [EXPECTED_PLAYER_HEADER]: raceBlack.playerKey,
      },
      body: JSON.stringify({ x: 2, y: 2, expectedVersion: initialRaceGame.game.version }),
    });
    return {
      response,
      body: await response.json() as {
        actor?: string;
        code?: string;
        game?: { moveCount: number; turn: string };
      },
    };
  }));
  assert.deepEqual(
    sameVersionAttempts.map(({ response }) => response.status).sort((a, b) => a - b),
    [200, 409],
  );
  const acceptedMove = sameVersionAttempts.find(({ response }) => response.status === 200);
  const staleMove = sameVersionAttempts.find(({ response }) => response.status === 409);
  assert.ok(acceptedMove?.body.game);
  assert.equal(staleMove?.body.code, "game_version_conflict");
  assert.equal(staleMove?.response.headers.get("cache-control"), "no-store, max-age=0");
  const raceBlackMove = acceptedMove.body as {
    actor: string;
    game: { moveCount: number; turn: string };
  };
  assert.equal(raceBlackMove.actor, raceBlack.playerKey);
  assert.equal(raceBlackMove.game.moveCount, 1);
  assert.equal(raceBlackMove.game.turn, "white");

  const blackMove = await postMove<{
    actor: string;
    game: { moveCount: number; turn: string };
  }>(gameId, { x: 2, y: 2 }, black.cookie, black.playerKey);
  assert.equal(blackMove.actor, black.playerKey);
  assert.equal(blackMove.game.moveCount, 1);
  assert.equal(blackMove.game.turn, "white");

  const whiteMove = await postMove<{ game: { moveCount: number; turn: string } }>(
    gameId,
    { x: 3, y: 2 },
    white.cookie,
    white.playerKey,
  );
  assert.equal(whiteMove.game.moveCount, 2);
  assert.equal(whiteMove.game.turn, "black");

  await postMove(gameId, { isPass: true }, black.cookie, black.playerKey);
  const stopped = await postMove<{
    game: {
      status: string;
      phase: string;
      result: string | null;
      moveCount: number;
      scoring: { revision: number };
      clock: { black: { mainTimeMs: number }; white: { mainTimeMs: number } };
    };
  }>(gameId, { isPass: true }, white.cookie, white.playerKey);
  assert.equal(stopped.game.status, "active");
  assert.equal(stopped.game.phase, "scoring");
  assert.equal(stopped.game.result, null);
  assert.equal(stopped.game.moveCount, 4);

  const firstScoringRevision = stopped.game.scoring.revision;
  const outsider = await createGuest();
  const outsiderConfirmation = await fetch(
    `${baseUrl}/api/games/${gameId}/scoring/confirm`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: outsider.cookie,
        [EXPECTED_PLAYER_HEADER]: outsider.playerKey,
      },
      body: JSON.stringify({
        playerKey: black.playerKey,
        expectedRevision: firstScoringRevision,
      }),
    },
  );
  assert.equal(outsiderConfirmation.status, 403);
  for (const [path, body] of [
    [`/api/games/${gameId}/scoring/dead-stones`, {
      x: 3,
      y: 2,
      dead: true,
      expectedRevision: firstScoringRevision,
    }],
    [`/api/games/${gameId}/scoring/resume`, {
      x: 3,
      y: 2,
      claim: "dead",
      expectedRevision: firstScoringRevision,
    }],
  ] as const) {
    const outsiderAction = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: outsider.cookie,
        [EXPECTED_PLAYER_HEADER]: outsider.playerKey,
      },
      body: JSON.stringify(body),
    });
    assert.equal(outsiderAction.status, 403, `${path} must reject an outsider`);
  }
  const outsiderResignation = await fetch(`${baseUrl}/api/games/${gameId}/resign`, {
    method: "POST",
    headers: {
      Cookie: outsider.cookie,
      [EXPECTED_PLAYER_HEADER]: outsider.playerKey,
    },
  });
  assert.equal(
    outsiderResignation.status,
    403,
    `/api/games/${gameId}/resign must reject an outsider`,
  );

  await new Promise((resolve) => setTimeout(resolve, 75));
  const frozen = await request<{
    game: { clock: { black: { mainTimeMs: number }; white: { mainTimeMs: number } } };
  }>(`/api/games/${gameId}`, undefined, black.cookie, black.playerKey);
  assert.equal(frozen.game.clock.black.mainTimeMs, stopped.game.clock.black.mainTimeMs);
  assert.equal(frozen.game.clock.white.mainTimeMs, stopped.game.clock.white.mainTimeMs);

  const challengedProposal = await post<{
    game: { scoring: { revision: number; deadStones: Array<{ x: number; y: number }> } };
  }>(`/api/games/${gameId}/scoring/dead-stones`, {
    x: 3,
    y: 2,
    dead: true,
    expectedRevision: firstScoringRevision,
  }, black.cookie, black.playerKey);
  assert.deepEqual(challengedProposal.game.scoring.deadStones, [{ x: 3, y: 2 }]);

  const resumed = await post<{
    game: { phase: string; turn: string; scoring: null };
  }>(`/api/games/${gameId}/scoring/resume`, {
    expectedRevision: challengedProposal.game.scoring.revision,
    claim: "alive",
    x: 3,
    y: 2,
  }, white.cookie, white.playerKey);
  assert.equal(resumed.game.phase, "play");
  assert.equal(resumed.game.turn, "black");
  assert.equal(resumed.game.scoring, null);

  const resumeEvents = await query<{
    scoring_revision: number;
    resume_claim: string;
    requested_by_color: string | null;
    disputed_x: number | null;
    disputed_y: number | null;
    resumed_to_move: string;
  }>(
    `SELECT scoring_revision, resume_claim, requested_by_color,
            disputed_x, disputed_y, resumed_to_move
       FROM game_scoring_resume_events
      WHERE game_id = $1
      ORDER BY scoring_revision`,
    [gameId],
  );
  assert.deepEqual(resumeEvents.rows, [{
    scoring_revision: challengedProposal.game.scoring.revision,
    resume_claim: "alive",
    requested_by_color: "white",
    disputed_x: 3,
    disputed_y: 2,
    resumed_to_move: "black",
  }]);

  await postMove(gameId, { x: 4, y: 2 }, black.cookie, black.playerKey);
  await postMove(gameId, { isPass: true }, white.cookie, white.playerKey);
  const restopped = await postMove<{
    game: { phase: string; scoring: { revision: number } };
  }>(gameId, { isPass: true }, black.cookie, black.playerKey);
  assert.equal(restopped.game.phase, "scoring");
  assert.ok(restopped.game.scoring.revision > challengedProposal.game.scoring.revision);
  const retainedResumeEvidence = await query<{ event_count: number }>(
    `SELECT COUNT(*)::int AS event_count
       FROM game_scoring_resume_events
      WHERE game_id = $1`,
    [gameId],
  );
  assert.equal(retainedResumeEvidence.rows[0].event_count, 1);

  const staleConfirmation = await fetch(`${baseUrl}/api/games/${gameId}/scoring/confirm`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: white.cookie,
      [EXPECTED_PLAYER_HEADER]: white.playerKey,
    },
    body: JSON.stringify({ expectedRevision: challengedProposal.game.scoring.revision }),
  });
  assert.equal(staleConfirmation.status, 409);

  const secondProposal = await post<{
    game: {
      scoring: {
        revision: number;
        deadStones: Array<{ x: number; y: number }>;
      };
    };
  }>(`/api/games/${gameId}/scoring/dead-stones`, {
    x: 3,
    y: 2,
    dead: true,
    expectedRevision: restopped.game.scoring.revision,
  }, white.cookie, white.playerKey);
  assert.deepEqual(secondProposal.game.scoring.deadStones, [{ x: 3, y: 2 }]);

  const secondResumed = await post<{
    game: {
      phase: string;
      turn: string;
      scoring: null;
      lastResume: {
        claim: string;
        requestedBy: string;
        disputedStone: { x: number; y: number };
      };
    };
  }>(`/api/games/${gameId}/scoring/resume`, {
    expectedRevision: secondProposal.game.scoring.revision,
    claim: "dead",
    x: 3,
    y: 2,
  }, black.cookie, black.playerKey);
  assert.equal(secondResumed.game.phase, "play");
  assert.equal(secondResumed.game.turn, "black");
  assert.equal(secondResumed.game.scoring, null);
  assert.deepEqual(secondResumed.game.lastResume, {
    claim: "dead",
    requestedBy: "black",
    disputedStone: { x: 3, y: 2 },
  });

  const repeatedResumeEvents = await query<{
    scoring_revision: number;
    resume_claim: string;
    requested_by_color: string | null;
    resumed_to_move: string;
  }>(
    `SELECT scoring_revision, resume_claim, requested_by_color, resumed_to_move
       FROM game_scoring_resume_events
      WHERE game_id = $1
      ORDER BY scoring_revision`,
    [gameId],
  );
  assert.deepEqual(repeatedResumeEvents.rows, [
    {
      scoring_revision: challengedProposal.game.scoring.revision,
      resume_claim: "alive",
      requested_by_color: "white",
      resumed_to_move: "black",
    },
    {
      scoring_revision: secondProposal.game.scoring.revision,
      resume_claim: "dead",
      requested_by_color: "black",
      resumed_to_move: "black",
    },
  ]);

  const latestOnly = await request<{
    game: {
      lastResume: {
        claim: string;
        requestedBy: string;
        disputedStone: { x: number; y: number };
      };
      resumeEvents?: unknown;
    };
  }>(`/api/games/${gameId}`, undefined, white.cookie, white.playerKey);
  assert.deepEqual(latestOnly.game.lastResume, {
    claim: "dead",
    requestedBy: "black",
    disputedStone: { x: 3, y: 2 },
  });
  assert.equal("resumeEvents" in latestOnly.game, false);

  // Separate dispute coverage from the three final agreement/idempotency
  // decisions that intentionally fill one actor's complete burst allowance.
  await new Promise((resolve) => setTimeout(resolve, scoringDecisionWindowMs + 250));

  await postMove(gameId, { x: 5, y: 2 }, black.cookie, black.playerKey);
  await postMove(gameId, { isPass: true }, white.cookie, white.playerKey);
  const finalScoring = await postMove<{
    game: { phase: string; scoring: { revision: number } };
  }>(gameId, { isPass: true }, black.cookie, black.playerKey);
  assert.equal(finalScoring.game.phase, "scoring");

  const firstConfirmation = await post<{
    game: { status: string; scoring: { revision: number; blackConfirmed: boolean } };
  }>(`/api/games/${gameId}/scoring/confirm`, {
    expectedRevision: finalScoring.game.scoring.revision,
  }, black.cookie, black.playerKey);
  assert.equal(firstConfirmation.game.status, "active");
  assert.equal(firstConfirmation.game.scoring.blackConfirmed, true);

  const marked = await post<{
    game: {
      scoring: {
        revision: number;
        deadStones: Array<{ x: number; y: number }>;
        blackConfirmed: boolean;
      };
    };
  }>(`/api/games/${gameId}/scoring/dead-stones`, {
    x: 3,
    y: 2,
    dead: true,
    expectedRevision: firstConfirmation.game.scoring.revision,
  }, white.cookie, white.playerKey);
  assert.deepEqual(marked.game.scoring.deadStones, [{ x: 3, y: 2 }]);
  assert.equal(marked.game.scoring.blackConfirmed, false);

  const confirmations = await Promise.all([
    post<{ game: { status: string; result: string | null; moveCount: number; rated: boolean } }>(
      `/api/games/${gameId}/scoring/confirm`,
      { expectedRevision: marked.game.scoring.revision },
      black.cookie,
      black.playerKey,
    ),
    post<{ game: { status: string; result: string | null; moveCount: number; rated: boolean } }>(
      `/api/games/${gameId}/scoring/confirm`,
      { expectedRevision: marked.game.scoring.revision },
      white.cookie,
      white.playerKey,
    ),
  ]);
  assert.deepEqual(
    confirmations.map(({ game }) => game.status).sort(),
    ["active", "finished"],
  );
  const finished = confirmations.find(({ game }) => game.status === "finished")!;
  assert.equal(finished.game.status, "finished");
  assert.equal(finished.game.moveCount, 10);
  assert.ok(finished.game.result);
  assert.equal(finished.game.rated, false);

  const retry = await post<{ game: { status: string; result: string; rated: boolean } }>(
    `/api/games/${gameId}/scoring/confirm`,
    { expectedRevision: marked.game.scoring.revision },
    black.cookie,
    black.playerKey,
  );
  assert.equal(retry.game.status, "finished");
  assert.equal(retry.game.result, finished.game.result);
  assert.equal(retry.game.rated, false);

  const ledger = await query<{ stats_count: number; history_count: number }>(
    `SELECT
       (SELECT COUNT(*)::int
          FROM player_stats
         WHERE player_key = ANY($2::text[]) AND board_size = 9) AS stats_count,
       (SELECT COUNT(*)::int
          FROM player_rating_history
         WHERE game_id = $1 AND player_key = ANY($2::text[])) AS history_count`,
    [gameId, [black.playerKey, white.playerKey]],
  );
  assert.deepEqual(ledger.rows[0], { stats_count: 0, history_count: 0 });

  console.log(`Live game ${gameId} completed successfully (${finished.game.result}).`);
}

run()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Live-game smoke failed.");
    process.exitCode = 1;
  })
  .finally(closePool);
