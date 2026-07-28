import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import "dotenv/config";
import type { PoolClient } from "pg";
import { closePool, getPool } from "../lib/db";
import { isUnambiguousLocalDatabase } from "../lib/env";
import { applyMove, boardHash, createEmptyBoard } from "../lib/game/goEngine";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || !isUnambiguousLocalDatabase(databaseUrl)) {
  throw new Error("The move-hash database smoke requires an isolated local DATABASE_URL.");
}

type CatalogSnapshot = Readonly<{
  columnNotNull: boolean;
  constraints: ReadonlyArray<Readonly<{ definition: string; convalidated: boolean }>>;
}>;

async function catalogSnapshot(client: PoolClient): Promise<CatalogSnapshot> {
  const column = await client.query<{ attnotnull: boolean }>(
    `SELECT attnotnull
       FROM pg_attribute
      WHERE attrelid = 'public.moves'::regclass
        AND attname = 'board_hash'
        AND NOT attisdropped`,
  );
  assert.equal(column.rowCount, 1);
  const constraints = await client.query<{ definition: string; convalidated: boolean }>(
    `SELECT pg_get_constraintdef(oid) AS definition, convalidated
       FROM pg_constraint
      WHERE conname = 'moves_board_hash_required_check'
        AND conrelid = 'public.moves'::regclass
      ORDER BY definition, convalidated`,
  );
  return {
    columnNotNull: column.rows[0].attnotnull,
    constraints: constraints.rows,
  };
}

async function checkViolation(
  client: PoolClient,
  savepoint: string,
  operation: () => Promise<unknown>,
): Promise<void> {
  await client.query(`SAVEPOINT ${savepoint}`);
  let rejection: unknown;
  try {
    await operation();
  } catch (error) {
    rejection = error;
  }
  await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
  assert.equal(
    (rejection as { code?: string } | undefined)?.code,
    "23514",
    `${savepoint} must fail the move-hash CHECK constraint`,
  );
}

async function run(): Promise<void> {
  const migration = await readFile(
    path.join(process.cwd(), "db/migrations/010_move_board_hash_guard.sql"),
    "utf8",
  );
  const client = await getPool().connect();
  let transactionOpen = false;
  let fixtureGameId: string | null = null;
  let completed = false;
  let originalCatalog: CatalogSnapshot | null = null;
  try {
    originalCatalog = await catalogSnapshot(client);
    await client.query("BEGIN");
    transactionOpen = true;

    // Recreate the pre-010 catalog shape. Both changes are isolated to this
    // local transaction and the final ROLLBACK restores the original schema.
    await client.query(
      "ALTER TABLE public.moves DROP CONSTRAINT IF EXISTS moves_board_hash_required_check",
    );
    await client.query("ALTER TABLE public.moves ALTER COLUMN board_hash DROP NOT NULL");

    const game = await client.query<{ id: string }>(
      `INSERT INTO public.games (board_size, black_player_key, white_player_key)
       VALUES (9, $1, $2)
       RETURNING id`,
      [`guest:hash-smoke-black-${Date.now()}`, `guest:hash-smoke-white-${Date.now()}`],
    );
    const gameId = game.rows[0].id;
    fixtureGameId = gameId;
    const legacy = await client.query<{ id: string }>(
      `INSERT INTO public.moves
         (game_id, move_number, color, x, y, is_pass, board_hash)
       VALUES ($1, 1, 'black', 2, 2, FALSE, NULL)
       RETURNING id`,
      [gameId],
    );

    await client.query(migration);
    const preserved = await client.query<{ board_hash: string | null }>(
      "SELECT board_hash FROM public.moves WHERE id = $1",
      [legacy.rows[0].id],
    );
    assert.equal(preserved.rows[0].board_hash, null);

    await checkViolation(client, "new_null_insert", () => client.query(
      `INSERT INTO public.moves
         (game_id, move_number, color, x, y, is_pass, board_hash)
       VALUES ($1, 2, 'white', NULL, NULL, TRUE, NULL)`,
      [gameId],
    ));

    const placed = applyMove(createEmptyBoard(9), "black", 2, 2);
    assert.equal(placed.ok, true);
    if (!placed.ok) throw new Error("The smoke fixture move must be legal.");
    const validHash = boardHash(placed.board);
    const valid = await client.query<{ id: string }>(
      `INSERT INTO public.moves
         (game_id, move_number, color, x, y, is_pass, board_hash)
       VALUES ($1, 2, 'white', NULL, NULL, TRUE, $2)
       RETURNING id`,
      [gameId, validHash],
    );

    await checkViolation(client, "valid_to_null_update", () => client.query(
      "UPDATE public.moves SET board_hash = NULL WHERE id = $1",
      [valid.rows[0].id],
    ));
    await checkViolation(client, "legacy_null_update", () => client.query(
      "UPDATE public.moves SET created_at = created_at WHERE id = $1",
      [legacy.rows[0].id],
    ));
    const backfilled = await client.query<{ board_hash: string }>(
      "UPDATE public.moves SET board_hash = $2 WHERE id = $1 RETURNING board_hash",
      [legacy.rows[0].id, validHash],
    );
    assert.equal(backfilled.rowCount, 1);
    assert.equal(backfilled.rows[0].board_hash, validHash);

    await client.query(migration);
    const constraints = await client.query<{ count: number; convalidated: boolean }>(
      `SELECT COUNT(*)::int AS count, BOOL_AND(convalidated) AS convalidated
         FROM pg_constraint
        WHERE conname = 'moves_board_hash_required_check'
          AND conrelid = 'public.moves'::regclass`,
    );
    assert.equal(constraints.rows[0].count, 1);
    assert.equal(constraints.rows[0].convalidated, false);
    completed = true;
  } finally {
    try {
      if (transactionOpen) {
        await client.query("ROLLBACK");
        transactionOpen = false;
        if (fixtureGameId) {
          const fixture = await client.query<{ exists: boolean }>(
            "SELECT EXISTS (SELECT 1 FROM public.games WHERE id = $1) AS exists",
            [fixtureGameId],
          );
          assert.equal(fixture.rows[0].exists, false);
        }
        assert.ok(originalCatalog);
        assert.deepEqual(await catalogSnapshot(client), originalCatalog);
        if (completed) {
          console.log("Move-hash database guard smoke passed; rollback restoration verified.");
        }
      }
    } finally {
      client.release();
    }
  }
}

run()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(closePool);
