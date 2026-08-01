import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import "dotenv/config";
import type { PoolClient } from "pg";
import { closePool, getPool } from "../lib/db";
import { isUnambiguousLocalDatabase } from "../lib/env";
import { boardHash, createEmptyBoard } from "../lib/game/goEngine";
import { assertSmokeDatabaseIdentity } from "../lib/smokeDatabase";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || !isUnambiguousLocalDatabase(databaseUrl)) {
  throw new Error(
    "The Japanese resume persistence smoke requires an isolated local DATABASE_URL.",
  );
}

const proposalHash = "a".repeat(64);
const stoppedBoardHash = boardHash(createEmptyBoard(9));

async function expectCheckViolation(
  client: PoolClient,
  savepoint: string,
  operation: () => Promise<unknown>,
): Promise<void> {
  await client.query(`SAVEPOINT ${savepoint}`);
  let rejection: unknown;
  try {
    await operation();
  } catch (error) {
    rejection = error;
  }
  await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
  assert.equal(
    (rejection as { code?: string } | undefined)?.code,
    "23514",
    `${savepoint} must reject with a CHECK violation`,
  );
}

async function createStoppedGame(
  client: PoolClient,
  confirmation: "none" | "black" | "both",
): Promise<string> {
  const game = await client.query<{ id: string }>(
    `INSERT INTO public.games (
       board_size, black_player_key, white_player_key, status, phase, to_move,
       consecutive_passes, scoring_revision, rules, rules_profile,
       scoring_method, komi, handicap
     ) VALUES (
       9, $1, $2, 'active', 'scoring', NULL, 2, 1,
       'japanese', 'japanese-1989-gostone-v1', 'territory', 6.5, 0
     ) RETURNING id`,
    [`guest:japanese-black-${Date.now()}`, `guest:japanese-white-${Date.now()}`],
  );
  const gameId = game.rows[0].id;
  await client.query(
    `INSERT INTO public.moves
       (game_id, move_number, color, x, y, is_pass, board_hash)
     VALUES ($1, 1, 'black', NULL, NULL, TRUE, $2),
            ($1, 2, 'white', NULL, NULL, TRUE, $2)`,
    [gameId, stoppedBoardHash],
  );
  await client.query(
    `INSERT INTO public.game_japanese_scoring_state (
       game_id, board_hash, stopped_move_number, revision, proposal_hash,
       captured_white_by_black_at_stop, captured_black_by_white_at_stop,
       black_confirmed_revision, black_confirmed_proposal_hash, black_confirmed_at,
       white_confirmed_revision, white_confirmed_proposal_hash, white_confirmed_at
     ) VALUES (
       $1, $2, 2, 1, $3, 0, 0,
       CASE WHEN $4 IN ('black', 'both') THEN 1 END,
       CASE WHEN $4 IN ('black', 'both') THEN $3 END,
       CASE WHEN $4 IN ('black', 'both') THEN statement_timestamp() END,
       CASE WHEN $4 = 'both' THEN 1 END,
       CASE WHEN $4 = 'both' THEN $3 END,
       CASE WHEN $4 = 'both' THEN statement_timestamp() END
     )`,
    [gameId, stoppedBoardHash, proposalHash, confirmation],
  );
  return gameId;
}

async function authorizeAndComplete(
  client: PoolClient,
  gameId: string,
  resumptionNumber: number,
  scoringRevision: number,
  stoppedMoveNumber: number,
  requester: "black" | "white",
): Promise<void> {
  await client.query(
    `INSERT INTO public.game_japanese_resume_authorizations (
       game_id, resumption_number, scoring_revision, stopped_move_number,
       stopped_board_hash, requested_by_color, rules, rules_profile,
       scoring_method, komi, handicap, authorized_at
     ) VALUES (
       $1, $2, $3, $4, $5, $6,
       'japanese', 'japanese-1989-gostone-v1', 'territory', 6.5, 0,
       '2000-01-01T00:00:00Z'
     )`,
    [
      gameId,
      resumptionNumber,
      scoringRevision,
      stoppedMoveNumber,
      stoppedBoardHash,
      requester,
    ],
  );
  await client.query(
    `UPDATE public.games
        SET phase = 'play',
            to_move = CASE $2::text WHEN 'black' THEN 'white' ELSE 'black' END,
            consecutive_passes = 0,
            scoring_revision = scoring_revision + 1
      WHERE id = $1`,
    [gameId, requester],
  );
  const deleted = await client.query(
    "DELETE FROM public.game_japanese_scoring_state WHERE game_id = $1",
    [gameId],
  );
  assert.equal(deleted.rowCount, 1);
  await client.query("SET CONSTRAINTS ALL IMMEDIATE");
  await client.query("SET CONSTRAINTS ALL DEFERRED");
}

