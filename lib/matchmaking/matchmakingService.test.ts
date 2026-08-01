import assert from "node:assert/strict";
import test from "node:test";
import type { Pool } from "pg";
import {
  cancelMatchmaking,
  getMatchmakingStatus,
  joinMatchmaking,
} from "./matchmakingService";

type StoredQueue = {
  player_key: string;
  board_size: 9 | 13 | 19;
  time_control: "blitz" | "rapid" | "classic";
  rules_profile: string;
  status: "waiting" | "matched";
  game_id: string | null;
  created_at: Date;
  updated_at: Date;
};

type StoredGame = {
  id: string;
  board_size: 9 | 13 | 19;
  black_player_key: string;
  white_player_key: string;
  time_control: "blitz" | "rapid" | "classic";
  rules: string;
  rules_profile: string;
  scoring_method: string;
  komi: number;
  handicap: number;
  to_move: string;
  main_time_seconds: number;
  byo_yomi_periods: number;
  byo_yomi_seconds: number;
  black_time_remaining_ms: number;
  white_time_remaining_ms: number;
  status: "active" | "finished";
  started_at: Date;
};

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

class LockQueue {
  private readonly tails = new Map<string, Promise<void>>();
  private readonly held = new Set<string>();

  isHeld(key: string) {
    return this.held.has(key);
  }

  async acquire(key: string): Promise<() => void> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    const current = deferred();
    this.tails.set(key, previous.then(() => current.promise));
    await previous;
    this.held.add(key);
    return () => {
      this.held.delete(key);
      current.resolve();
    };
  }
}

class MatchmakingPool {
  readonly queue = new Map<string, StoredQueue>();
  readonly games = new Map<string, StoredGame>();
  readonly blocks = new Set<string>();
  readonly locks = new LockQueue();
  readonly opponentLocked = deferred();
  readonly continueAfterOpponent = deferred();
  readonly cancellationWaiting = deferred();
  readonly cancellationLocked = deferred();
  readonly continueAfterCancellation = deferred();
  pauseAfterOpponent = false;
  pauseAfterCancellation = false;
  publicationRowCountOverride: number | null = null;
  blockOnPairRecheck: [string, string] | null = null;
  blockRechecksRemaining = 0;
  pairRecheckCount = 0;
  private gameSequence = 0;

  seedWaiting(
    playerKey: string,
    timeControl: StoredQueue["time_control"] = "rapid",
    boardSize: StoredQueue["board_size"] = 9,
  ) {
    const now = new Date();
    this.queue.set(playerKey, {
      player_key: playerKey,
      board_size: boardSize,
      time_control: timeControl,
      rules_profile: "japanese-1989-gostone-v1",
      status: "waiting",
      game_id: null,
      created_at: now,
      updated_at: now,
    });
  }

  seedActiveGame(
    blackPlayerKey: string,
    whitePlayerKey: string,
    timeControl: StoredGame["time_control"] = "rapid",
    boardSize: StoredGame["board_size"] = 9,
  ) {
    const id = this.nextGameId();
    this.games.set(id, {
      id,
      board_size: boardSize,
      black_player_key: blackPlayerKey,
      white_player_key: whitePlayerKey,
      time_control: timeControl,
      rules: "chinese",
      rules_profile: "chinese-2002-gostone-v1",
      scoring_method: "area",
      komi: 7.5,
      handicap: 0,
      to_move: "black",
      main_time_seconds: 900,
      byo_yomi_periods: 5,
      byo_yomi_seconds: 30,
      black_time_remaining_ms: 900_000,
      white_time_remaining_ms: 900_000,
      status: "active",
      started_at: new Date(),
    });
    return id;
  }

  seedBlock(blockerKey: string, blockedKey: string) {
    this.blocks.add(`${blockerKey}\0${blockedKey}`);
  }

  isPairBlocked(firstPlayerKey: string, secondPlayerKey: string) {
    return this.blocks.has(`${firstPlayerKey}\0${secondPlayerKey}`)
      || this.blocks.has(`${secondPlayerKey}\0${firstPlayerKey}`);
  }

  async connect() {
    return new MatchmakingClient(this);
  }

  async query(sql: string, values: readonly unknown[] = []) {
    const normalized = sql.replace(/\s+/g, " ").trim();
    if (normalized.includes("FROM matchmaking_queue q") && !normalized.includes("FOR UPDATE")) {
      const row = this.queue.get(String(values[0]));
      return { rows: row ? [this.queueResult(row)] : [], rowCount: row ? 1 : 0 };
    }
    throw new Error(`Unexpected pool query: ${normalized}`);
  }

