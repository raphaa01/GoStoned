import assert from "node:assert/strict";
import test from "node:test";
import type { Pool, PoolClient } from "pg";
import { GameServiceError } from "@/lib/game/gameService";
import {
  isPlayerReportCategory,
  PLAYER_REPORT_CATEGORIES,
} from "./playerReportContract";
import { reportGameOpponent } from "./playerReportService";

const gameId = "33333333-3333-4333-8333-333333333333";
const accountPlayer = "user:11111111-1111-4111-8111-111111111111";
const guestPlayer = "guest:22222222-2222-4222-8222-222222222222";

type StoredReport = {
  gameId: string;
  reporter: string;
  reported: string;
  category: string;
};

class ReportPool {
  readonly reports = new Map<string, StoredReport>();
  readonly statements: Array<{ sql: string; values: readonly unknown[] }> = [];
  game: { id: string; black: string; white: string } | null = {
    id: gameId,
    black: accountPlayer,
    white: guestPlayer,
  };

  async connect() {
    return {
      query: this.query.bind(this),
      release() {},
    } as unknown as PoolClient;
  }

  async query(sql: string, values: readonly unknown[] = []) {
    const normalized = sql.replace(/\s+/g, " ").trim();
    this.statements.push({ sql: normalized, values });
    if (["BEGIN", "COMMIT", "ROLLBACK"].includes(normalized) || normalized.startsWith("SET LOCAL")) {
      return { rows: [], rowCount: 0 };
    }
    if (normalized.includes("FROM games") && normalized.includes("$2 IN")) {
      const actor = String(values[1]);
      const game = this.game;
      const visible = game
        && game.id === values[0]
        && (game.black === actor || game.white === actor);
      return {
        rows: visible ? [{
          black_player_key: game!.black,
          white_player_key: game!.white,
        }] : [],
        rowCount: visible ? 1 : 0,
      };
    }
    if (normalized.startsWith("INSERT INTO player_reports")) {
      const key = `${values[0]}\0${values[1]}`;
      if (!this.reports.has(key)) {
        this.reports.set(key, {
          gameId: String(values[0]),
          reporter: String(values[1]),
          reported: String(values[2]),
          category: String(values[3]),
        });
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }
    throw new Error(`Unexpected query: ${normalized}`);
  }
}

async function withPool<T>(pool: ReportPool, action: () => Promise<T>) {
  const previous = globalThis.goStonedDbPool;
  globalThis.goStonedDbPool = pool as unknown as Pool;
  try {
    return await action();
  } finally {
    globalThis.goStonedDbPool = previous;
  }
}

test("report categories are finite stable codes", () => {
  assert.deepEqual(PLAYER_REPORT_CATEGORIES, [
    "abuse_or_hate",
    "threat_or_sexual_safety",
    "fair_play",
    "stalling_or_abandonment",
    "spam_scam_or_identity",
    "other",
  ]);
  for (const category of PLAYER_REPORT_CATEGORIES) {
    assert.equal(isPlayerReportCategory(category), true);
  }
  for (const value of [null, "", "Abuse", "moderator_status", 1]) {
    assert.equal(isPlayerReportCategory(value), false);
  }
});

test("both participants can report only the server-derived opponent", async () => {
  const pool = new ReportPool();
  await withPool(pool, async () => {
    assert.deepEqual(
      await reportGameOpponent(gameId, accountPlayer, "abuse_or_hate"),
      { reported: true },
    );
    assert.deepEqual(
      await reportGameOpponent(gameId, guestPlayer, "fair_play"),
      { reported: true },
    );
  });

  assert.deepEqual([...pool.reports.values()], [
    {
      gameId,
      reporter: accountPlayer,
      reported: guestPlayer,
      category: "abuse_or_hate",
    },
    {
      gameId,
      reporter: guestPlayer,
      reported: accountPlayer,
      category: "fair_play",
    },
  ]);
  const participantReads = pool.statements.filter(({ sql }) => sql.includes("FROM games"));
  assert.ok(participantReads.every(({ sql }) => sql.endsWith("FOR KEY SHARE")));
});

test("sequential and concurrent retries preserve the first category", async () => {
  const pool = new ReportPool();
  await withPool(pool, async () => {
    await reportGameOpponent(gameId, accountPlayer, "fair_play");
    await reportGameOpponent(gameId, accountPlayer, "other");
    const receipts = await Promise.all(
      Array.from({ length: 20 }, (_, index) => reportGameOpponent(
        gameId,
        accountPlayer,
        index % 2 === 0 ? "abuse_or_hate" : "stalling_or_abandonment",
      )),
    );
    assert.ok(receipts.every((receipt) => receipt.reported));
  });

  assert.equal(pool.reports.size, 1);
  assert.equal(pool.reports.get(`${gameId}\0${accountPlayer}`)?.category, "fair_play");
  const inserts = pool.statements.filter(({ sql }) => sql.startsWith("INSERT INTO player_reports"));
  assert.ok(inserts.every(({ sql }) => /ON CONFLICT \(game_id, reporter_key\) DO NOTHING/.test(sql)));
  assert.equal(
    pool.statements.some(({ sql }) => /player_blocks|pg_advisory_xact_lock|matchmaking_queue/.test(sql)),
    false,
  );
});

test("invalid categories fail before opening a transaction", async () => {
  const pool = new ReportPool();
  await assert.rejects(
    withPool(pool, () => reportGameOpponent(gameId, accountPlayer, "staff_note")),
    (error) => error instanceof GameServiceError
      && error.status === 400
      && error.code === "invalid_report_category",
  );
  assert.equal(pool.statements.length, 0);
});

test("missing games and outsiders share the same private error", async () => {
  const outsider = "user:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const observed: Array<{ status: number; code: string; message: string }> = [];
  for (const setup of ["missing", "outsider"] as const) {
    const pool = new ReportPool();
    if (setup === "missing") pool.game = null;
    try {
      await withPool(pool, () => reportGameOpponent(gameId, outsider, "other"));
      assert.fail("Expected a private game error");
    } catch (error) {
      assert.ok(error instanceof GameServiceError);
      observed.push({ status: error.status, code: error.code, message: error.message });
    }
    assert.equal(pool.reports.size, 0);
  }
  assert.deepEqual(observed, [
    { status: 404, code: "game_not_found", message: "Game not found." },
    { status: 404, code: "game_not_found", message: "Game not found." },
  ]);
});

test("a corrupt same-player game fails without report or pair-lock access", async () => {
  const pool = new ReportPool();
  pool.game = { id: gameId, black: accountPlayer, white: accountPlayer };
  await assert.rejects(
    withPool(pool, () => reportGameOpponent(gameId, accountPlayer, "other")),
    (error) => error instanceof GameServiceError
      && error.status === 409
      && error.code === "opponent_unavailable",
  );
  assert.equal(pool.reports.size, 0);
  assert.equal(
    pool.statements.some(({ sql }) => sql.includes("pg_advisory_xact_lock")),
    false,
  );
});
