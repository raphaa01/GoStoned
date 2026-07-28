import assert from "node:assert/strict";
import test from "node:test";
import type { Pool, PoolClient } from "pg";
import { GameServiceError } from "@/lib/game/gameService";
import {
  getGameOpponentBlockState,
  isPlayerPairBlocked,
  playerPairLockSubject,
  setGameOpponentBlocked,
} from "./playerBlockService";

const gameId = "33333333-3333-4333-8333-333333333333";
const accountPlayer = "user:11111111-1111-4111-8111-111111111111";
const guestPlayer = "guest:22222222-2222-4222-8222-222222222222";

class BlockPool {
  readonly blocks = new Set<string>();
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
    if (normalized.includes("pg_advisory_xact_lock")) {
      return { rows: [{}], rowCount: 1 };
    }
    if (normalized.startsWith("SELECT EXISTS") && normalized.includes("FROM player_blocks")) {
      return {
        rows: [{ blocked: this.blocks.has(`${values[0]}\0${values[1]}`) }],
        rowCount: 1,
      };
    }
    if (normalized.startsWith("SELECT (") && normalized.includes("FROM player_blocks")) {
      const forward = `${values[0]}\0${values[1]}`;
      const reverse = `${values[1]}\0${values[0]}`;
      return {
        rows: [{ blocked: this.blocks.has(forward) || this.blocks.has(reverse) }],
        rowCount: 1,
      };
    }
    if (normalized.startsWith("INSERT INTO player_blocks")) {
      this.blocks.add(`${values[0]}\0${values[1]}`);
      return { rows: [], rowCount: 1 };
    }
    if (normalized.startsWith("DELETE FROM player_blocks")) {
      const deleted = this.blocks.delete(`${values[0]}\0${values[1]}`);
      return { rows: [], rowCount: deleted ? 1 : 0 };
    }
    throw new Error(`Unexpected query: ${normalized}`);
  }
}

async function withPool<T>(pool: BlockPool, action: () => Promise<T>) {
  const previous = globalThis.goStonedDbPool;
  globalThis.goStonedDbPool = pool as unknown as Pool;
  try {
    return await action();
  } finally {
    globalThis.goStonedDbPool = previous;
  }
}

test("pair lock subjects are symmetric and locale-independent", () => {
  const expected = `player-pair:v1:${JSON.stringify([guestPlayer, accountPlayer])}`;
  assert.equal(playerPairLockSubject(accountPlayer, guestPlayer), expected);
  assert.equal(playerPairLockSubject(guestPlayer, accountPlayer), expected);
});

test("account and secure guest participants idempotently block only the game opponent", async () => {
  const pool = new BlockPool();
  await withPool(pool, async () => {
    assert.deepEqual(await setGameOpponentBlocked(gameId, accountPlayer, true), {
      blocked: true,
    });
    assert.deepEqual(await setGameOpponentBlocked(gameId, accountPlayer, true), {
      blocked: true,
    });
    assert.deepEqual(await getGameOpponentBlockState(gameId, accountPlayer), {
      blocked: true,
    });
    assert.deepEqual(await getGameOpponentBlockState(gameId, guestPlayer), {
      blocked: false,
    });
  });

  assert.deepEqual([...pool.blocks], [`${accountPlayer}\0${guestPlayer}`]);
  const inserts = pool.statements.filter(({ sql }) => sql.startsWith("INSERT INTO player_blocks"));
  assert.deepEqual(inserts.map(({ values }) => values), [
    [accountPlayer, guestPlayer],
    [accountPlayer, guestPlayer],
  ]);
  const gameLookup = pool.statements.find(({ sql }) => sql.includes("FROM games"));
  assert.match(gameLookup?.sql ?? "", /\$2 IN \(black_player_key, white_player_key\)/);
});

test("unblock is idempotent and removes only the actor's direction", async () => {
  const pool = new BlockPool();
  pool.blocks.add(`${accountPlayer}\0${guestPlayer}`);
  pool.blocks.add(`${guestPlayer}\0${accountPlayer}`);

  await withPool(pool, async () => {
    assert.deepEqual(await setGameOpponentBlocked(gameId, accountPlayer, false), {
      blocked: false,
    });
    assert.deepEqual(await setGameOpponentBlocked(gameId, accountPlayer, false), {
      blocked: false,
    });
  });

  assert.deepEqual([...pool.blocks], [`${guestPlayer}\0${accountPlayer}`]);
});

test("missing games and outsiders have the same private error", async () => {
  const outsider = "user:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  for (const setup of ["missing", "outsider"] as const) {
    const pool = new BlockPool();
    if (setup === "missing") pool.game = null;
    await assert.rejects(
      withPool(pool, () => getGameOpponentBlockState(gameId, outsider)),
      (error) => error instanceof GameServiceError
        && error.status === 404
        && error.code === "game_not_found"
        && error.message === "Game not found.",
    );
  }
});

test("a corrupt same-player game fails before pair locks or block access", async () => {
  const pool = new BlockPool();
  pool.game = { id: gameId, black: accountPlayer, white: accountPlayer };

  await assert.rejects(
    withPool(pool, () => setGameOpponentBlocked(gameId, accountPlayer, true)),
    (error) => error instanceof GameServiceError
      && error.status === 409
      && error.code === "opponent_unavailable",
  );

  assert.equal(
    pool.statements.some(({ sql }) => sql.includes("pg_advisory_xact_lock")),
    false,
  );
  assert.equal(
    pool.statements.some(({ sql }) => sql.includes("INSERT INTO player_blocks")),
    false,
  );
});

test("symmetric availability checks do not reveal the blocking direction", async () => {
  const pool = new BlockPool();
  pool.blocks.add(`${guestPlayer}\0${accountPlayer}`);
  const client = await pool.connect();
  assert.equal(await isPlayerPairBlocked(client, accountPlayer, guestPlayer), true);
  assert.equal(await isPlayerPairBlocked(client, guestPlayer, accountPlayer), true);
});