  queueResult(row: StoredQueue) {
    return {
      ...row,
      game_status: row.game_id ? this.games.get(row.game_id)?.status ?? null : null,
      is_stale: row.updated_at.getTime() < Date.now() - 5 * 60_000,
    };
  }

  nextGameId() {
    this.gameSequence += 1;
    return `00000000-0000-4000-8000-${String(this.gameSequence).padStart(12, "0")}`;
  }
}

class MatchmakingClient {
  private readonly localQueue = new Map<string, StoredQueue | null>();
  private readonly localGames = new Map<string, StoredGame>();
  private readonly releases: Array<() => void> = [];
  private readonly heldRows = new Set<string>();

  constructor(private readonly pool: MatchmakingPool) {}

  release() {}

  private viewQueue(playerKey: string) {
    if (this.localQueue.has(playerKey)) return this.localQueue.get(playerKey) ?? undefined;
    return this.pool.queue.get(playerKey);
  }

  private viewGame(gameId: string) {
    return this.localGames.get(gameId) ?? this.pool.games.get(gameId);
  }

  private async lockRow(playerKey: string) {
    if (this.heldRows.has(playerKey)) return;
    if (this.pool.locks.isHeld(`row:${playerKey}`)) {
      this.pool.cancellationWaiting.resolve();
    }
    const release = await this.pool.locks.acquire(`row:${playerKey}`);
    this.heldRows.add(playerKey);
    this.releases.push(release);
  }

  private finish(commit: boolean) {
    if (commit) {
      for (const [playerKey, row] of this.localQueue) {
        if (row) this.pool.queue.set(playerKey, row);
        else this.pool.queue.delete(playerKey);
      }
      for (const [gameId, game] of this.localGames) this.pool.games.set(gameId, game);
    }
    while (this.releases.length > 0) this.releases.pop()?.();
  }

