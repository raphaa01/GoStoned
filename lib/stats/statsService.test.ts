import assert from "node:assert/strict";
import test from "node:test";
import type { Pool } from "pg";
import { getLeaderboard, getPlayerProfileStats } from "./statsService";

async function withPool<T>(pool: Pool, action: () => Promise<T>): Promise<T> {
  const previous = globalThis.goStonedDbPool;
  globalThis.goStonedDbPool = pool;
  try {
    return await action();
  } finally {
    globalThis.goStonedDbPool = previous;
  }
}

test("leaderboard joins registered users and excludes guest or orphan stats", async () => {
  let statement = "";
  let values: readonly unknown[] = [];
  const observedAt = new Date("2026-07-28T10:00:00.000Z");
  const pool = {
    async query(sql: string, parameters: readonly unknown[]) {
      statement = sql.replace(/\s+/g, " ").trim();
      values = parameters;
      return {
        rows: [{
          observed_at: observedAt,
          entries: [{
            position: 1,
            playerName: "Registered Player",
            games: 4,
            wins: 3,
            rating: 1_232,
          }],
        }],
        rowCount: 1,
      };
    },
  } as unknown as Pool;

  const snapshot = await withPool(pool, () => getLeaderboard(9, 500));

  assert.match(statement, /FROM player_stats ps JOIN users u/);
  assert.match(statement, /ps\.player_key = 'user:' \|\| u\.id::text/);
  assert.doesNotMatch(statement, /LEFT JOIN users u/);
  assert.doesNotMatch(statement, /ps\.player_key LIKE 'guest:%'/);
  assert.match(statement, /ps\.games > 0/);
  assert.match(statement, /LEFT JOIN users black_user/);
  assert.match(statement, /LEFT JOIN users white_user/);
  assert.match(statement, /LEFT JOIN game_bots game_bot/);
  assert.match(statement, /game_bot\.target_rating/);
  assert.match(statement, /game_record\.black_player_key = game_bot\.bot_player_key/);
  assert.match(statement, /game_record\.white_player_key = game_bot\.bot_player_key/);
  assert.match(statement, /game_record\.status = 'finished'/);
  assert.match(statement, /history\.board_size = \$1/);
  assert.match(statement, /history\.player_key IN \( game_record\.black_player_key, game_record\.white_player_key \)/);
  assert.match(statement, /total_game_ledger_rows/);
  assert.match(statement, /COUNT\(DISTINCT player_key\) = 2/);
  assert.match(statement, /winner_key = player_key/);
  assert.match(statement, /BOOL_AND\(winner_key IS NULL\)/);
  assert.match(statement, /COUNT\(\*\) FILTER \(WHERE winner_key = player_key\) = 1/);
  assert.match(statement, /history_inventory/);
  assert.match(statement, /FROM player_rating_history WHERE board_size = \$1 GROUP BY player_key, board_size/);
  assert.match(statement, /inventory\.games = totals\.games/);
  assert.match(statement, /LAG\(rating_after, 1, initial_rating\)/);
  assert.match(statement, /rating_before = expected_rating_before/);
  assert.match(statement, /rating_after = rating_before \+ 16/);
  assert.match(statement, /rating_after = GREATEST\(100, rating_before - 16\)/);
  assert.match(statement, /ps\.games = totals\.games/);
  assert.match(statement, /ps\.wins = totals\.wins/);
  assert.match(statement, /ps\.losses = totals\.losses/);
  assert.match(statement, /ps\.draws = totals\.draws/);
  assert.match(statement, /ps\.rating = latest\.rating_after/);
  assert.match(statement, /ps\.rating >= 100/);
  assert.match(statement, /CHAR_LENGTH/);
  assert.match(
    statement,
    /ROW_NUMBER\(\) OVER \( ORDER BY rating DESC, games DESC, player_key ASC \)/,
  );
  assert.match(statement, /statement_timestamp\(\) AS observed_at/);
  assert.match(statement, /'playerName', player_name/);
  assert.doesNotMatch(statement, /highest_rating/);
  assert.doesNotMatch(statement, /updated_at/);
  assert.deepEqual(values, [9, 100]);
  assert.deepEqual(snapshot, {
    entries: [{
      position: 1,
      playerName: "Registered Player",
      games: 4,
      wins: 3,
      rating: 1_232,
    }],
    observedAt,
  });
});

