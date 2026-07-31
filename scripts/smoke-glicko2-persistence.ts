import assert from "node:assert/strict";
import "dotenv/config";
import { closePool, getPool } from "../lib/db";
import { isUnambiguousLocalDatabase } from "../lib/env";
import { finalizeGameRatings } from "../lib/rating/ratingFinalizer";
import { assertSmokeDatabaseIdentity } from "../lib/smokeDatabase";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || !isUnambiguousLocalDatabase(databaseUrl)) {
  throw new Error("The Glicko-2 persistence smoke requires an isolated local DATABASE_URL.");
}

async function run(): Promise<void> {
  await assertSmokeDatabaseIdentity(getPool());
  const client = await getPool().connect();
  let transactionOpen = false;
  try {
    await client.query("BEGIN");
    transactionOpen = true;
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const accounts = await client.query<{ id: string }>(
      `INSERT INTO users (username)
       VALUES ($1), ($2)
       RETURNING id::text`,
      [`glicko-smoke-black-${suffix}`, `glicko-smoke-white-${suffix}`],
    );
    assert.equal(accounts.rowCount, 2);
    const blackKey = `user:${accounts.rows[0].id}`;
    const whiteKey = `user:${accounts.rows[1].id}`;
    const game = await client.query<{ id: string }>(
      `INSERT INTO games
         (board_size,black_player_key,white_player_key,winner_key,status,result,
          rules,phase,to_move,rules_profile,scoring_method,handicap,finish_reason,
          finished_at)
       VALUES (9,$1,$2,$1,'finished','B+R','chinese','play',NULL,
               'chinese-2002-gostone-v1','area',0,'resignation',statement_timestamp())
       RETURNING id::text`,
      [blackKey, whiteKey],
    );
    assert.equal(game.rowCount, 1);

    const first = await finalizeGameRatings(client, game.rows[0].id);
    const retry = await finalizeGameRatings(client, game.rows[0].id);
    assert.deepEqual(first, { rated: true, kind: "rated" });
    assert.deepEqual(retry, first);

    await client.query("SET CONSTRAINTS ALL IMMEDIATE");
    const evidence = await client.query<{
      event_count: number;
      state_count: number;
      minimum_games: number;
      maximum_games: number;
    }>(
      `SELECT
         (SELECT COUNT(*)::int FROM game_glicko2_rating_events WHERE game_id=$1) AS event_count,
         (SELECT COUNT(*)::int FROM player_glicko2_ratings WHERE player_key IN ($2,$3)) AS state_count,
         (SELECT MIN(rated_game_count)::int FROM player_glicko2_ratings WHERE player_key IN ($2,$3)) AS minimum_games,
         (SELECT MAX(rated_game_count)::int FROM player_glicko2_ratings WHERE player_key IN ($2,$3)) AS maximum_games`,
      [game.rows[0].id, blackKey, whiteKey],
    );
    assert.deepEqual(evidence.rows[0], {
      event_count: 2,
      state_count: 2,
      minimum_games: 1,
      maximum_games: 1,
    });

    await client.query("ROLLBACK");
    transactionOpen = false;
    console.log("Glicko-2 persistence smoke passed.");
  } finally {
    if (transactionOpen) await client.query("ROLLBACK");
    client.release();
    await closePool();
  }
}

void run();
