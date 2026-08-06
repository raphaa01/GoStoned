import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import type { Pool, PoolClient } from "pg";
import { GET as readPuzzles } from "@/app/api/puzzles/route";
import { GameServiceError } from "@/lib/game/gameService";
import { attemptPuzzle } from "./puzzleService";

const puzzleId = "11111111-1111-4111-8111-111111111111";

async function withPool<T>(pool: Pool, action: () => Promise<T>): Promise<T> {
  const previous = globalThis.goStonedDbPool;
  globalThis.goStonedDbPool = pool;
  try {
    return await action();
  } finally {
    globalThis.goStonedDbPool = previous;
  }
}

test("personal puzzle catalogs require an account before database access", async () => {
  let databaseCalls = 0;
  const pool = {
    async query() {
      databaseCalls += 1;
      throw new Error("Guest practice requests must stop before database access.");
    },
    async connect() {
      databaseCalls += 1;
      throw new Error("Guest practice requests must not open a transaction.");
    },
  } as unknown as Pool;

  const response = await withPool(pool, () => readPuzzles(new NextRequest(
    "https://gostone.test/api/puzzles?mode=practice",
  )));

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), {
    ok: false,
    error: "Please log in first.",
    code: "authentication_required",
  });
  assert.equal(databaseCalls, 0);
});

test("guest attempts cannot mutate a personal puzzle", async () => {
  const statements: string[] = [];
  const client = {
    async query(sql: string) {
      statements.push(sql);
      if (sql.includes("FROM puzzles puzzle")) {
        return { rows: [{ kind: "practice" }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    },
    release() {},
  } as unknown as PoolClient;
  const pool = {
    async connect() {
      return client;
    },
  } as unknown as Pool;

  await assert.rejects(
    withPool(pool, () => attemptPuzzle(
      puzzleId,
      "guest:22222222-2222-4222-8222-222222222222",
      { x: 0, y: 0, revision: 0 },
      false,
    )),
    (error: unknown) => (
      error instanceof GameServiceError
      && error.status === 401
      && error.code === "authentication_required"
    ),
  );
  assert.equal(statements.some((sql) => sql.includes("INSERT INTO puzzle_attempts")), false);
  assert.equal(statements.at(-1), "ROLLBACK");
});