  async query(sql: string, values: readonly unknown[] = []) {
    const normalized = sql.replace(/\s+/g, " ").trim();
    if (normalized === "BEGIN" || normalized.startsWith("SET LOCAL")) {
      return { rows: [], rowCount: 0 };
    }
    if (normalized === "COMMIT") {
      this.finish(true);
      return { rows: [], rowCount: 0 };
    }
    if (normalized === "ROLLBACK") {
      this.finish(false);
      return { rows: [], rowCount: 0 };
    }
    if (normalized.includes("pg_advisory_xact_lock")) {
      const release = await this.pool.locks.acquire(`advisory:${String(values[0])}`);
      this.releases.push(release);
      return { rows: [{}], rowCount: 1 };
    }
    if (normalized.startsWith("SELECT ( EXISTS") && normalized.includes("FROM player_blocks")) {
      const firstPlayerKey = String(values[0]);
      const secondPlayerKey = String(values[1]);
      this.pool.pairRecheckCount += 1;
      if (this.pool.blockRechecksRemaining > 0) {
        this.pool.seedBlock(firstPlayerKey, secondPlayerKey);
        this.pool.blockRechecksRemaining -= 1;
      }
      if (
        this.pool.blockOnPairRecheck
        && this.pool.blockOnPairRecheck.includes(firstPlayerKey)
        && this.pool.blockOnPairRecheck.includes(secondPlayerKey)
      ) {
        this.pool.seedBlock(firstPlayerKey, secondPlayerKey);
        this.pool.blockOnPairRecheck = null;
      }
      return {
        rows: [{ blocked: this.pool.isPairBlocked(firstPlayerKey, secondPlayerKey) }],
        rowCount: 1,
      };
    }
    if (
      normalized.startsWith("WITH stale_waiting AS MATERIALIZED")
      && normalized.includes("updated_at < NOW()")
    ) {
      assert.match(normalized, /ORDER BY queued\.updated_at, queued\.player_key/);
      assert.match(normalized, /LIMIT 200 FOR UPDATE OF queued SKIP LOCKED/);
      assert.match(
        normalized,
        /DELETE FROM matchmaking_queue AS queued USING stale_waiting AS stale WHERE queued\.player_key = stale\.player_key AND queued\.board_size = \$1 AND queued\.time_control = \$2 AND queued\.rules_profile = \$3 AND queued\.status = 'waiting' AND queued\.updated_at < NOW\(\) - INTERVAL '5 minutes'$/,
      );
      const [boardSize, timeControl, rulesProfile] = values;
      const staleBefore = Date.now() - 5 * 60_000;
      const candidates = [...this.pool.queue.values()]
        .filter((row) =>
          row.board_size === boardSize
          && row.time_control === timeControl
          && row.rules_profile === rulesProfile
          && row.status === "waiting"
          && row.updated_at.getTime() < staleBefore
          && !this.pool.locks.isHeld(`row:${row.player_key}`))
        .sort((left, right) =>
          left.updated_at.getTime() - right.updated_at.getTime()
          || (left.player_key < right.player_key ? -1 : left.player_key > right.player_key ? 1 : 0))
        .slice(0, 200);
      let rowCount = 0;
      for (const candidate of candidates) {
        await this.lockRow(candidate.player_key);
        const row = this.viewQueue(candidate.player_key);
        if (
          row
          && row.board_size === boardSize
          && row.time_control === timeControl
          && row.rules_profile === rulesProfile
          && row.status === "waiting"
          && row.updated_at.getTime() < staleBefore
        ) {
          this.localQueue.set(row.player_key, null);
          rowCount += 1;
        }
      }
      return { rows: [], rowCount };
    }
    if (
      normalized.startsWith("INSERT INTO matchmaking_queue")
      && normalized.includes("SET player_key = EXCLUDED.player_key")
    ) {
      const playerKey = String(values[0]);
      await this.lockRow(playerKey);
      if (!this.viewQueue(playerKey)) {
        const now = new Date();
        this.localQueue.set(playerKey, {
          player_key: playerKey,
          board_size: values[1] as StoredQueue["board_size"],
          time_control: values[2] as StoredQueue["time_control"],
          rules_profile: String(values[3]),
          status: "waiting",
          game_id: null,
          created_at: now,
          updated_at: now,
        });
      }
      return { rows: [], rowCount: 1 };
    }
    if (normalized.includes("FROM matchmaking_queue q") && normalized.includes("FOR UPDATE OF q")) {
      const playerKey = String(values[0]);
      const beforeLock = this.viewQueue(playerKey);
      if (beforeLock) await this.lockRow(playerKey);
      const row = this.viewQueue(playerKey);
      if (row && normalized.includes("AS is_stale") && this.pool.pauseAfterCancellation) {
        this.pool.cancellationLocked.resolve();
        await this.pool.continueAfterCancellation.promise;
      }
      return {
        rows: row ? [{
          ...row,
          is_stale: row.updated_at.getTime() < Date.now() - 5 * 60_000,
        }] : [],
        rowCount: row ? 1 : 0,
      };
    }
    if (normalized === "SELECT status FROM games WHERE id = $1") {
      const game = this.viewGame(String(values[0]));
      return {
        rows: game ? [{ status: game.status }] : [],
        rowCount: game ? 1 : 0,
      };
    }
    if (normalized.includes("FROM games g") && normalized.includes("g.black_player_key = $1")) {
      const playerKey = String(values[0]);
      const games = [...this.pool.games.values(), ...this.localGames.values()]
        .filter((game) =>
          game.status === "active"
          && (game.black_player_key === playerKey || game.white_player_key === playerKey))
        .sort((left, right) => right.started_at.getTime() - left.started_at.getTime());
      const game = games[0];
      return {
        rows: game ? [{
          player_key: playerKey,
          board_size: game.board_size,
          time_control: game.time_control,
          rules_profile: game.rules_profile,
          status: "matched",
          game_id: game.id,
          created_at: game.started_at,
          game_status: game.status,
        }] : [],
        rowCount: game ? 1 : 0,
      };
    }
    if (
      normalized.startsWith("UPDATE matchmaking_queue")
      && normalized.includes("status = 'waiting'")
      && !normalized.includes("ANY($3::text[])")
    ) {
      const playerKey = String(values[0]);
      const current = this.viewQueue(playerKey);
      assert.ok(current);
      const now = new Date();
      this.localQueue.set(playerKey, {
        ...current,
        board_size: values[1] as StoredQueue["board_size"],
        time_control: values[2] as StoredQueue["time_control"],
        rules_profile: String(values[3]),
        status: "waiting",
        game_id: null,
        created_at: now,
        updated_at: now,
      });
      return { rows: [], rowCount: 1 };
    }
    if (
      normalized.startsWith("UPDATE matchmaking_queue")
      && normalized.includes("status = 'matched'")
      && !normalized.includes("ANY($3::text[])")
    ) {
      const playerKey = String(values[0]);
      const current = this.viewQueue(playerKey);
      assert.ok(current);
      this.localQueue.set(playerKey, {
        ...current,
        board_size: values[1] as StoredQueue["board_size"],
        time_control: values[2] as StoredQueue["time_control"],
        rules_profile: String(values[3]),
        status: "matched",
        game_id: String(values[4]),
        updated_at: new Date(),
      });
      return { rows: [], rowCount: 1 };
    }
    if (normalized.includes("FROM matchmaking_queue") && normalized.includes("FOR UPDATE SKIP LOCKED")) {
      assert.match(
        normalized,
        /q\.updated_at >= NOW\(\) - INTERVAL '5 minutes'/,
      );
      const boardSize = values[0];
      const timeControl = values[1];
      const profile = values[2];
      const playerKey = String(values[3]);
      const visibleQueue = new Map(this.pool.queue);
      for (const [localPlayerKey, row] of this.localQueue) {
        if (row) visibleQueue.set(localPlayerKey, row);
        else visibleQueue.delete(localPlayerKey);
      }
      const candidates = [...visibleQueue.values()]
        .filter((row) =>
          row.player_key !== playerKey
          && row.board_size === boardSize
          && row.time_control === timeControl
          && row.rules_profile === profile
          && row.status === "waiting"
          && row.updated_at.getTime() >= Date.now() - 5 * 60_000
          && !this.pool.isPairBlocked(playerKey, row.player_key)
          && !this.pool.locks.isHeld(`row:${row.player_key}`)
          && ![...this.pool.games.values()].some((game) =>
            game.status === "active"
            && (
              game.black_player_key === row.player_key
              || game.white_player_key === row.player_key
            )))
        .sort((left, right) =>
          left.created_at.getTime() - right.created_at.getTime()
          || (left.player_key < right.player_key ? -1 : left.player_key > right.player_key ? 1 : 0));
      const opponent = candidates[0];
      if (!opponent) return { rows: [], rowCount: 0 };
      await this.lockRow(opponent.player_key);
      const current = this.viewQueue(opponent.player_key);
      if (!current || current.status !== "waiting") return { rows: [], rowCount: 0 };
      if (this.pool.pauseAfterOpponent) {
        this.pool.opponentLocked.resolve();
        await this.pool.continueAfterOpponent.promise;
      }
      return { rows: [{ ...current }], rowCount: 1 };
    }
    if (normalized.startsWith("INSERT INTO games")) {
      const id = this.pool.nextGameId();
      this.localGames.set(id, {
        id,
        board_size: values[0] as StoredGame["board_size"],
        black_player_key: String(values[1]),
        white_player_key: String(values[2]),
        time_control: values[3] as StoredGame["time_control"],
        rules: String(values[4]),
        rules_profile: String(values[5]),
        scoring_method: String(values[6]),
        komi: Number(values[7]),
        handicap: Number(values[8]),
        to_move: String(values[9]),
        main_time_seconds: Number(values[10]),
        byo_yomi_periods: Number(values[11]),
        byo_yomi_seconds: Number(values[12]),
        black_time_remaining_ms: Number(values[13]),
        white_time_remaining_ms: Number(values[13]),
        status: "active",
        started_at: new Date(),
      });
      return { rows: [{ id }], rowCount: 1 };
    }
    if (normalized.startsWith("UPDATE matchmaking_queue") && normalized.includes("ANY($3::text[])")) {
      if (this.pool.publicationRowCountOverride !== null) {
        return { rows: [], rowCount: this.pool.publicationRowCountOverride };
      }
      const [gameId, profile, playerKeys, boardSize, timeControl] = values as [
        string,
        string,
        string[],
        StoredQueue["board_size"],
        StoredQueue["time_control"],
      ];
      let rowCount = 0;
      for (const playerKey of playerKeys) {
        const current = this.viewQueue(playerKey);
        if (
          current
          && current.board_size === boardSize
          && current.time_control === timeControl
          && current.rules_profile === profile
          && current.status === "waiting"
          && current.game_id === null
        ) {
          this.localQueue.set(playerKey, {
            ...current,
            status: "matched",
            game_id: gameId,
            updated_at: new Date(),
          });
          rowCount += 1;
        }
      }
      return { rows: [], rowCount };
    }
    if (
      normalized.startsWith("DELETE FROM matchmaking_queue")
      && normalized.includes("game_id IS NOT DISTINCT FROM")
    ) {
      const playerKey = String(values[0]);
      const current = this.viewQueue(playerKey);
      if (
        current
        && current.status === values[1]
        && current.game_id === (values[2] ?? null)
      ) {
        this.localQueue.set(playerKey, null);
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }
    throw new Error(`Unexpected client query: ${normalized}`);
  }
}

async function withPool<T>(pool: MatchmakingPool, action: () => Promise<T>) {
  const previous = globalThis.goStonedDbPool;
  globalThis.goStonedDbPool = pool as unknown as Pool;
  try {
    return await action();
  } finally {
    globalThis.goStonedDbPool = previous;
  }
}

function seedStaleWaiting(pool: MatchmakingPool, prefix: string, count: number) {
  const staleTime = new Date(Date.now() - 6 * 60_000);
  const keys: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const playerKey = `${prefix}${String(index).padStart(3, "0")}`;
    pool.seedWaiting(playerKey);
    Object.assign(pool.queue.get(playerKey)!, {
      created_at: staleTime,
      updated_at: staleTime,
    });
    keys.push(playerKey);
  }
  return keys;
}

