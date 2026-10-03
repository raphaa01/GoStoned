import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { closePool, getPool, query } from "../lib/db";
import { getDatabaseUrl, isUnambiguousLocalDatabase } from "../lib/env";
import { assertSmokeDatabaseIdentity } from "../lib/smokeDatabase";
import { AuthError } from "../lib/auth/accountService";
import { getBoardDesignPreference, updateBoardDesignPreference } from "../lib/boardDesignService";

async function main() {
  assert.ok(isUnambiguousLocalDatabase(getDatabaseUrl()), "Board-design smoke requires a local test database.");
  await assertSmokeDatabaseIdentity(getPool());
  const userId = randomUUID();
  const otherId = randomUUID();
  const player = `user:${userId}`;
  const other = `user:${otherId}`;
  const locked = (error: unknown) => error instanceof AuthError && error.status === 403;
  try {
    await query("INSERT INTO users(id,username) VALUES ($1,$2),($3,$4)", [userId, `skin_${userId}`, otherId, `skin_${otherId}`]);
    assert.deepEqual(await getBoardDesignPreference(userId), { design: "default", wins: 0 });
    assert.deepEqual(await updateBoardDesignPreference(userId, "light-oak"), { design: "light-oak", wins: 0 });
    await assert.rejects(updateBoardDesignPreference(userId, "dark-slate"), locked);

    // Opponent wins, draws, unfinished games and no-results do not unlock skins.
    await query(`INSERT INTO games(board_size,black_player_key,white_player_key,winner_key,status,finished_at)
      VALUES (9,$1,$2,$2,'finished',statement_timestamp()),
             (13,$1,$2,NULL,'finished',statement_timestamp()),
             (19,$1,$2,$1,'active',NULL),
             (19,$1,$2,NULL,'finished',statement_timestamp())`, [player, other]);
    assert.equal((await getBoardDesignPreference(userId)).wins, 0);
    for (const [threshold, design] of [[10, "dark-slate"], [20, "white-porcelain"], [30, "sage"], [50, "bordeaux"]] as const) {
      const current = (await getBoardDesignPreference(userId)).wins;
      // Rotate board sizes and modes; include wins as both black and white.
      await query(`INSERT INTO games(board_size,game_type,black_player_key,white_player_key,winner_key,status,finished_at)
        SELECT (ARRAY[9,13,19])[1 + (n % 3)], CASE WHEN n % 2 = 0 THEN 'friendly' ELSE 'matchmaking' END,
          CASE WHEN n % 2 = 0 THEN $1 ELSE $2 END, CASE WHEN n % 2 = 0 THEN $2 ELSE $1 END,
          $1, 'finished', statement_timestamp() FROM generate_series(1,$3::int) n`, [player, other, threshold - current - 1]);
      await assert.rejects(updateBoardDesignPreference(userId, design), locked);
      await query(`INSERT INTO games(board_size,game_type,black_player_key,white_player_key,winner_key,status,finished_at)
        VALUES (19,'friendly',$1,$2,$1,'finished',statement_timestamp())`, [player, other]);
      assert.deepEqual(await updateBoardDesignPreference(userId, design), { design, wins: threshold });
      assert.deepEqual(await getBoardDesignPreference(userId), { design, wins: threshold });
    }
    for (const design of ["ink-flow", "orbit", "glacier-glass", "kintsugi", "volcano"] as const) {
      await assert.rejects(updateBoardDesignPreference(userId, design), locked);
    }
    assert.equal((await getBoardDesignPreference(otherId)).design, "default", "Selection belongs only to the authenticated account.");
    console.log("Board designs: persistent selection, all win boundaries and account isolation passed.");
  } finally {
    await query("DELETE FROM games WHERE black_player_key = ANY($1::text[]) OR white_player_key = ANY($1::text[])", [[player, other]]);
    await query("DELETE FROM users WHERE id = ANY($1::uuid[])", [[userId, otherId]]);
  }
}

main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }).finally(closePool);
