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
  player_key: string;
  outcome_kind: "win" | "loss" | "draw" | "no_result";
  algorithm_version: string;
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
        if (sql.includes("INSERT INTO player_glicko2_ratings")) {
          return { rows: [], rowCount: 0 };
        }
        if (sql.includes("FROM player_glicko2_ratings") && sql.includes("FOR UPDATE")) {
          const rows = [...this.states.entries()]
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
          this.events.push({
            player_key: String(values[1]),
            outcome_kind: values[4] as StoredEvent["outcome_kind"],
            algorithm_version: String(values[21]),
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
  assert.equal(database.states.get(blackKey)?.count, 1);
  assert.equal(database.states.get(whiteKey)?.count, 1);
  assert.ok((database.states.get(blackKey)?.rating ?? 0) > 1200);
  assert.ok((database.states.get(whiteKey)?.rating ?? 0) < 1200);
});

test("Japanese repetition records immutable zero-change evidence without a rating period update", async () => {
  const database = new FakeRatingDatabase();
  database.finishReason = "japanese_repetition";
  database.result = "Void";
  database.winnerKey = null;

  assert.deepEqual(await database.run(), { rated: true, kind: "no_result" });
  assert.equal(database.events.length, 2);
  assert.equal(database.updateCount, 0);
  for (const event of database.events) {
    const values = event.values;
    assert.equal(event.outcome_kind, "no_result");
    assert.equal(values[5], null);
    assert.equal(values[11], values[12]);
    assert.equal(values[13], values[14]);
    assert.equal(values[15], values[16]);
    assert.equal(values[17], values[18]);
    assert.equal(values[19], values[20]);
  }
});

test("guest games remain unrated and cannot create global state or evidence", async () => {
  const database = new FakeRatingDatabase();
  database.registeredKeys.delete(whiteKey);

  assert.deepEqual(await database.run(), { rated: false, kind: "unrated" });
  assert.equal(database.events.length, 0);
  assert.equal(database.updateCount, 0);
});

test("partial pre-existing evidence fails closed", async () => {
  const database = new FakeRatingDatabase();
  database.events.push({
    player_key: blackKey,
    outcome_kind: "win",
    algorithm_version: "glicko2-v1-tau-0.5",
    values: [],
  });

  await assert.rejects(database.run(), (error: unknown) => {
    assert.ok(error instanceof GameServiceError);
    assert.equal(error.code, "rating_history_conflict");
    return true;
  });
  assert.equal(database.updateCount, 0);
});