test("simultaneous compatible first joins converge on one game", async () => {
  const pool = new MatchmakingPool();
  const [first, second] = await withPool(pool, () => Promise.all([
    joinMatchmaking("guest:first", 9, "rapid"),
    joinMatchmaking("guest:second", 9, "rapid"),
  ]));

  assert.deepEqual(new Set([first.status, second.status]), new Set(["waiting", "matched"]));
  assert.equal(pool.games.size, 1);
  const statuses = await withPool(pool, () => Promise.all([
    getMatchmakingStatus("guest:first"),
    getMatchmakingStatus("guest:second"),
  ]));
  assert.equal(statuses[0].status, "matched");
  assert.equal(statuses[1].status, "matched");
  assert.equal(statuses[0].gameId, statuses[1].gameId);
});

test("concurrent cross-pool joins for one player cannot create overlapping games", async () => {
  const pool = new MatchmakingPool();
  pool.seedWaiting("guest:rapid-opponent", "rapid");
  pool.seedWaiting("guest:classic-opponent", "classic");

  const results = await withPool(pool, () => Promise.all([
    joinMatchmaking("user:repeat", 9, "rapid"),
    joinMatchmaking("user:repeat", 9, "classic"),
  ]));

  assert.equal(pool.games.size, 1);
  assert.equal(results[0].status, "matched");
  assert.equal(results[1].status, "matched");
  assert.equal(results[0].gameId, results[1].gameId);
  assert.equal(pool.queue.get("user:repeat")?.game_id, results[0].gameId);
});

