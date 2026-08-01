import assert from "node:assert/strict";
import test from "node:test";
import type { PoolClient } from "pg";
import { GameServiceError } from "@/lib/game/gameServiceError";
import { finalizeGameRatings } from "./ratingFinalizer";

const gameId = "11111111-1111-4111-8111-111111111111";
const blackKey = "user:22222222-2222-4222-8222-222222222222";
const whiteKey = "user:33333333-3333-4333-8333-333333333333";
const initialPeriod = new Date("2026-01-01T00:00:00.000Z");
const nextPeriod = new Date("2026-01-02T00:00:00.000Z");

type StoredEvent = {
  sql: string;
  player_key: string;
  outcome_kind: "win" | "loss" | "draw" | "no_result";
  algorithm_version: string;
  opponent_kind: "registered_human" | "calibrated_bot";
  values: unknown[];
};

class FakeRatingDatabase {
  readonly events: StoredEvent[] = [];
  readonly states = new Map([
    [blackKey, { rating: 1200, rd: 350, volatility: 0.06, count: 0, period: initialPeriod }],
    [whiteKey, { rating: 1200, rd: 350, volatility: 0.06, count: 0, period: initialPeriod }],
  ]);
  updateCount = 0;
  registeredKeys = new Set([blackKey, whiteKey]);
  finishReason = "resignation";
  result = "B+R";
  winnerKey: string | null = blackKey;
  calibratedBot = false;
  private lockTail = Promise.resolve();

  async run() {
    let unlock: (() => void) | undefined;
    const client = {
      query: async (sql: string, values: unknown[] = []) => {
        if (sql.includes("FROM games WHERE id=$1 FOR UPDATE")) {
          const previous = this.lockTail;
          this.lockTail = new Promise<void>((resolve) => { unlock = resolve; });
          await previous;
          return {
            rows: [{
              id: gameId,
              status: "finished",
              black_player_key: blackKey,
              white_player_key: whiteKey,
              winner_key: this.winnerKey,
              finish_reason: this.finishReason,
              result: this.result,
              finished_at: initialPeriod,
            }],
            rowCount: 1,
          };
        }
        if (sql.includes("FROM game_glicko2_rating_events") && sql.includes("FOR UPDATE")) {
          return {
            rows: this.events.map((event) => ({
              player_key: event.player_key,
              outcome_kind: event.outcome_kind,
              algorithm_version: event.algorithm_version,
              opponent_kind: event.opponent_kind,
            })),
            rowCount: this.events.length,
          };
        }
        if (sql.includes("AS player_key") && sql.includes("FROM users")) {
          const rows = [blackKey, whiteKey]
            .filter((key) => this.registeredKeys.has(key))
            .map((player_key) => ({ user_id: player_key.slice(5), player_key }));
          return { rows, rowCount: rows.length };
        }
        if (sql.includes("FROM game_calibrated_bot_bindings binding")) {
          return this.calibratedBot ? { rows: [{
            human_player_key: blackKey,
            bot_player_key: whiteKey,
            bot_color: "white",
            profile_id: "bot:katago:v1",
            profile_contract_version: "calibrated-bot-profile-v1",
            profile_fingerprint: `sha256:${"a".repeat(64)}`,
            binding_version: "bot-opponent-binding-v1",
            configuration_key: "b".repeat(64),
            credit_mode: "fixed-versioned-profile",
            opponent_rating: 1200,
            opponent_rating_deviation: 60,
            execution_complete: true,
          }], rowCount: 1 } : { rows: [], rowCount: 0 };
        }
        if (sql.includes("INSERT INTO player_glicko2_ratings")) {
          return { rows: [], rowCount: 0 };
        }
        if (sql.includes("FROM player_glicko2_ratings") && sql.includes("FOR UPDATE")) {
          const requestedKey = sql.includes("WHERE player_key=$1") ? String(values[0]) : null;
          const rows = [...this.states.entries()]
            .filter(([key]) => requestedKey === null || key === requestedKey)
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([player_key, state]) => ({
              player_key,
              rating: state.rating,
              rating_deviation: state.rd,
              volatility: state.volatility,
              rated_game_count: state.count,
              algorithm_version: "glicko2-v1-tau-0.5",
              last_rating_period_at: state.period,
            }));
          return { rows, rowCount: rows.length };
        }
        if (sql.includes("statement_timestamp() AS rating_period_at")) {
          return { rows: [{ rating_period_at: nextPeriod }], rowCount: 1 };
        }
        if (sql.includes("INSERT INTO game_glicko2_rating_events")) {
          const botEvent = sql.includes("'calibrated_bot'");
          this.events.push({
            sql,
            player_key: String(values[1]),
            outcome_kind: values[botEvent ? 10 : 4] as StoredEvent["outcome_kind"],
            algorithm_version: String(values[botEvent ? 28 : 21]),
            opponent_kind: botEvent ? "calibrated_bot" : "registered_human",
            values: [...values],
          });
          return { rows: [], rowCount: 1 };
        }
        if (sql.includes("UPDATE player_glicko2_ratings")) {
          const state = this.states.get(String(values[0]));
          assert.ok(state);
          state.rating = Number(values[1]);
          state.rd = Number(values[2]);
          state.volatility = Number(values[3]);
          state.count = Number(values[4]);
          state.period = values[6] as Date;
          this.updateCount += 1;
          return { rows: [], rowCount: 1 };
        }
        throw new Error(`Unexpected rating-finalizer query: ${sql}`);
      },
    } as unknown as PoolClient;
    try {
      return await finalizeGameRatings(client, gameId);
    } finally {
      unlock?.();
    }
  }
}

