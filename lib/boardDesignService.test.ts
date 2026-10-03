import assert from "node:assert/strict";
import test from "node:test";
import type { Pool } from "pg";
import { getBoardDesignPreference, updateBoardDesignPreference } from "./boardDesignService";
import { AuthError } from "./auth/accountService";

test("server atomically requires earned wins and stores only the authenticated account's design", async () => {
  const previous = globalThis.goStonedDbPool;
  let calls = 0;
  globalThis.goStonedDbPool = { async query(sql: string, values: unknown[]) {
    calls++;
    assert.deepEqual(values, ["account-1", "dark-slate", 10]);
    assert.match(sql, /UPDATE users/);
    assert.match(sql, /winner_key = 'user:' \|\| users.id::text/);
    assert.match(sql, /status = 'finished' AND finished_at IS NOT NULL/);
    assert.match(sql, /WHERE id = \$1 AND/);
    assert.match(sql, />= \$3/);
    return { rows: calls === 1 ? [] : [{ board_design: "dark-slate", wins: 10 }] };
  } } as unknown as Pool;
  try {
    await assert.rejects(updateBoardDesignPreference("account-1", "dark-slate"), (error: unknown) => error instanceof AuthError && error.status === 403);
    assert.deepEqual(await updateBoardDesignPreference("account-1", "dark-slate"), { design: "dark-slate", wins: 10 });
    await assert.rejects(updateBoardDesignPreference("account-1", "orbit"), (error: unknown) => error instanceof AuthError && error.code === "board_design_locked");
    assert.equal(calls, 2, "coming-soon choices must never reach the database update");
  } finally { globalThis.goStonedDbPool = previous; }
});

test("reads count the full win history across board sizes and modes and safely fall back after removed wins", async () => {
  const previous = globalThis.goStonedDbPool;
  globalThis.goStonedDbPool = { async query(sql: string, values: unknown[]) {
    assert.deepEqual(values, ["account-1"]);
    assert.doesNotMatch(sql, /board_size|game_type|rated|LIMIT/);
    return { rows: [{ board_design: "sage", wins: 29 }] };
  } } as unknown as Pool;
  try { assert.deepEqual(await getBoardDesignPreference("account-1"), { design: "default", wins: 29 }); }
  finally { globalThis.goStonedDbPool = previous; }
});