test("cancellation that loses to matching preserves and returns the active game", async () => {
  const pool = new MatchmakingPool();
  pool.seedWaiting("guest:waiting");
  pool.pauseAfterOpponent = true;

  await withPool(pool, async () => {
    const joining = joinMatchmaking("guest:joining", 9, "rapid");
    await pool.opponentLocked.promise;
    const cancelling = cancelMatchmaking("guest:waiting");
    await pool.cancellationWaiting.promise;
    pool.continueAfterOpponent.resolve();
    const [match, cancellation] = await Promise.all([joining, cancelling]);
    assert.equal(match.status, "matched");
    assert.equal(cancellation.status, "matched");
    assert.equal(match.gameId, cancellation.gameId);
  });

  assert.equal(pool.games.size, 1);
  assert.equal(pool.queue.get("guest:waiting")?.status, "matched");
});

test("matching skips an oldest opponent whose row is locked by cancellation", async () => {
  const pool = new MatchmakingPool();
  pool.seedWaiting("guest:cancelling");
  pool.seedWaiting("guest:available");
  pool.pauseAfterCancellation = true;
  pool.pauseAfterOpponent = true;

  await withPool(pool, async () => {
    const cancellation = cancelMatchmaking("guest:cancelling");
    await pool.cancellationLocked.promise;

    const joining = joinMatchmaking("guest:joining", 9, "rapid");
    await pool.opponentLocked.promise;
    assert.equal(pool.locks.isHeld("row:guest:available"), true);
    assert.equal(pool.locks.isHeld("row:guest:cancelling"), true);

    pool.continueAfterOpponent.resolve();
    const match = await joining;
    pool.continueAfterCancellation.resolve();
    const cancelled = await cancellation;

    assert.equal(match.status, "matched");
    assert.equal(cancelled.status, "idle");
    assert.equal(pool.queue.get("guest:available")?.game_id, match.gameId);
  });

  assert.equal(pool.queue.has("guest:cancelling"), false);
  assert.equal(pool.games.size, 1);
});

