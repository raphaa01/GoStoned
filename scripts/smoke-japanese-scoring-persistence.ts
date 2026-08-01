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
  throw new Error("The Japanese scoring smoke requires an isolated local DATABASE_URL.");
}

const board = boardHash(createEmptyBoard(9));
const proposalHash = "b".repeat(64);
const pendingProposalHash = "d".repeat(64);
const requestIdentity = "c".repeat(64);

async function createGame(client: PoolClient, expired: boolean): Promise<string> {
  const game = await client.query<{ id: string }>(
    `INSERT INTO games (
       board_size, black_player_key, white_player_key, status, phase, to_move,
       consecutive_passes, scoring_revision, rules, rules_profile,
       scoring_method, komi, handicap
     ) VALUES (9, $1, $2, 'active', 'scoring', NULL, 2, 1,
       'japanese', 'japanese-1989-gostone-v1', 'territory', 6.5, 0)
     RETURNING id`,
    [`guest:js-black-${Date.now()}`, `guest:js-white-${Date.now()}`],
  );
  const gameId = game.rows[0].id;
  await client.query(
    `INSERT INTO moves (game_id, move_number, color, is_pass, board_hash)
     VALUES ($1, 1, 'black', TRUE, $2), ($1, 2, 'white', TRUE, $2)`,
    [gameId, board],
  );
  await client.query(
    `INSERT INTO game_japanese_scoring_state (
       game_id, board_hash, stopped_move_number, revision, proposal_hash,
       captured_white_by_black_at_stop, captured_black_by_white_at_stop,
       started_at, expires_at
     ) VALUES (
       $1, $2, 2, 1, $3, 0, 0,
       CASE WHEN $4 THEN statement_timestamp() - INTERVAL '31 seconds' ELSE statement_timestamp() END,
       CASE WHEN $4 THEN statement_timestamp() - INTERVAL '1 second' ELSE statement_timestamp() + INTERVAL '5 minutes' END
     )`,
    [gameId, board, pendingProposalHash, expired],
  );
  return gameId;
}

async function expectCheck(
  client: PoolClient,
  savepoint: string,
  operation: () => Promise<unknown>,
): Promise<void> {
  await client.query(`SAVEPOINT ${savepoint}`);
  let rejection: unknown;
  try { await operation(); } catch (error) { rejection = error; }
  await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
  assert.equal((rejection as { code?: string } | undefined)?.code, "23514");
}

async function run(): Promise<void> {
  await assertSmokeDatabaseIdentity(getPool());
  const migration = await readFile(
    path.join(process.cwd(), "db/migrations/024_japanese_scoring_activation.sql"),
    "utf8",
  );
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query(migration);
    await client.query(migration);

    const proposalGame = await createGame(client, false);
    await client.query(
      `UPDATE game_japanese_scoring_state SET
         proposal_hash = $3, suggestion_status = 'ready', suggestion_request_identity = $2,
         suggestion_provider_kind = 'deterministic', suggestion_engine_version = 'test-engine',
         suggestion_model_version = 'test-model', suggestion_config_version = 'test-config',
         suggestion_confidence_policy_version = 'gostone-dead-groups-v1',
         suggestion_latency_ms = 4, black_participated_at = statement_timestamp()
       WHERE game_id = $1`,
      [proposalGame, requestIdentity, proposalHash],
    );
    await client.query(
      `INSERT INTO game_japanese_scoring_proposals (
         game_id, scoring_revision, proposal_hash, source, actor_color,
         parent_scoring_revision, dead_stones, neutral_region_seeds,
         stopped_move_number, stopped_board_hash, rules, rules_profile,
         scoring_method, komi, handicap, suggestion_request_identity,
         suggestion_provider_kind, suggestion_engine_version, suggestion_model_version,
         suggestion_config_version, suggestion_confidence_policy_version, suggestion_latency_ms
       ) VALUES ($1, 1, $2, 'katago_initial', NULL, NULL, '[]', '[]', 2, $3,
         'japanese', 'japanese-1989-gostone-v1', 'territory', 6.5, 0, $4,
         'deterministic', 'test-engine', 'test-model', 'test-config',
         'gostone-dead-groups-v1', 4)`,
      [proposalGame, proposalHash, board, requestIdentity],
    );
    await client.query("SET CONSTRAINTS ALL IMMEDIATE");
    await client.query("SET CONSTRAINTS ALL DEFERRED");
    await expectCheck(client, "proposal_update", () => client.query(
      "UPDATE game_japanese_scoring_proposals SET source = 'reset' WHERE game_id = $1",
      [proposalGame],
    ));

    const terminalGame = await createGame(client, true);
    await client.query(
      `INSERT INTO game_japanese_scoring_terminal_events (
         game_id, scoring_revision, proposal_hash, stopped_move_number,
         stopped_board_hash, rules, rules_profile, scoring_method, komi, handicap,
         outcome_kind, captured_white_by_black_at_stop,
         captured_black_by_white_at_stop
       ) VALUES ($1, 1, $2, 2, $3, 'japanese', 'japanese-1989-gostone-v1',
         'territory', 6.5, 0, 'no_participation', 0, 0)`,
      [terminalGame, pendingProposalHash, board],
    );
    await client.query(
      `UPDATE games SET status = 'finished', phase = 'play', to_move = NULL,
         finish_reason = 'japanese_no_result', result = 'No result', finished_at = NOW()
       WHERE id = $1`,
      [terminalGame],
    );
    const deleted = await client.query(
      "DELETE FROM game_japanese_scoring_state WHERE game_id = $1",
      [terminalGame],
    );
    assert.equal(deleted.rowCount, 1);
    await client.query("SET CONSTRAINTS ALL IMMEDIATE");
    await client.query("ROLLBACK");
    console.log("Japanese scoring persistence smoke passed (all changes rolled back). ");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

run().finally(closePool);
