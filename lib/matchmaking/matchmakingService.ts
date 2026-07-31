import { randomUUID } from "node:crypto";
import { query, withTransaction } from "@/lib/db";
import { botDifficultyForRating } from "@/lib/bot/difficulty";
import { botDisplayName, deterministicUnit } from "@/lib/bot/identity";
import { DEFAULT_MATCH_RULES, resolveRulesConfiguration } from "@/lib/game/rulesPolicy";
import { getTimeControl } from "@/lib/game/timeControls";
import type { BoardSize, TimeControlId } from "@/lib/game/types";
import {
  isPlayerPairBlocked,
  lockPlayerPair,
} from "@/lib/moderation/playerBlockService";

export type MatchmakingStatus =
  | { status: "idle"; gameId: null; boardSize: null; timeControl: null }
  | { status: "waiting"; gameId: null; boardSize: BoardSize; timeControl: TimeControlId }
  | { status: "matched"; gameId: string; boardSize: BoardSize; timeControl: TimeControlId };

type QueueRow = {
  player_key: string;
  board_size: BoardSize;
  time_control: TimeControlId;
  rules_profile: string;
  status: "waiting" | "matched";
  game_id: string | null;
  created_at: Date;
  game_status?: "active" | "finished" | null;
  is_stale?: boolean;
  bot_fallback_due?: boolean;
  bot_worker_available?: boolean;
};

type CancellationOptions = {
  staleOnly?: boolean;
};

const MAX_BLOCKED_CANDIDATE_RECHECKS = 8;
const BOT_FALLBACK_SECONDS = 10;

export function isBoardSize(value: unknown): value is BoardSize {
  return value === 9 || value === 13 || value === 19;
}

function mapQueue(row?: QueueRow): MatchmakingStatus {
  if (!row) return { status: "idle", gameId: null, boardSize: null, timeControl: null };
  if (row.status === "matched" && row.game_id) {
    return {
      status: "matched",
      gameId: row.game_id,
      boardSize: row.board_size,
      timeControl: row.time_control,
    };
  }
  return {
    status: "waiting",
    gameId: null,
    boardSize: row.board_size,
    timeControl: row.time_control,
  };
}