test("cancellation removes waiting and finished rows but preserves active matches", async () => {
  const pool = new MatchmakingPool();
  pool.seedWaiting("guest:waiting");
  await withPool(pool, async () => {
    assert.equal((await cancelMatchmaking("guest:waiting")).status, "idle");
  });
  assert.equal(pool.queue.has("guest:waiting"), false);

  pool.seedWaiting("guest:black");
  const match = await withPool(pool, () => joinMatchmaking("guest:white", 9, "rapid"));
  assert.equal(match.status, "matched");
  const active = await withPool(pool, () => cancelMatchmaking("guest:black"));
  assert.equal(active.status, "matched");
  assert.equal(pool.queue.has("guest:black"), true);

  pool.games.get(match.gameId!)!.status = "finished";
  const finished = await withPool(pool, () => cancelMatchmaking("guest:black"));
  assert.equal(finished.status, "idle");
  assert.equal(pool.queue.has("guest:black"), false);
});

test("stale cleanup rechecks locked state and preserves a refreshed waiting row", async () => {
  const pool = new MatchmakingPool();
  pool.seedWaiting("guest:refreshed");

  const fresh = await withPool(pool, () => cancelMatchmaking(
    "guest:refreshed",
    { staleOnly: true },
  ));
  assert.equal(fresh.status, "waiting");
  assert.equal(pool.queue.has("guest:refreshed"), true);

  pool.queue.get("guest:refreshed")!.updated_at = new Date(Date.now() - 6 * 60_000);
  const stale = await withPool(pool, () => getMatchmakingStatus("guest:refreshed"));
  assert.equal(stale.status, "idle");
  assert.equal(pool.queue.has("guest:refreshed"), false);
});

test("join cleanup removes only stale waiting rows from the requested pool", async () => {
  const pool = new MatchmakingPool();
  const staleTime = new Date(Date.now() - 6 * 60_000);
  pool.seedWaiting("guest:stale-rapid");
  pool.queue.get("guest:stale-rapid")!.updated_at = staleTime;

  pool.seedWaiting("guest:fresh-active");
  pool.seedActiveGame("guest:fresh-active", "guest:active-peer");

  pool.seedWaiting("guest:matched");
  const matchedGameId = pool.seedActiveGame("guest:matched", "guest:matched-peer");
  Object.assign(pool.queue.get("guest:matched")!, {
    status: "matched",
    game_id: matchedGameId,
    updated_at: staleTime,
  });

  pool.seedWaiting("guest:stale-classic", "classic");
  pool.queue.get("guest:stale-classic")!.updated_at = staleTime;

  const joined = await withPool(pool, () => joinMatchmaking(
    "guest:joining",
    9,
    "rapid",
  ));

  assert.equal(joined.status, "waiting");
  assert.equal(pool.queue.has("guest:stale-rapid"), false);
  assert.equal(pool.queue.get("guest:fresh-active")?.status, "waiting");
  assert.equal(pool.queue.get("guest:matched")?.game_id, matchedGameId);
  assert.equal(pool.queue.has("guest:stale-classic"), true);
});

test("bounded cleanup leaves its deterministic 201st stale row ineligible for matching", async () => {
  const pool = new MatchmakingPool();
  const staleKeys = seedStaleWaiting(pool, "guest:stale-cap-", 201);

  const joined = await withPool(pool, () => joinMatchmaking(
    "guest:joining",
    9,
    "rapid",
  ));

  assert.equal(joined.status, "waiting");
  assert.equal(pool.games.size, 0);
  assert.deepEqual(
    staleKeys.filter((playerKey) => pool.queue.has(playerKey)),
    ["guest:stale-cap-200"],
  );
  assert.equal(pool.queue.get("guest:stale-cap-200")?.status, "waiting");
});

