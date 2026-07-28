import assert from "node:assert/strict";
import "dotenv/config";
import { closePool, query } from "../lib/db";
import { isUnambiguousLocalDatabase } from "../lib/env";
import { applyMove, boardHash, createEmptyBoard } from "../lib/game/goEngine";
import { EXPECTED_PLAYER_HEADER } from "../lib/auth/playerBinding";

const baseUrl = process.env.BASE_URL ?? "http://localhost:3000";
const databaseUrl = process.env.DATABASE_URL;
const smokeHost = new URL(baseUrl).hostname;

if (smokeHost !== "localhost" && smokeHost !== "127.0.0.1" && smokeHost !== "::1") {
  throw new Error("The scoring race smoke only runs against an isolated local server.");
}
if (!databaseUrl || !isUnambiguousLocalDatabase(databaseUrl)) {
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
  expectedPlayerKey?: string,
): Promise<{ response: Response; body: Record<string, unknown> }> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      ...init.headers,
      Cookie: cookie,
      ...(expectedPlayerKey
        ? { [EXPECTED_PLAYER_HEADER]: expectedPlayerKey }
        : {}),
    },
  });
  const body = await response.json() as Record<string, unknown>;
  return { response, body };
}

async function createGuest(): Promise<Guest> {
  const response = await fetch(`${baseUrl}/api/auth/guest`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
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
  expectedPlayerKey: string,
) {
  const versionedBody = suffix === "/moves"
    ? {
        ...body,
        expectedVersion: ((await api(
          `/api/games/${gameId}`,
          { method: "GET" },
          cookie,
          expectedPlayerKey,
        )).body.game as { version: number }).version,
      }
    : body;
  return api(`/api/games/${gameId}${suffix}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(versionedBody),
  }, cookie, expectedPlayerKey);
}

async function setupScoringFixture(): Promise<ScoringFixture> {
  const black = await createGuest();
  const white = await createGuest();
  const first = await api("/api/matchmaking", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ boardSize: 9, timeControl: "rapid" }),
  }, black.cookie, black.playerKey);
  assert.equal(first.response.status, 200);
  assert.equal(first.body.actor, black.playerKey);
  const second = await api("/api/matchmaking", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ boardSize: 9, timeControl: "rapid" }),
  }, white.cookie, white.playerKey);
  assert.equal(second.response.status, 200);
  assert.equal(second.body.actor, white.playerKey);
  const gameId = ((second.body.matchmaking as { gameId: string }).gameId);

  for (const [guest, move] of [
    [black, { x: 2, y: 2 }],
    [white, { x: 3, y: 2 }],
    [black, { isPass: true }],
    [white, { isPass: true }],
  ] as const) {
    const moved = await postGame(gameId, "/moves", move, guest.cookie, guest.playerKey);
    assert.equal(moved.response.status, 200);
  }

  const state = await api(
    `/api/games/${gameId}`,
    { method: "GET" },
    black.cookie,
    black.playerKey,
  );
  const revision = ((state.body.game as { scoring: { revision: number } }).scoring.revision);
  const marked = await postGame(gameId, "/scoring/dead-stones", {
    x: 3,
    y: 2,
    dead: true,
    expectedRevision: revision,
  }, black.cookie, black.playerKey);
  assert.equal(marked.response.status, 200);
  const markedRevision = ((marked.body.game as { scoring: { revision: number } }).scoring.revision);
  const confirmed = await postGame(gameId, "/scoring/confirm", {
    expectedRevision: markedRevision,
  }, black.cookie, black.playerKey);
  assert.equal(confirmed.response.status, 200);
  return { black, white, gameId, revision: markedRevision };
}

async function assertNoGuestLedgerEvent(fixture: ScoringFixture) {
  const ledger = await query<{ stats_count: number; history_count: number }>(
    `SELECT
       (SELECT COUNT(*)::int
          FROM player_stats
         WHERE player_key = ANY($2::text[]) AND board_size = 9) AS stats_count,
       (SELECT COUNT(*)::int
          FROM player_rating_history
         WHERE game_id = $1 AND player_key = ANY($2::text[])) AS history_count`,
    [fixture.gameId, [fixture.black.playerKey, fixture.white.playerKey]],
  );
  assert.deepEqual(ledger.rows[0], { stats_count: 0, history_count: 0 });
}

async function resumeEvents(gameId: string) {
  const result = await query<{
    scoring_revision: number;
    resume_claim: "dead" | "alive" | "deadline";
    requested_by_color: "black" | "white" | null;
    resumed_to_move: "black" | "white";
  }>(
    `SELECT scoring_revision, resume_claim, requested_by_color, resumed_to_move
       FROM game_scoring_resume_events
      WHERE game_id = $1
      ORDER BY scoring_revision`,
    [gameId],
  );
  return result.rows;
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
  const legacyMove = applyMove(createEmptyBoard(9), "black", 2, 2);
  assert.equal(legacyMove.ok, true);
  if (!legacyMove.ok) throw new Error("The legacy smoke move must be legal.");
  await query(
    `INSERT INTO moves (game_id, move_number, color, x, y, is_pass, board_hash)
     VALUES ($1, 1, 'black', 2, 2, FALSE, $2)`,
    [gameId, boardHash(legacyMove.board)],
  );

  const loaded = await api(
    `/api/games/${gameId}`,
    { method: "GET" },
    white.cookie,
    white.playerKey,
  );
  assert.equal(loaded.response.status, 200);
  const legacyState = loaded.body.game as {
    turn: string;
    consecutivePasses: number;
    rulesProfile: string;
  };
  assert.equal(legacyState.rulesProfile, "legacy-immediate-area");
  assert.equal(legacyState.turn, "white");
  assert.equal(legacyState.consecutivePasses, 0);

  const whitePass = await postGame(
    gameId,
    "/moves",
    { isPass: true },
    white.cookie,
    white.playerKey,
  );
  assert.equal(whitePass.response.status, 200);
  assert.equal((whitePass.body.game as { consecutivePasses: number }).consecutivePasses, 1);
  const blackPass = await postGame(
    gameId,
    "/moves",
    { isPass: true },
    black.cookie,
    black.playerKey,
  );
  assert.equal(blackPass.response.status, 200);
  const finished = blackPass.body.game as { status: string; finishReason: string; rated: boolean };
  assert.equal(finished.status, "finished");
  assert.equal(finished.finishReason, "legacy_score");
  assert.equal(finished.rated, false);
  await assertNoGuestLedgerEvent({ black, white, gameId, revision: 0 });
}

async function run() {
  console.log(`Testing scoring races at ${baseUrl}`);

  await assertLegacyDeploymentWindowCompatibility();

  const confirmResume = await setupScoringFixture();
  const confirmResumeResults = await Promise.all([
    postGame(confirmResume.gameId, "/scoring/confirm", {
      expectedRevision: confirmResume.revision,
    }, confirmResume.white.cookie, confirmResume.white.playerKey),
    postGame(confirmResume.gameId, "/scoring/resume", {
      expectedRevision: confirmResume.revision,
      claim: "alive",
      x: 3,
      y: 2,
    }, confirmResume.white.cookie, confirmResume.white.playerKey),
  ]);
  assert.deepEqual(
    confirmResumeResults.map(({ response }) => response.status).sort(),
    [200, 409],
  );
  const confirmResumeState = await api(
    `/api/games/${confirmResume.gameId}`,
    { method: "GET" },
    confirmResume.black.cookie,
    confirmResume.black.playerKey,
  );
  const firstGame = confirmResumeState.body.game as {
    status: string;
    phase: string;
    turn: string | null;
    rated: boolean;
  };
  assert.equal(
    (firstGame.status === "finished" && firstGame.phase === "scoring")
      || (firstGame.status === "active" && firstGame.phase === "play" && firstGame.turn === "black"),
    true,
  );
  if (firstGame.status === "finished") {
    assert.equal(firstGame.rated, false);
    await assertNoGuestLedgerEvent(confirmResume);
    assert.deepEqual(await resumeEvents(confirmResume.gameId), []);
  } else {
    assert.deepEqual(await resumeEvents(confirmResume.gameId), [{
      scoring_revision: confirmResume.revision,
      resume_claim: "alive",
      requested_by_color: "white",
      resumed_to_move: "black",
    }]);
  }

  const doubleResume = await setupScoringFixture();
  await assert.rejects(
    query(
      `INSERT INTO game_scoring_resume_events
         (game_id, scoring_revision, board_hash, stopped_move_number,
          rules, rules_profile, scoring_method, komi, handicap,
          fallback_to_move, scoring_expires_at, resume_claim,
          requested_by_color, disputed_x, disputed_y, resumed_to_move, resumed_at)
       SELECT game.id, scoring.revision, scoring.board_hash, scoring.stopped_move_number,
              game.rules, game.rules_profile, game.scoring_method, game.komi, game.handicap,
              scoring.fallback_to_move, scoring.expires_at, 'alive',
              'black', 3, 2, 'white', NOW()
         FROM games AS game
         JOIN game_scoring_state AS scoring ON scoring.game_id = game.id
        WHERE game.id = $1`,
      [doubleResume.gameId],
    ),
    (error: { code?: string }) => error.code === "23514",
  );
  await assert.rejects(
    query(
      `INSERT INTO game_scoring_resume_events
         (game_id, scoring_revision, board_hash, stopped_move_number,
          rules, rules_profile, scoring_method, komi, handicap,
          fallback_to_move, scoring_expires_at, resume_claim,
          requested_by_color, disputed_x, disputed_y, resumed_to_move, resumed_at)
       SELECT game.id, scoring.revision, scoring.board_hash, scoring.stopped_move_number,
              game.rules, game.rules_profile, game.scoring_method, game.komi, game.handicap,
              scoring.fallback_to_move, scoring.expires_at, 'alive',
              'black', 18, 18, 'white', NOW()
         FROM games AS game
         JOIN game_scoring_state AS scoring ON scoring.game_id = game.id
        WHERE game.id = $1`,
      [doubleResume.gameId],
    ),
    (error: { code?: string }) => error.code === "23514",
  );
  const doubleResumeResults = await Promise.all([
    postGame(doubleResume.gameId, "/scoring/resume", {
      expectedRevision: doubleResume.revision,
      claim: "alive",
      x: 3,
      y: 2,
    }, doubleResume.black.cookie, doubleResume.black.playerKey),
    postGame(doubleResume.gameId, "/scoring/resume", {
      expectedRevision: doubleResume.revision,
      claim: "alive",
      x: 3,
      y: 2,
    }, doubleResume.white.cookie, doubleResume.white.playerKey),
  ]);
  assert.deepEqual(
    doubleResumeResults.map(({ response }) => response.status).sort(),
    [200, 409],
  );
  const doubleResumeEvidence = await resumeEvents(doubleResume.gameId);
  assert.equal(doubleResumeEvidence.length, 1);
  assert.equal(doubleResumeEvidence[0].scoring_revision, doubleResume.revision);
  assert.equal(doubleResumeEvidence[0].resume_claim, "alive");
  assert.equal(
    doubleResumeEvidence[0].resumed_to_move,
    doubleResumeEvidence[0].requested_by_color === "black" ? "white" : "black",
  );
  for (const statement of [
    `UPDATE game_scoring_resume_events
        SET resume_claim = resume_claim
      WHERE game_id = $1`,
    "DELETE FROM game_scoring_resume_events WHERE game_id = $1",
    "TRUNCATE game_scoring_resume_events",
    "TRUNCATE games CASCADE",
    `INSERT INTO game_scoring_resume_events
     SELECT * FROM game_scoring_resume_events WHERE game_id = $1
     ON CONFLICT (game_id, scoring_revision)
     DO UPDATE SET resumed_at = EXCLUDED.resumed_at`,
  ]) {
    await assert.rejects(
      query(statement, statement.includes("$1") ? [doubleResume.gameId] : []),
      (error: { code?: string }) => error.code === "23514",
    );
  }
  const clientRoleAccess = await query<{
    role_name: string;
    has_table_access: boolean;
    has_column_access: boolean;
  }>(
    `SELECT role.rolname AS role_name,
            has_table_privilege(
              role.oid,
              'public.game_scoring_resume_events',
              'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'
            ) AS has_table_access,
            has_any_column_privilege(
              role.oid,
              'public.game_scoring_resume_events',
              'SELECT, INSERT, UPDATE, REFERENCES'
            ) AS has_column_access
       FROM pg_roles AS role
      WHERE role.rolname IN ('anon', 'authenticated')
      ORDER BY role.rolname`,
  );
  for (const role of clientRoleAccess.rows) {
    assert.equal(role.has_table_access, false, `${role.role_name} has table access`);
    assert.equal(role.has_column_access, false, `${role.role_name} has column access`);
  }
  await query("DELETE FROM games WHERE id = $1", [doubleResume.gameId]);
  assert.deepEqual(await resumeEvents(doubleResume.gameId), []);

  const confirmResign = await setupScoringFixture();
  const confirmResignResults = await Promise.all([
    postGame(confirmResign.gameId, "/scoring/confirm", {
      expectedRevision: confirmResign.revision,
    }, confirmResign.white.cookie, confirmResign.white.playerKey),
    postGame(
      confirmResign.gameId,
      "/resign",
      {},
      confirmResign.white.cookie,
      confirmResign.white.playerKey,
    ),
  ]);
  assert.deepEqual(
    confirmResignResults.map(({ response }) => response.status).sort(),
    [200, 409],
  );
  const confirmResignState = await api(
    `/api/games/${confirmResign.gameId}`,
    { method: "GET" },
    confirmResign.black.cookie,
    confirmResign.black.playerKey,
  );
  const resignedGame = confirmResignState.body.game as { status: string; rated: boolean };
  assert.equal(resignedGame.status, "finished");
  assert.equal(resignedGame.rated, false);
  await assertNoGuestLedgerEvent(confirmResign);

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
    deadline.black.playerKey,
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
  assert.deepEqual(await resumeEvents(deadline.gameId), [{
    scoring_revision: deadline.revision,
    resume_claim: "deadline",
    requested_by_color: null,
    resumed_to_move: "black",
  }]);
  const deadlineRetry = await api(
    `/api/games/${deadline.gameId}`,
    { method: "GET" },
    deadline.white.cookie,
    deadline.white.playerKey,
  );
  assert.equal((deadlineRetry.body.game as { phase: string }).phase, "play");
  assert.equal((await resumeEvents(deadline.gameId)).length, 1);

  console.log(
    "Legacy rollout compatibility, scoring races, immutable resume evidence, unrated guest results, deadline recovery, and DB constraints passed.",
  );
}

run()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(closePool);