async function stopAgain(
  client: PoolClient,
  gameId: string,
  scoringRevision: number,
  stoppedMoveNumber: number,
): Promise<void> {
  const priorColor = stoppedMoveNumber % 4 === 0 ? "white" : "black";
  const latestColor = priorColor === "black" ? "white" : "black";
  await client.query(
    `INSERT INTO public.moves
       (game_id, move_number, color, x, y, is_pass, board_hash)
     VALUES ($1, $2, $4, NULL, NULL, TRUE, $3),
            ($1, $2 + 1, $5, NULL, NULL, TRUE, $3)`,
    [gameId, stoppedMoveNumber - 1, stoppedBoardHash, priorColor, latestColor],
  );
  await client.query(
    `UPDATE public.games
        SET phase = 'scoring', to_move = NULL, consecutive_passes = 2,
            scoring_revision = $2
      WHERE id = $1`,
    [gameId, scoringRevision],
  );
  await client.query(
    `INSERT INTO public.game_japanese_scoring_state (
       game_id, board_hash, stopped_move_number, revision, proposal_hash,
       captured_white_by_black_at_stop, captured_black_by_white_at_stop
     ) VALUES ($1, $2, $3, $4, $5, 0, 0)`,
    [gameId, stoppedBoardHash, stoppedMoveNumber, scoringRevision, proposalHash],
  );
}

async function run(): Promise<void> {
  await assertSmokeDatabaseIdentity(getPool());
  const migration = await readFile(
    path.join(process.cwd(), "db/migrations/023_japanese_resume_authorizations.sql"),
    "utf8",
  );
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    // These legacy rollout constraints intentionally keep Japanese dormant.
    // Dropping them only inside this rollback-only transaction permits fixtures.
    await client.query(
      `ALTER TABLE public.games
         DROP CONSTRAINT games_rules_profile_check,
         DROP CONSTRAINT games_scoring_method_check,
         DROP CONSTRAINT games_rules_check`,
    );
    await client.query(migration);

    for (const confirmation of ["none", "black"] as const) {
      const gameId = await createStoppedGame(client, confirmation);
      await authorizeAndComplete(client, gameId, 1, 1, 2, "black");
      const evidence = await client.query<{
        resumption_number: number;
        scoring_revision: number;
        requested_by_color: string;
        database_owned_timestamp: boolean;
      }>(
        `SELECT resumption_number, scoring_revision, requested_by_color,
                authorized_at > '2000-01-01T00:00:00Z' AS database_owned_timestamp
           FROM public.game_japanese_resume_authorizations
          WHERE game_id = $1`,
        [gameId],
      );
      assert.deepEqual(evidence.rows, [{
        resumption_number: 1,
        scoring_revision: 1,
        requested_by_color: "black",
        database_owned_timestamp: true,
      }]);
    }

    const bothConfirmedGame = await createStoppedGame(client, "both");
    await expectCheckViolation(client, "both_confirmed", () => client.query(
      `INSERT INTO public.game_japanese_resume_authorizations (
         game_id, resumption_number, scoring_revision, stopped_move_number,
         stopped_board_hash, requested_by_color, rules, rules_profile,
         scoring_method, komi, handicap
       ) VALUES ($1, 1, 1, 2, $2, 'black',
         'japanese', 'japanese-1989-gostone-v1', 'territory', 6.5, 0)`,
      [bothConfirmedGame, stoppedBoardHash],
    ));

    const cappedGame = await createStoppedGame(client, "none");
    await authorizeAndComplete(client, cappedGame, 1, 1, 2, "black");
    await stopAgain(client, cappedGame, 3, 4);
    await authorizeAndComplete(client, cappedGame, 2, 3, 4, "white");
    await stopAgain(client, cappedGame, 5, 6);
    await authorizeAndComplete(client, cappedGame, 3, 5, 6, "black");
    await stopAgain(client, cappedGame, 7, 8);
    await expectCheckViolation(client, "fourth_resumption", () => client.query(
      `INSERT INTO public.game_japanese_resume_authorizations (
         game_id, resumption_number, scoring_revision, stopped_move_number,
         stopped_board_hash, requested_by_color, rules, rules_profile,
         scoring_method, komi, handicap
       ) VALUES ($1, 4, 7, 8, $2, 'white',
         'japanese', 'japanese-1989-gostone-v1', 'territory', 6.5, 0)`,
      [cappedGame, stoppedBoardHash],
    ));

    await client.query("ROLLBACK");
    console.log("Japanese resume persistence smoke passed (all changes rolled back). ");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

run().finally(closePool);
