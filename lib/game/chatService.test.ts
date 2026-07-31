import assert from "node:assert/strict";
import test from "node:test";
import type { Pool, PoolClient } from "pg";
import { GameServiceError } from "./gameService";
import { getGameMessages, sendGameMessage } from "./chatService";

const gameId = "33333333-3333-4333-8333-333333333333";
const black = "user:11111111-1111-4111-8111-111111111111";
const white = "guest:22222222-2222-4222-8222-222222222222";

type StoredMessage = {
  id: string;
  playerKey: string;
  message: string;
  createdAt: Date;
};

class ChatPool {
  readonly blocks = new Set<string>();
  readonly messages: StoredMessage[] = [{
    id: "1",
    playerKey: black,
    message: "Good luck",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
  }];
  readonly statements: string[] = [];
  game: { black: string; white: string } | null = { black, white };

  isBlocked(first: string, second: string) {
    return this.blocks.has(`${first}\0${second}`)
      || this.blocks.has(`${second}\0${first}`);
  }

  async connect() {
    return {
      query: this.query.bind(this),
      release() {},
    } as unknown as PoolClient;
  }

  async query(sql: string, values: readonly unknown[] = []) {
    const normalized = sql.replace(/\s+/g, " ").trim();
    this.statements.push(normalized);
    if (["BEGIN", "COMMIT", "ROLLBACK"].includes(normalized) || normalized.startsWith("SET LOCAL")) {
      return { rows: [], rowCount: 0 };
    }
    if (normalized.startsWith("WITH participant AS") && normalized.includes("availability AS")) {
      const actor = String(values[1]);
      const game = this.game;
      if (
        !game
        || values[0] !== gameId
        || game.black === game.white
        || (actor !== game.black && actor !== game.white)
      ) {
        return { rows: [], rowCount: 0 };
      }
      const opponent = actor === game.black ? game.white : game.black;
      const available = !this.isBlocked(actor, opponent);
      const visible = available
        ? this.messages.filter(({ id }) => Number(id) > Number(values[2]))
        : [];
      const rows = visible.map((message) => ({
        available,
        id: message.id,
        player_key: message.playerKey,
        message: message.message,
        created_at: message.createdAt,
        player_name: message.playerKey === black ? "Black player" : "Guest Player",
      }));
      return {
        rows: rows.length > 0 ? rows : [{
          available,
          id: null,
          player_key: null,
          message: null,
          created_at: null,
          player_name: null,
        }],
        rowCount: Math.max(1, rows.length),
      };
    }
    if (normalized.includes("FROM games") && normalized.includes("$2 IN")) {
      const actor = String(values[1]);
      const game = this.game;
      const visible = game
        && values[0] === gameId
        && (actor === game.black || actor === game.white);
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
    if (normalized.startsWith("SELECT (") && normalized.includes("FROM player_blocks")) {
      return {
        rows: [{ blocked: this.isBlocked(String(values[0]), String(values[1])) }],
        rowCount: 1,
      };
    }
    if (normalized.startsWith("WITH inserted AS") && normalized.includes("game_messages")) {
      const createdAt = new Date("2026-01-01T00:01:00.000Z");
      const stored = {
        id: String(this.messages.length + 1),
        playerKey: String(values[1]),
        message: String(values[2]),
        createdAt,
      };
      this.messages.push(stored);
      return {
        rows: [{
          id: stored.id,
          player_key: stored.playerKey,
          message: stored.message,
          created_at: createdAt,
          player_name: "Black player",
        }],
        rowCount: 1,
      };
    }
    throw new Error(`Unexpected query: ${normalized}`);
  }
}

async function withPool<T>(pool: ChatPool, action: () => Promise<T>) {
  const previous = globalThis.goStonedDbPool;
  globalThis.goStonedDbPool = pool as unknown as Pool;
  try {
    return await action();
  } finally {
    globalThis.goStonedDbPool = previous;
  }
}

test("chat read checks membership, both block directions, and messages in one snapshot", async () => {
  const pool = new ChatPool();
  const chat = await withPool(pool, () => getGameMessages(gameId, black, 0));
  assert.deepEqual(chat, {
    available: true,
    messages: [{
      id: "1",
      playerKey: black,
      playerName: "Black player",
      message: "Good luck",
      createdAt: "2026-01-01T00:00:00.000Z",
    }],
  });
  assert.equal(pool.statements.length, 1);
  assert.match(pool.statements[0], /^WITH participant AS/);
  assert.match(pool.statements[0], /blocker_key = \$2 AND blocked_key = participant\.opponent_key/);
  assert.match(pool.statements[0], /blocker_key = participant\.opponent_key AND blocked_key = \$2/);
});

test("either block direction returns the same unavailable chat snapshot without stored messages", async (t) => {
  for (const direction of ["reader", "opponent"] as const) {
    await t.test(direction, async () => {
      const pool = new ChatPool();
      pool.blocks.add(direction === "reader" ? `${black}\0${white}` : `${white}\0${black}`);
      const chat = await withPool(pool, () => getGameMessages(gameId, black, 0));
      assert.deepEqual(chat, { available: false, messages: [] });
      assert.equal(pool.messages.length, 1);
    });
  }
});

test("either block direction rejects sends identically before retaining a new message", async (t) => {
  for (const direction of ["sender", "opponent"] as const) {
    await t.test(direction, async () => {
      const pool = new ChatPool();
      pool.blocks.add(direction === "sender" ? `${black}\0${white}` : `${white}\0${black}`);
      await assert.rejects(
        withPool(pool, () => sendGameMessage(gameId, black, "Hello")),
        (error) => error instanceof GameServiceError
          && error.status === 409
          && error.code === "chat_unavailable",
      );
      assert.equal(pool.messages.length, 1);
      assert.equal(pool.statements.some((sql) => sql.startsWith("WITH inserted AS")), false);
    });
  }
});

test("chat send locks and rechecks the pair before inserting", async () => {
  const pool = new ChatPool();
  const message = await withPool(pool, () => sendGameMessage(gameId, black, "  Hello  "));
  assert.equal(message.message, "Hello");
  const participantIndex = pool.statements.findIndex((sql) => sql.includes("FROM games"));
  const lockIndex = pool.statements.findIndex((sql) => sql.includes("pg_advisory_xact_lock"));
  const blockIndex = pool.statements.findIndex((sql) => sql.startsWith("SELECT ("));
  const insertIndex = pool.statements.findIndex((sql) => sql.startsWith("WITH inserted AS"));
  assert.ok(participantIndex < lockIndex && lockIndex < blockIndex && blockIndex < insertIndex);
});

test("chat read keeps missing games and outsiders indistinguishable", async () => {
  const outsider = "user:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  for (const setup of ["missing", "outsider"] as const) {
    const pool = new ChatPool();
    if (setup === "missing") pool.game = null;
    await assert.rejects(
      withPool(pool, () => getGameMessages(gameId, outsider, 0)),
      (error) => error instanceof GameServiceError
        && error.status === 404
        && error.code === "game_not_found"
        && error.message === "Game not found.",
    );
  }
});

test("chat read hides a corrupt same-player game behind the private not-found boundary", async () => {
  const pool = new ChatPool();
  pool.game = { black, white: black };
  await assert.rejects(
    withPool(pool, () => getGameMessages(gameId, black, 0)),
    (error) => error instanceof GameServiceError
      && error.status === 404
      && error.code === "game_not_found",
  );
  assert.equal(pool.statements.length, 1);
  assert.match(pool.statements[0], /black_player_key <> white_player_key/);
});
