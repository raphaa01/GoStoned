import assert from "node:assert/strict";
import "dotenv/config";
import { closePool, query } from "../lib/db";
import { isLocalDatabase } from "../lib/env";

const baseUrl = process.env.BASE_URL ?? "http://localhost:3000";
const databaseUrl = process.env.DATABASE_URL;
const smokeHost = new URL(baseUrl).hostname;

if (smokeHost !== "localhost" && smokeHost !== "127.0.0.1" && smokeHost !== "::1") {
  throw new Error("The scoring race smoke only runs against an isolated local server.");
}
if (!databaseUrl || !isLocalDatabase(databaseUrl)) {
  throw new Error("The scoring race smoke requires an isolated local DATABASE_URL.");
}

type Guest = { cookie: string; playerKey: string };
type ScoringFixture = {
  black: Guest;
  white: Guest;
  gameId: string;
  revision: number;
};

async function api(
  path: string,
  init: RequestInit,
  cookie: string,
): Promise<{ response: Response; body: Record<string, unknown> }> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { ...init.headers, Cookie: cookie },
  });
  const body = await response.json() as Record<string, unknown>;
  return { response, body };
}

async function createGuest(): Promise<Guest> {
  const response = await fetch(`${baseUrl}/api/auth/guest`, { method: "POST" });
  const body = await response.json() as {
    ok: boolean;
    identity: { playerKey: string };
  };
  assert.equal(response.status, 201);
  const cookie = response.headers.get("set-cookie")?.split(";")[0];
  assert.ok(cookie);
  return { cookie, playerKey: body.identity.playerKey };
}