test("locked stale cleanup residue stays ineligible after unlock until a later cleanup", async () => {
  const pool = new MatchmakingPool();
  const lockedStaleKey = "guest:locked-stale";
  pool.seedWaiting(lockedStaleKey);
  Object.assign(pool.queue.get(lockedStaleKey)!, {
    created_at: new Date(Date.now() - 6 * 60_000),
    updated_at: new Date(Date.now() - 6 * 60_000),
  });
  const locker = await pool.connect();
  await locker.query("BEGIN");
  await locker.query(
    `SELECT q.player_key
       FROM matchmaking_queue q
      WHERE q.player_key = $1
      FOR UPDATE OF q`,
    [lockedStaleKey],
  );

  try {
    const firstJoin = await withPool(pool, () => joinMatchmaking(
      "guest:first-fresh",
      9,
      "rapid",
    ));
    assert.equal(firstJoin.status, "waiting");
    assert.equal(pool.games.size, 0);
    assert.equal(pool.queue.has(lockedStaleKey), true);
  } finally {
    await locker.query("ROLLBACK");
    locker.release();
  }

  assert.equal(pool.queue.get(lockedStaleKey)?.status, "waiting");
  const olderBacklog = seedStaleWaiting(pool, "guest:older-stale-", 200);
  for (const playerKey of olderBacklog) {
    Object.assign(pool.queue.get(playerKey)!, {
      created_at: new Date(Date.now() - 7 * 60_000),
      updated_at: new Date(Date.now() - 7 * 60_000),
    });
  }

  const secondJoin = await withPool(pool, () => joinMatchmaking(
    "guest:second-fresh",
    9,
    "rapid",
  ));
  assert.equal(secondJoin.status, "matched");
  assert.equal(pool.games.get(secondJoin.gameId!)?.black_player_key, "guest:first-fresh");
  assert.equal(pool.queue.get(lockedStaleKey)?.status, "waiting");
  assert.equal(olderBacklog.some((playerKey) => pool.queue.has(playerKey)), false);

  const thirdJoin = await withPool(pool, () => joinMatchmaking(
    "guest:third-fresh",
    9,
    "rapid",
  ));
  assert.equal(thirdJoin.status, "waiting");
  assert.equal(pool.queue.has(lockedStaleKey), false);
});

test("fresh FIFO opponent matches while capped stale residue remains excluded", async () => {
  const pool = new MatchmakingPool();
  const staleKeys = seedStaleWaiting(pool, "guest:stale-with-fresh-", 205);
  pool.seedWaiting("guest:fresh-opponent");

  const joined = await withPool(pool, () => joinMatchmaking(
    "guest:joining",
    9,
    "rapid",
  ));

  assert.equal(joined.status, "matched");
  assert.equal(pool.games.get(joined.gameId!)?.black_player_key, "guest:fresh-opponent");
  assert.deepEqual(
    staleKeys.filter((playerKey) => pool.queue.has(playerKey)),
    staleKeys.slice(200),
  );
  assert.equal(
    staleKeys.some((playerKey) => pool.queue.get(playerKey)?.status === "matched"),
    false,
  );
});

test("guarded publication rolls back an orphan game and preserves the opponent", async () => {
  const pool = new MatchmakingPool();
  pool.seedWaiting("guest:opponent");
  pool.publicationRowCountOverride = 1;

  await assert.rejects(
    withPool(pool, () => joinMatchmaking("guest:joining", 9, "rapid")),
    /state changed before the game could be published/,
  );
  assert.equal(pool.games.size, 0);
  assert.equal(pool.queue.has("guest:joining"), false);
  assert.equal(pool.queue.get("guest:opponent")?.status, "waiting");
});

test("created games preserve the selected pool and canonical rules tuple", async () => {
  const pool = new MatchmakingPool();
  pool.seedWaiting("guest:black", "blitz", 13);

  await withPool(pool, () => joinMatchmaking("user:white", 13, "blitz"));
  const game = [...pool.games.values()][0];
  assert.ok(game);
  assert.deepEqual({
    boardSize: game.board_size,
    timeControl: game.time_control,
    rules: game.rules,
    rulesProfile: game.rules_profile,
    scoringMethod: game.scoring_method,
    komi: game.komi,
    handicap: game.handicap,
    toMove: game.to_move,
    mainTimeSeconds: game.main_time_seconds,
    byoYomiPeriods: game.byo_yomi_periods,
    byoYomiSeconds: game.byo_yomi_seconds,
  }, {
    boardSize: 13,
    timeControl: "blitz",
    rules: "japanese",
    rulesProfile: "japanese-1989-gostone-v1",
    scoringMethod: "territory",
    komi: 6.5,
    handicap: 0,
    toMove: "black",
    mainTimeSeconds: 300,
    byoYomiPeriods: 3,
    byoYomiSeconds: 20,
  });
});

