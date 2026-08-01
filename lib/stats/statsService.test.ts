import assert from "node:assert/strict";
import test from "node:test";
import type { Pool } from "pg";
import {
  getCurrentRatingIdentity,
  getLeaderboard,
  getPlayerProfileStats,
} from "./statsService";

async function withPool<T>(pool: Pool, action: () => Promise<T>): Promise<T> {
  const previous = globalThis.goStonedDbPool;
  globalThis.goStonedDbPool = pool;
  try { return await action(); } finally { globalThis.goStonedDbPool = previous; }
}

test("leaderboard is global, established, opponent-filterable, and uncertainty-aware", async () => {
  let statement = "";
  let values: readonly unknown[] = [];
  const observedAt = new Date("2026-07-28T10:00:00.000Z");
  const pool = { async query(sql: string, parameters: readonly unknown[]) {
    statement = sql.replace(/\s+/g, " ").trim(); values = parameters;
    return { rows: [{ observed_at: observedAt, entries: [{ position: 1, playerName: "Player", games: 12, wins: 7, rating: 1232.4, ratingDeviation: 61.2 }] }], rowCount: 1 };
  } } as unknown as Pool;
  const snapshot = await withPool(pool, () => getLeaderboard(500));
  assert.match(statement, /FROM player_glicko2_ratings rating JOIN users account/);
  assert.match(statement, /FROM game_glicko2_rating_events WHERE \$2::text = 'all-rated' OR opponent_kind = 'registered_human' GROUP BY player_key/);
  assert.match(statement, /rating\.rated_game_count >= 10/);
  assert.match(statement, /rating\.rated_game_count = totals\.games/);
  assert.match(statement, /ORDER BY rating DESC, rating_deviation ASC, games DESC, player_key ASC/);
  assert.doesNotMatch(statement, /player_stats|player_rating_history|game_bots|board_size/);
  assert.deepEqual(values, [100, "all-rated"]);
  assert.equal(snapshot.observedAt, observedAt);
  assert.equal(snapshot.opponentScope, "all-rated");
});

test("human-only leaderboard statistics exclude calibrated-bot opponents", async () => {
  let values: readonly unknown[] = [];
  const pool = { async query(_sql: string, parameters: readonly unknown[]) {
    values = parameters;
    return { rows: [{ observed_at: new Date(), entries: [] }], rowCount: 1 };
  } } as unknown as Pool;
  const snapshot = await withPool(pool, () => getLeaderboard(50, "human-only"));
  assert.deepEqual(values, [50, "human-only"]);
  assert.equal(snapshot.opponentScope, "human-only");
});

test("current rating identity reads only the authenticated player's global rating", async () => {
  let statement = "";
  let values: readonly unknown[] = [];
  const pool = { async query(sql: string, parameters: readonly unknown[]) {
    statement = sql.replace(/\s+/g, " ").trim();
    values = parameters;
    return { rows: [{
      rating: 1642.4,
      rating_deviation: 58.2,
      is_provisional: false,
      display_preference: "both",
    }], rowCount: 1 };
  } } as unknown as Pool;
  const rating = await withPool(
    pool,
    () => getCurrentRatingIdentity("user:11111111-1111-4111-8111-111111111111"),
  );
  assert.match(statement, /FROM player_glicko2_ratings rating/);
  assert.match(statement, /JOIN player_rating_preferences preference ON preference\.user_id = rating\.user_id/);
  assert.match(statement, /WHERE rating\.player_key = \$1 LIMIT 1/);
  assert.deepEqual(values, ["user:11111111-1111-4111-8111-111111111111"]);
  assert.deepEqual(rating, {
    value: 1642.4,
    deviation: 58.2,
    isProvisional: false,
    displayPreference: "both",
  });
});

test("profile reads the global ledger, preferences, and bot disclosure", async () => {
  const statements: string[] = [];
  const at = new Date("2026-07-28T10:00:00.000Z");
  const pool = { async query(sql: string) {
    const normalized = sql.replace(/\s+/g, " ").trim(); statements.push(normalized);
    if (normalized.includes("FROM player_glicko2_ratings rating")) return { rows: [{
      rating: 1320, rating_deviation: 80, volatility: 0.06, rated_game_count: 12,
      is_provisional: false, algorithm_version: "glicko2-v1-tau-0.5",
      last_rating_period_at: at, highest_rating: 1340, rating_change_30_days: 25,
      display_preference: "both", bot_match_preference: "never",
      handicap_preference: "even-only", preference_revision: 1,
      starting_strength_estimate: "beginner", known_rank: null,
    }], rowCount: 1 };
    if (normalized.includes("event.game_id || ':'")) return { rows: [], rowCount: 0 };
    if (normalized.includes("FROM games game_record")) return { rows: [{
      game_id: "game-1", board_size: 19, time_control: "rapid", opponent_name: "KataGo",
      opponent_is_bot: true, opponent_bot_profile_version: null, result: "no-result",
      game_result: "Void", rating_before: 1320, rating_after: 1320, rating_change: 0,
      rated: true, finished_at: at, move_count: 80,
    }], rowCount: 1 };
    throw new Error(`Unexpected query: ${normalized}`);
  } } as unknown as Pool;
  const profile = await withPool(pool, () => getPlayerProfileStats("user:11111111-1111-4111-8111-111111111111"));
  assert.equal(profile.rating.rating, 1320);
  assert.equal(profile.preferences.botMatchPreference, "never");
  assert.deepEqual(profile.recentGames[0], {
    gameId: "game-1", boardSize: 19, timeControl: "rapid", opponentName: "KataGo",
    opponentIsBot: true, opponentBotProfileVersion: null, result: "no-result",
    gameResult: "Void", ratingBefore: 1320, ratingAfter: 1320, ratingChange: 0,
    rated: true, finishedAt: at.toISOString(), moveCount: 80,
  });
  const recentSql = statements.find((sql) => sql.includes("FROM games game_record"));
  assert.ok(recentSql);
  assert.match(recentSql, /LEFT JOIN game_glicko2_rating_events rating_event/);
  assert.match(recentSql, /rating_event\.opponent_kind IN \('calibrated_bot','browser_bot'\)/);
  assert.doesNotMatch(recentSql, /player_rating_history/);
});