test("concurrent retries serialize on the game and persist one exact paired transition", async () => {
  const database = new FakeRatingDatabase();
  const [first, retry] = await Promise.all([database.run(), database.run()]);

  assert.deepEqual(first, { rated: true, kind: "rated" });
  assert.deepEqual(retry, { rated: true, kind: "rated" });
  assert.equal(database.events.length, 2);
  assert.equal(database.updateCount, 2);
  assert.deepEqual(database.events.map((event) => event.player_key), [blackKey, whiteKey]);
  assert.deepEqual(database.events.map((event) => event.outcome_kind), ["win", "loss"]);
  for (const event of database.events) {
    assert.match(event.sql, /SELECT terminal\.finished_at FROM games AS terminal/);
    assert.match(event.sql, /SELECT state\.last_rating_period_at/);
  }
  assert.equal(database.states.get(blackKey)?.count, 1);
  assert.equal(database.states.get(whiteKey)?.count, 1);
  assert.ok((database.states.get(blackKey)?.rating ?? 0) > 1200);
  assert.ok((database.states.get(whiteKey)?.rating ?? 0) < 1200);
});

test("guest games remain unrated and cannot create global state or evidence", async () => {
  const database = new FakeRatingDatabase();
  database.registeredKeys.delete(whiteKey);

  assert.deepEqual(await database.run(), { rated: false, kind: "unrated" });
  assert.equal(database.events.length, 0);
  assert.equal(database.updateCount, 0);
});

test("an exact calibrated binding updates only the registered human state", async () => {
  const database = new FakeRatingDatabase();
  database.registeredKeys.delete(whiteKey);
  database.states.delete(whiteKey);
  database.calibratedBot = true;

  assert.deepEqual(await database.run(), { rated: true, kind: "rated" });
  assert.equal(database.events.length, 1);
  assert.equal(database.events[0].opponent_kind, "calibrated_bot");
  assert.match(database.events[0].sql, /SELECT terminal\.finished_at FROM games AS terminal/);
  assert.match(database.events[0].sql, /SELECT state\.last_rating_period_at/);
  assert.equal(database.updateCount, 1);
  assert.ok((database.states.get(blackKey)?.rating ?? 0) > 1200);
});

test("partial pre-existing evidence fails closed", async () => {
  const database = new FakeRatingDatabase();
  database.events.push({
    sql: "",
    player_key: blackKey,
    outcome_kind: "win",
    algorithm_version: "glicko2-v1-tau-0.5",
    opponent_kind: "registered_human",
    values: [],
  });

  await assert.rejects(database.run(), (error: unknown) => {
    assert.ok(error instanceof GameServiceError);
    assert.equal(error.code, "rating_history_conflict");
    return true;
  });
  assert.equal(database.updateCount, 0);
});