async function postGame(
  gameId: string,
  suffix: string,
  body: Record<string, unknown>,
  cookie: string,
) {
  return api(`/api/games/${gameId}${suffix}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }, cookie);
}

async function setupScoringFixture(): Promise<ScoringFixture> {
  const black = await createGuest();
  const white = await createGuest();
  const first = await api("/api/matchmaking", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ boardSize: 9, timeControl: "rapid" }),
  }, black.cookie);
  assert.equal(first.response.status, 200);
  const second = await api("/api/matchmaking", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ boardSize: 9, timeControl: "rapid" }),
  }, white.cookie);
  assert.equal(second.response.status, 200);
  const gameId = ((second.body.matchmaking as { gameId: string }).gameId);

  for (const [guest, move] of [
    [black, { x: 2, y: 2 }],
    [white, { x: 3, y: 2 }],
    [black, { isPass: true }],
    [white, { isPass: true }],
  ] as const) {
    const moved = await postGame(gameId, "/moves", move, guest.cookie);
    assert.equal(moved.response.status, 200);
  }

  const state = await api(`/api/games/${gameId}`, { method: "GET" }, black.cookie);
  const revision = ((state.body.game as { scoring: { revision: number } }).scoring.revision);
  const marked = await postGame(gameId, "/scoring/dead-stones", {
    x: 3,
    y: 2,
    dead: true,
    expectedRevision: revision,
  }, black.cookie);
  assert.equal(marked.response.status, 200);
  const markedRevision = ((marked.body.game as { scoring: { revision: number } }).scoring.revision);
  const confirmed = await postGame(gameId, "/scoring/confirm", {
    expectedRevision: markedRevision,
  }, black.cookie);
  assert.equal(confirmed.response.status, 200);
  return { black, white, gameId, revision: markedRevision };
}

async function assertOneLedgerEvent(fixture: ScoringFixture) {
  const ledger = await query<{ player_key: string; games: number; history_count: number }>(
    `SELECT stats.player_key, stats.games, COUNT(history.id)::int AS history_count
       FROM player_stats stats
       LEFT JOIN player_rating_history history
         ON history.player_key = stats.player_key AND history.game_id = $1
      WHERE stats.player_key = ANY($2::text[]) AND stats.board_size = 9
      GROUP BY stats.player_key, stats.games
      ORDER BY stats.player_key`,
    [fixture.gameId, [fixture.black.playerKey, fixture.white.playerKey]],
  );
  assert.equal(ledger.rows.length, 2);
  assert.equal(ledger.rows.every((row) => row.games === 1), true);
  assert.equal(ledger.rows.every((row) => row.history_count === 1), true);
}

async function assertLegacyDeploymentWindowCompatibility() {
  const black = await createGuest();
  const white = await createGuest();
  const inserted = await query<{ id: string; rules_profile: string }>(
    `INSERT INTO games (board_size, black_player_key, white_player_key)
     VALUES (9, $1, $2)
     RETURNING id, rules_profile`,
    [black.playerKey, white.playerKey],
  );
  const gameId = inserted.rows[0].id;
  assert.equal(inserted.rows[0].rules_profile, "legacy-immediate-area");

  // Simulate a move accepted by the previous application after migration 008:
  // it writes the move log but does not maintain the expanded lifecycle fields.
  await query(
    `INSERT INTO moves (game_id, move_number, color, x, y, is_pass, board_hash)
     VALUES ($1, 1, 'black', 2, 2, FALSE, 'legacy-deployment-window')`,
    [gameId],
  );

  const loaded = await api(`/api/games/${gameId}`, { method: "GET" }, white.cookie);
  assert.equal(loaded.response.status, 200);
  const legacyState = loaded.body.game as {
    turn: string;
    consecutivePasses: number;
    rulesProfile: string;
  };
  assert.equal(legacyState.rulesProfile, "legacy-immediate-area");
  assert.equal(legacyState.turn, "white");
  assert.equal(legacyState.consecutivePasses, 0);

  const whitePass = await postGame(gameId, "/moves", { isPass: true }, white.cookie);
  assert.equal(whitePass.response.status, 200);
  assert.equal((whitePass.body.game as { consecutivePasses: number }).consecutivePasses, 1);
  const blackPass = await postGame(gameId, "/moves", { isPass: true }, black.cookie);
  assert.equal(blackPass.response.status, 200);
  const finished = blackPass.body.game as { status: string; finishReason: string };
  assert.equal(finished.status, "finished");
  assert.equal(finished.finishReason, "legacy_score");
  await assertOneLedgerEvent({ black, white, gameId, revision: 0 });
}

async function run() {
  console.log(`Testing scoring races at ${baseUrl}`);

  await assertLegacyDeploymentWindowCompatibility();

  const confirmResume = await setupScoringFixture();
  const confirmResumeResults = await Promise.all([
    postGame(confirmResume.gameId, "/scoring/confirm", {
      expectedRevision: confirmResume.revision,
    }, confirmResume.white.cookie),
    postGame(confirmResume.gameId, "/scoring/resume", {
      expectedRevision: confirmResume.revision,
      claim: "alive",
      x: 3,
      y: 2,
    }, confirmResume.white.cookie),
  ]);
  assert.deepEqual(
    confirmResumeResults.map(({ response }) => response.status).sort(),
    [200, 409],
  );
  const confirmResumeState = await api(
    `/api/games/${confirmResume.gameId}`,
    { method: "GET" },
    confirmResume.black.cookie,
  );
  const firstGame = confirmResumeState.body.game as {
    status: string;
    phase: string;
    turn: string | null;
  };
  assert.equal(
    (firstGame.status === "finished" && firstGame.phase === "scoring")
      || (firstGame.status === "active" && firstGame.phase === "play" && firstGame.turn === "black"),
    true,
  );
  if (firstGame.status === "finished") await assertOneLedgerEvent(confirmResume);

  const confirmResign = await setupScoringFixture();
  const confirmResignResults = await Promise.all([
    postGame(confirmResign.gameId, "/scoring/confirm", {
      expectedRevision: confirmResign.revision,
    }, confirmResign.white.cookie),
    postGame(confirmResign.gameId, "/resign", {}, confirmResign.white.cookie),
  ]);
  assert.deepEqual(
    confirmResignResults.map(({ response }) => response.status).sort(),
    [200, 409],
  );
  const confirmResignState = await api(
    `/api/games/${confirmResign.gameId}`,
    { method: "GET" },
    confirmResign.black.cookie,
  );
  assert.equal((confirmResignState.body.game as { status: string }).status, "finished");
  await assertOneLedgerEvent(confirmResign);

  const deadline = await setupScoringFixture();
  await assert.rejects(
    query(
      `UPDATE game_scoring_state
          SET scored_board_hash = board_hash,
              black_stones = 1,
              white_stones = 0,
              black_territory = 80,
              white_territory = 0,
              neutral_points = 0,
              black_dead_stones = 0,
              white_dead_stones = 1,
              black_total = 81,
              white_total = komi,
              result = 'B+73.5',
              finalized_at = NOW()
        WHERE game_id = $1`,
      [deadline.gameId],
    ),
    (error: { code?: string }) => error.code === "23514",
  );
  await query(
    `UPDATE game_scoring_state
        SET started_at = NOW() - INTERVAL '2 seconds',
            expires_at = NOW() - INTERVAL '1 second'
      WHERE game_id = $1`,
    [deadline.gameId],
  );
  const expiredState = await api(
    `/api/games/${deadline.gameId}`,
    { method: "GET" },
    deadline.black.cookie,
  );
  const resumed = expiredState.body.game as {
    status: string;
    phase: string;
    turn: string;
    scoring: null;
    lastResume: { claim: string };
  };
  assert.equal(resumed.status, "active");
  assert.equal(resumed.phase, "play");
  assert.equal(resumed.turn, "black");
  assert.equal(resumed.scoring, null);
  assert.equal(resumed.lastResume.claim, "deadline");

  console.log(
    "Legacy rollout compatibility, scoring races, ledger idempotency, deadline recovery, and DB constraints passed.",
  );
}

run()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(closePool);