test("leaderboard SQL accepts verified bot games while quarantining guest and mixed histories", async () => {
  let statement = "";
  const pool = {
    async query(sql: string) {
      statement = sql.replace(/\s+/g, " ").trim();
      return {
        rows: [{ observed_at: new Date("2026-07-28T10:00:00.000Z"), entries: [] }],
        rowCount: 1,
      };
    },
  } as unknown as Pool;

  await withPool(pool, () => getLeaderboard(19));

  assert.match(
    statement,
    /game_record\.black_player_key = 'user:' \|\| black_user\.id::text/,
  );
  assert.match(
    statement,
    /game_record\.white_player_key = 'user:' \|\| white_user\.id::text/,
  );
  assert.match(statement, /game_record\.black_player_key = game_bot\.bot_player_key/);
  assert.match(statement, /game_record\.white_player_key = game_bot\.bot_player_key/);
  assert.match(statement, /history\.player_key = game_bot\.bot_player_key THEN game_bot\.target_rating/);
  assert.match(
    statement,
    /SELECT COUNT\(\*\)::int FROM player_rating_history game_history WHERE game_history\.game_id = history\.game_id/,
  );
  assert.match(statement, /HAVING COUNT\(\*\) = 2/);
  assert.match(statement, /COUNT\(DISTINCT player_key\) = 2/);
  assert.match(statement, /total_game_ledger_rows = 2/);
  assert.match(statement, /winner_key IS NULL THEN result = 'draw'/);
  assert.match(statement, /winner_key = player_key THEN result = 'win'/);
  assert.match(statement, /inventory\.games = totals\.games/);
  assert.match(statement, /ps\.rating = latest\.rating_after/);
  assert.doesNotMatch(statement, /LIKE 'guest:%'/);
});

test("profiles retain guest games and distinguish unrated results from rated account games", async () => {
  const statements: string[] = [];
  const finishedAt = new Date("2026-07-28T10:00:00.000Z");
  const pool = {
    async query(sql: string) {
      const normalized = sql.replace(/\s+/g, " ").trim();
      statements.push(normalized);
      if (normalized.includes("FROM player_stats stats")) {
        return { rows: [], rowCount: 0 };
      }
      if (normalized.includes(") recent_history")) {
        return { rows: [], rowCount: 0 };
      }
      if (normalized.includes("ROW_NUMBER() OVER")) {
        return {
          rows: [
            {
              game_id: "guest-game",
              board_size: 9,
              time_control: "rapid",
              opponent_name: "Guest ABC123",
              result: "win",
              game_result: "B+R",
              rating_change: null,
              rated: false,
              finished_at: finishedAt,
            },
            {
              game_id: "partial-ledger-game",
              board_size: 9,
              time_control: "blitz",
              opponent_name: "Deleted player",
              result: "loss",
              game_result: "W+R",
              rating_change: -16,
              rated: false,
              finished_at: finishedAt,
            },
            {
              game_id: "account-game",
              board_size: 9,
              time_control: "classic",
              opponent_name: "Registered Opponent",
              result: "win",
              game_result: "W+3.5",
              rating_change: 16,
              rated: true,
              finished_at: finishedAt,
            },
          ],
          rowCount: 2,
        };
      }
      throw new Error(`Unexpected stats query: ${normalized}`);
    },
  } as unknown as Pool;

  const profile = await withPool(
    pool,
    () => getPlayerProfileStats("user:11111111-1111-4111-8111-111111111111"),
  );

  assert.deepEqual(
    profile.recentGames.map((game) => ({
      gameId: game.gameId,
      opponentName: game.opponentName,
      ratingChange: game.ratingChange,
      rated: game.rated,
    })),
    [
      {
        gameId: "guest-game",
        opponentName: "Guest ABC123",
        ratingChange: null,
        rated: false,
      },
      {
        gameId: "partial-ledger-game",
        opponentName: "Deleted player",
        ratingChange: -16,
        rated: false,
      },
      {
        gameId: "account-game",
        opponentName: "Registered Opponent",
        ratingChange: 16,
        rated: true,
      },
    ],
  );
  const recentGamesQuery = statements.find((sql) => sql.includes("ROW_NUMBER() OVER"));
  assert.ok(recentGamesQuery);
  assert.match(recentGamesQuery, /COUNT\(DISTINCT rated_history\.player_key\) = 2/);
  assert.match(
    recentGamesQuery,
    /rated_history\.player_key IN \( g\.black_player_key, g\.white_player_key \)/,
  );
  assert.doesNotMatch(recentGamesQuery, /history\.id IS NOT NULL AS rated/);
  assert.match(recentGamesQuery, /LEFT JOIN users black_user/);
  assert.match(recentGamesQuery, /LEFT JOIN users white_user/);
});