async function matchWaitingPlayerWithBot(
  playerKey: string,
  expected: Pick<QueueRow, "board_size" | "time_control" | "rules_profile">,
  allowOnDemandBot: boolean,
): Promise<MatchmakingStatus> {
  const timeControl = getTimeControl(expected.time_control);
  const rules = resolveRulesConfiguration({
    ruleset: DEFAULT_MATCH_RULES.ruleset,
    rulesProfile: DEFAULT_MATCH_RULES.rulesProfile,
    scoringMethod: DEFAULT_MATCH_RULES.scoringMethod,
    komi: DEFAULT_MATCH_RULES.komi,
    handicap: DEFAULT_MATCH_RULES.handicap,
  });
  return withTransaction(async (client) => {
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
      [`matchmaking-pool:v1:${expected.board_size}:${expected.time_control}:${expected.rules_profile}`],
    );
    const currentResult = await client.query<QueueRow>(
      `SELECT q.player_key, q.board_size, q.time_control, q.rules_profile,
              q.status, q.game_id, q.created_at,
              g.status AS game_status
         FROM matchmaking_queue q
         LEFT JOIN games g ON g.id = q.game_id
        WHERE q.player_key = $1
        FOR UPDATE OF q`,
      [playerKey],
    );
    const current = currentResult.rows[0];
    if (!current) return mapQueue();
    if (current.status === "matched" && current.game_id && current.game_status === "active") {
      return mapQueue(current);
    }
    if (
      current.status !== "waiting"
      || current.game_id !== null
      || current.board_size !== expected.board_size
      || current.time_control !== expected.time_control
      || current.rules_profile !== expected.rules_profile
      || current.rules_profile !== rules.rulesProfile
    ) {
      return mapQueue(current);
    }

    const eligibility = await client.query<{ due: boolean; worker_available: boolean }>(
      `SELECT $1::timestamptz <= NOW() - make_interval(secs => $2::int) AS due,
              ($3::boolean OR EXISTS (
                SELECT 1 FROM katago_workers
                 WHERE ready
                   AND 'bot' = ANY(capabilities)
                   AND last_seen_at >= NOW() - INTERVAL '15 seconds'
              )) AS worker_available`,
      [current.created_at, BOT_FALLBACK_SECONDS, allowOnDemandBot],
    );
    if (!eligibility.rows[0]?.due || !eligibility.rows[0].worker_available) {
      return mapQueue(current);
    }

    const activeGame = await client.query<{ id: string }>(
      `SELECT id FROM games
        WHERE status = 'active'
          AND (black_player_key = $1 OR white_player_key = $1)
        LIMIT 1
        FOR UPDATE`,
      [playerKey],
    );
    if (activeGame.rows[0]) return mapQueue(current);

    const ratingResult = await client.query<{ rating: number }>(
      `SELECT COALESCE((
         SELECT rating FROM player_stats
          WHERE player_key = $1 AND board_size = $2
       ), 1200)::int AS rating`,
      [playerKey, current.board_size],
    );
    const difficulty = botDifficultyForRating(ratingResult.rows[0]?.rating ?? 1200);
    const identitySeed = `${playerKey}:${current.created_at.toISOString()}:${current.board_size}`;
    const botPlayerKey = `bot:${randomUUID()}`;
    const botIsBlack = deterministicUnit(`${identitySeed}:color`) < 0.5;
    const blackPlayerKey = botIsBlack ? botPlayerKey : playerKey;
    const whitePlayerKey = botIsBlack ? playerKey : botPlayerKey;
    const gameResult = await client.query<{ id: string }>(
      `INSERT INTO games (
         board_size, black_player_key, white_player_key, time_control,
         rules, rules_profile, scoring_method, komi, handicap, phase, to_move,
         main_time_seconds, byo_yomi_periods, byo_yomi_seconds,
         black_time_remaining_ms, white_time_remaining_ms,
         black_periods_remaining, white_periods_remaining, turn_started_at
       )
       VALUES (
         $1, $2, $3, $4,
         $5, $6, $7, $8, $9, 'play', $10,
         $11, $12, $13, $14, $14, $12, $12, NOW()
       )
       RETURNING id`,
      [
        current.board_size,
        blackPlayerKey,
        whitePlayerKey,
        current.time_control,
        rules.ruleset,
        rules.rulesProfile,
        rules.scoringMethod,
        rules.komi,
        rules.handicap,
        rules.policy.initialTurn,
        timeControl.mainTimeSeconds,
        timeControl.byoYomiPeriods,
        timeControl.byoYomiSeconds,
        timeControl.mainTimeSeconds * 1_000,
      ],
    );
    const gameId = gameResult.rows[0].id;
    await client.query(
      `INSERT INTO game_bots (
         game_id, bot_player_key, display_name, color, target_rating,
         visits_per_turn, candidate_limit, temperature
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        gameId,
        botPlayerKey,
        botDisplayName(identitySeed),
        botIsBlack ? "black" : "white",
        difficulty.targetRating,
        difficulty.visitsPerTurn,
        difficulty.candidateLimit,
        difficulty.temperature,
      ],
    );
    const publication = await client.query(
      `UPDATE matchmaking_queue
          SET status = 'matched', game_id = $1, rules_profile = $2,
              updated_at = NOW()
        WHERE player_key = $3
          AND board_size = $4 AND time_control = $5 AND rules_profile = $2
          AND status = 'waiting' AND game_id IS NULL`,
      [gameId, rules.rulesProfile, playerKey, current.board_size, current.time_control],
    );
    if (publication.rowCount !== 1) {
      throw new Error("Matchmaking state changed before the bot game could be published.");
    }
    return {
      status: "matched",
      gameId,
      boardSize: current.board_size,
      timeControl: current.time_control,
    };
  });
}

export async function getMatchmakingStatus(
  playerKey: string,
  options: { allowOnDemandBot?: boolean } = {},
): Promise<MatchmakingStatus> {
  const result = await query<QueueRow>(
    `SELECT q.player_key, q.board_size, q.time_control, q.rules_profile,
            q.status, q.game_id, q.created_at,
            g.status AS game_status,
            q.updated_at < NOW() - INTERVAL '5 minutes' AS is_stale,
            q.created_at <= NOW() - INTERVAL '10 seconds' AS bot_fallback_due,
            ($2::boolean OR EXISTS (
              SELECT 1 FROM katago_workers
               WHERE ready
                 AND 'bot' = ANY(capabilities)
                 AND last_seen_at >= NOW() - INTERVAL '15 seconds'
            )) AS bot_worker_available
       FROM matchmaking_queue q
       LEFT JOIN games g ON g.id = q.game_id
      WHERE q.player_key = $1`,
    [playerKey, options.allowOnDemandBot === true],
  );
  const row = result.rows[0];
  if (row?.status === "matched" && row.game_status !== "active") {
    return cancelMatchmaking(playerKey, { staleOnly: true });
  }
  if (row?.status === "waiting" && row.is_stale) {
    return cancelMatchmaking(playerKey, { staleOnly: true });
  }
  if (row?.status === "waiting" && row.bot_fallback_due && row.bot_worker_available) {
    return matchWaitingPlayerWithBot(playerKey, row, options.allowOnDemandBot === true);
  }
  return mapQueue(row);
}

export async function joinMatchmaking(
  playerKey: string,
  boardSize: BoardSize,
  timeControlId: TimeControlId,
): Promise<MatchmakingStatus> {
  const timeControl = getTimeControl(timeControlId);
  const rules = resolveRulesConfiguration({
    ruleset: DEFAULT_MATCH_RULES.ruleset,
    rulesProfile: DEFAULT_MATCH_RULES.rulesProfile,
    scoringMethod: DEFAULT_MATCH_RULES.scoringMethod,
    komi: DEFAULT_MATCH_RULES.komi,
    handicap: DEFAULT_MATCH_RULES.handicap,
  });
  return withTransaction(async (client) => {
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
      [`matchmaking-pool:v1:${boardSize}:${timeControlId}:${rules.rulesProfile}`],
    );
    await client.query(
      `WITH stale_waiting AS MATERIALIZED (
         SELECT queued.player_key
           FROM matchmaking_queue AS queued
          WHERE queued.board_size = $1
            AND queued.time_control = $2
            AND queued.rules_profile = $3
            AND queued.status = 'waiting'
            AND queued.updated_at < NOW() - INTERVAL '5 minutes'
          ORDER BY queued.updated_at, queued.player_key
          LIMIT 200
          FOR UPDATE OF queued SKIP LOCKED
       )
       DELETE FROM matchmaking_queue AS queued
       USING stale_waiting AS stale
       WHERE queued.player_key = stale.player_key
         AND queued.board_size = $1
         AND queued.time_control = $2
         AND queued.rules_profile = $3
         AND queued.status = 'waiting'
         AND queued.updated_at < NOW() - INTERVAL '5 minutes'`,
      [boardSize, timeControlId, rules.rulesProfile],
    );

    // A no-op conflict update materializes and locks the participant row even
    // when concurrent requests both began before it existed.
    await client.query(
      `INSERT INTO matchmaking_queue (
         player_key, board_size, time_control, rules_profile, status, game_id
       )
       VALUES ($1, $2, $3, $4, 'waiting', NULL)
       ON CONFLICT (player_key) DO UPDATE
       SET player_key = EXCLUDED.player_key`,
      [playerKey, boardSize, timeControlId, rules.rulesProfile],
    );

    const existing = await client.query<QueueRow>(
      `SELECT q.player_key, q.board_size, q.time_control, q.rules_profile,
              q.status, q.game_id, q.created_at,
              g.status AS game_status
         FROM matchmaking_queue q
         LEFT JOIN games g ON g.id = q.game_id
        WHERE q.player_key = $1
        FOR UPDATE OF q`,
      [playerKey],
    );
    if (
      existing.rows[0]?.status === "matched" &&
      existing.rows[0].game_id &&
      existing.rows[0].game_status === "active"
    ) {
      return mapQueue(existing.rows[0]);
    }

    const activeGame = await client.query<QueueRow>(
      `SELECT $1::text AS player_key, g.board_size, g.time_control, g.rules_profile,
              'matched'::text AS status, g.id AS game_id, g.started_at AS created_at,
              g.status AS game_status
         FROM games g
        WHERE g.status = 'active'
          AND (g.black_player_key = $1 OR g.white_player_key = $1)
        ORDER BY g.started_at DESC, g.id DESC
        LIMIT 1
        FOR UPDATE OF g`,
      [playerKey],
    );
    if (activeGame.rows[0]) {
      const game = activeGame.rows[0];
      await client.query(
        `UPDATE matchmaking_queue
            SET board_size = $2, time_control = $3, rules_profile = $4,
                status = 'matched', game_id = $5, updated_at = NOW()
          WHERE player_key = $1`,
        [playerKey, game.board_size, game.time_control, game.rules_profile, game.game_id],
      );
      return mapQueue(game);
    }

    await client.query(
      `UPDATE matchmaking_queue
          SET board_size = $2, time_control = $3, rules_profile = $4,
              status = 'waiting', game_id = NULL,
              created_at = NOW(), updated_at = NOW()
        WHERE player_key = $1`,
      [playerKey, boardSize, timeControlId, rules.rulesProfile],
    );

    let opponent: QueueRow | undefined;
    for (
      let attempt = 0;
      attempt < MAX_BLOCKED_CANDIDATE_RECHECKS && !opponent;
      attempt += 1
    ) {
      const opponentResult = await client.query<QueueRow>(
        `SELECT q.player_key, q.board_size, q.time_control, q.rules_profile,
                q.status, q.game_id, q.created_at
           FROM matchmaking_queue q
          WHERE q.board_size = $1 AND q.time_control = $2
            AND q.rules_profile = $3
            AND q.status = 'waiting' AND q.player_key <> $4
            AND q.updated_at >= NOW() - INTERVAL '5 minutes'
            AND NOT EXISTS (
              SELECT 1
                FROM games active_game
               WHERE active_game.status = 'active'
                 AND (
                   active_game.black_player_key = q.player_key
                   OR active_game.white_player_key = q.player_key
                 )
            )
            AND NOT EXISTS (
              SELECT 1 FROM player_blocks
               WHERE blocker_key = $4 AND blocked_key = q.player_key
            )
            AND NOT EXISTS (
              SELECT 1 FROM player_blocks
               WHERE blocker_key = q.player_key AND blocked_key = $4
            )
          ORDER BY q.created_at, q.player_key
          LIMIT 1
          FOR UPDATE SKIP LOCKED`,
        [boardSize, timeControlId, rules.rulesProfile, playerKey],
      );
      const candidate = opponentResult.rows[0];
      if (!candidate) {
        return {
          status: "waiting",
          gameId: null,
          boardSize,
          timeControl: timeControlId,
        };
      }

      // The pair lock makes the final eligibility check linearizable with
      // blocking and chat. The queue/pool locks are always acquired first;
      // block and chat operations never acquire them, avoiding a lock cycle.
      await lockPlayerPair(client, playerKey, candidate.player_key);
      if (await isPlayerPairBlocked(client, playerKey, candidate.player_key)) continue;
      opponent = candidate;
    }
    if (!opponent) {
      return {
        status: "waiting",
        gameId: null,
        boardSize,
        timeControl: timeControlId,
      };
    }

    const gameResult = await client.query<{ id: string }>(
      `INSERT INTO games (
         board_size, black_player_key, white_player_key, time_control,
         rules, rules_profile, scoring_method, komi, handicap, phase, to_move,
         main_time_seconds, byo_yomi_periods, byo_yomi_seconds,
         black_time_remaining_ms, white_time_remaining_ms,
         black_periods_remaining, white_periods_remaining, turn_started_at
       )
       VALUES (
         $1, $2, $3, $4,
         $5, $6, $7, $8, $9, 'play', $10,
         $11, $12, $13, $14, $14, $12, $12, NOW()
       )
       RETURNING id`,
      [
        boardSize,
        opponent.player_key,
        playerKey,
        timeControlId,
        rules.ruleset,
        rules.rulesProfile,
        rules.scoringMethod,
        rules.komi,
        rules.handicap,
        rules.policy.initialTurn,
        timeControl.mainTimeSeconds,
        timeControl.byoYomiPeriods,
        timeControl.byoYomiSeconds,
        timeControl.mainTimeSeconds * 1_000,
      ],
    );
    const gameId = gameResult.rows[0].id;

    const publication = await client.query(
      `UPDATE matchmaking_queue
          SET status = 'matched', game_id = $1, rules_profile = $2,
              updated_at = NOW()
        WHERE player_key = ANY($3::text[])
          AND board_size = $4 AND time_control = $5 AND rules_profile = $2
          AND status = 'waiting' AND game_id IS NULL`,
      [
        gameId,
        rules.rulesProfile,
        [opponent.player_key, playerKey],
        boardSize,
        timeControlId,
      ],
    );
    if (publication.rowCount !== 2) {
      throw new Error("Matchmaking state changed before the game could be published.");
    }
    return {
      status: "matched",
      gameId,
      boardSize,
      timeControl: timeControlId,
    };
  });
}

export async function cancelMatchmaking(
  playerKey: string,
  { staleOnly = false }: CancellationOptions = {},
): Promise<MatchmakingStatus> {
  return withTransaction(async (client) => {
    const current = await client.query<QueueRow>(
      `SELECT q.player_key, q.board_size, q.time_control, q.rules_profile,
              q.status, q.game_id, q.created_at,
              q.updated_at < NOW() - INTERVAL '5 minutes' AS is_stale
         FROM matchmaking_queue q
        WHERE q.player_key = $1
        FOR UPDATE OF q`,
      [playerKey],
    );
    const row = current.rows[0];
    if (!row) return mapQueue();
    if (row.status === "matched" && row.game_id) {
      // Read the linked game only after acquiring the queue-row lock. Under
      // READ COMMITTED, a locking statement can return a concurrently updated
      // queue tuple while retaining an older snapshot for joined tables.
      const game = await client.query<{ status: "active" | "finished" }>(
        "SELECT status FROM games WHERE id = $1",
        [row.game_id],
      );
      if (game.rows[0]?.status === "active") {
        return mapQueue(row);
      }
    }
    if (row.status === "waiting" && staleOnly && !row.is_stale) {
      return mapQueue(row);
    }

    await client.query(
      `DELETE FROM matchmaking_queue
        WHERE player_key = $1 AND status = $2
          AND game_id IS NOT DISTINCT FROM $3`,
      [playerKey, row.status, row.game_id],
    );
    return mapQueue();
  });
}