test("different pools and corrupt active participants are never selected as opponents", async () => {
  const isolated = new MatchmakingPool();
  isolated.seedWaiting("guest:rapid-nine", "rapid", 9);
  const differentBoard = await withPool(isolated, () => joinMatchmaking(
    "guest:rapid-thirteen",
    13,
    "rapid",
  ));
  const differentClock = await withPool(isolated, () => joinMatchmaking(
    "guest:classic-nine",
    9,
    "classic",
  ));
  assert.equal(differentBoard.status, "waiting");
  assert.equal(differentClock.status, "waiting");
  assert.equal(isolated.games.size, 0);

  const corrupt = new MatchmakingPool();
  corrupt.seedWaiting("guest:active-black");
  const active = await withPool(corrupt, () => joinMatchmaking(
    "guest:active-white",
    9,
    "rapid",
  ));
  assert.equal(active.status, "matched");
  const activeBlack = corrupt.queue.get("guest:active-black")!;
  corrupt.queue.set("guest:active-black", {
    ...activeBlack,
    status: "waiting",
    game_id: null,
  });

  const newcomer = await withPool(corrupt, () => joinMatchmaking(
    "guest:newcomer",
    9,
    "rapid",
  ));
  assert.equal(newcomer.status, "waiting");
  assert.equal(corrupt.games.size, 1);
});

test("either block direction excludes the pair and selects the next eligible player", async (t) => {
  for (const direction of ["requester", "candidate"] as const) {
    await t.test(direction, async () => {
      const pool = new MatchmakingPool();
      pool.seedWaiting("guest:blocked-oldest");
      pool.seedWaiting("guest:eligible-next");
      pool.queue.get("guest:blocked-oldest")!.created_at = new Date(1);
      pool.queue.get("guest:eligible-next")!.created_at = new Date(2);
      if (direction === "requester") {
        pool.seedBlock("guest:joining", "guest:blocked-oldest");
      } else {
        pool.seedBlock("guest:blocked-oldest", "guest:joining");
      }

      const match = await withPool(pool, () => joinMatchmaking(
        "guest:joining",
        9,
        "rapid",
      ));

      assert.equal(match.status, "matched");
      const game = pool.games.get(match.gameId!);
      assert.equal(game?.black_player_key, "guest:eligible-next");
      assert.equal(game?.white_player_key, "guest:joining");
      assert.equal(pool.queue.get("guest:blocked-oldest")?.status, "waiting");
    });
  }
});

test("a simulated committed block after selection exercises the bounded retry path", async () => {
  const pool = new MatchmakingPool();
  pool.seedWaiting("guest:first-candidate");
  pool.seedWaiting("guest:next-candidate");
  pool.queue.get("guest:first-candidate")!.created_at = new Date(1);
  pool.queue.get("guest:next-candidate")!.created_at = new Date(2);
  pool.blockOnPairRecheck = ["guest:joining", "guest:first-candidate"];

  const match = await withPool(pool, () => joinMatchmaking(
    "guest:joining",
    9,
    "rapid",
  ));

  assert.equal(match.status, "matched");
  assert.equal(pool.games.get(match.gameId!)?.black_player_key, "guest:next-candidate");
  assert.equal(pool.queue.get("guest:first-candidate")?.status, "waiting");
});

test("repeated simulated block races retain at most eight candidate and pair locks", async () => {
  const pool = new MatchmakingPool();
  for (let index = 0; index < 9; index += 1) {
    const playerKey = `guest:candidate-${index}`;
    pool.seedWaiting(playerKey);
    pool.queue.get(playerKey)!.created_at = new Date(index + 1);
  }
  pool.blockRechecksRemaining = 9;

  const result = await withPool(pool, () => joinMatchmaking(
    "guest:joining",
    9,
    "rapid",
  ));

  assert.equal(result.status, "waiting");
  assert.equal(pool.pairRecheckCount, 8);
  assert.equal(pool.games.size, 0);
});
