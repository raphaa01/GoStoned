import { query, withTransaction } from "@/lib/db";
import { JAPANESE_1989_CONTRACT_ID } from "@/lib/game/japanesePolicyContract";
import { newGameRulesConfiguration } from "@/lib/game/newGameRules";
import { getTimeControl } from "@/lib/game/timeControls";
import type { BoardSize, TimeControlId } from "@/lib/game/types";
import {
  isPlayerPairBlocked,
  lockPlayerPair,
} from "@/lib/moderation/playerBlockService";
import {
  ADAPTIVE_MATCH_POLICY_VERSION,
  evaluateAdaptiveMatch,
  rankAdaptiveMatchCandidates,
  type AdaptiveMatchEntry,
  type MatchPool,
} from "./adaptiveMatchPolicy";
import type { BotMatchPreference } from "@/lib/rating/preferences";
import type { RatingDisplayPreference } from "@/lib/rating/rankPolicy";

export type MatchmakingStatus =
  | { status: "idle"; gameId: null; boardSize: null; timeControl: null }
  | { status: "waiting"; gameId: null; boardSize: BoardSize; timeControl: TimeControlId;
      pool?: MatchPool; botMatchPreference?: BotMatchPreference; rating?: number | null;
      ratingDeviation?: number | null; displayPreference?: RatingDisplayPreference;
      waitingSince?: string }
  | { status: "matched"; gameId: string; boardSize: BoardSize; timeControl: TimeControlId };

type QueueRow = {
  player_key: string;
  board_size: BoardSize;
  time_control: TimeControlId;
  rules_profile: string;
  status: "waiting" | "matched";
  game_id: string | null;
  created_at: Date;
  matchmaking_policy_version?: string | null;
  match_pool?: MatchPool;
  rules_snapshot?: "japanese" | "chinese";
  rules_version_snapshot?: string;
  scoring_method_snapshot?: "territory" | "area";
  komi_snapshot?: number;
  handicap_snapshot?: number;
  rating_snapshot?: number | null;
  rating_deviation_snapshot?: number | null;
  reliable_latency_ms?: number | null;
  abandonment_risk?: "normal" | "elevated" | "restricted";
  handicap_preference?: "even-only" | "verified-handicap-ok";
  bot_match_preference?: BotMatchPreference;
  display_preference_snapshot?: RatingDisplayPreference | null;
  game_status?: "active" | "finished" | null;
  is_stale?: boolean;
};

type CancellationOptions = {
  staleOnly?: boolean;
};

const CALIBRATED_BOT_FALLBACK_SECONDS = 10;

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
    pool: row.match_pool,
    botMatchPreference: row.bot_match_preference,
    rating: row.rating_snapshot === null || row.rating_snapshot === undefined
      ? null : Number(row.rating_snapshot),
    ratingDeviation: row.rating_deviation_snapshot === null
      || row.rating_deviation_snapshot === undefined
      ? null : Number(row.rating_deviation_snapshot),
    displayPreference: row.display_preference_snapshot ?? undefined,
    waitingSince: row.created_at.toISOString(),
  };
}

function adaptiveEntry(row: QueueRow): AdaptiveMatchEntry {
  const configuration = {
    boardSize: row.board_size,
    timeControl: row.time_control,
    rules: row.rules_snapshot ?? "japanese",
    rulesProfile: row.rules_profile,
    rulesVersion: row.rules_version_snapshot ?? JAPANESE_1989_CONTRACT_ID,
    scoringMethod: row.scoring_method_snapshot ?? "territory",
    komi: Number(row.komi_snapshot ?? 6.5),
    handicap: row.handicap_snapshot ?? 0,
  };
  const base = {
    playerKey: row.player_key,
    configuration,
    waitingSinceMs: row.created_at.getTime(),
    reliableLatencyMs: row.reliable_latency_ms ?? null,
    abandonmentRisk: row.abandonment_risk ?? "normal",
    handicapPreference: row.handicap_preference ?? "even-only",
  } as const;
  return row.match_pool === "registered-rated"
    ? {
        ...base,
        pool: "registered-rated",
        globalRating: Number(row.rating_snapshot),
        ratingDeviation: Number(row.rating_deviation_snapshot),
      }
    : { ...base, pool: "guest-unrated", globalRating: null, ratingDeviation: null };
}

export async function getMatchmakingStatus(playerKey: string): Promise<MatchmakingStatus> {
  const result = await query<QueueRow>(
    `SELECT q.*,
            g.status AS game_status,
            q.updated_at < NOW() - INTERVAL '5 minutes' AS is_stale
       FROM matchmaking_queue q
       LEFT JOIN games g ON g.id = q.game_id
      WHERE q.player_key = $1`,
    [playerKey],
  );
  const row = result.rows[0];
  if (row?.status === "matched" && row.game_status !== "active") {
    return cancelMatchmaking(playerKey, { staleOnly: true });
  }
  if (row?.status === "waiting" && row.is_stale) {
    return cancelMatchmaking(playerKey, { staleOnly: true });
  }
  return mapQueue(row);
}

export async function joinMatchmaking(
  playerKey: string,
  boardSize: BoardSize,
  timeControlId: TimeControlId,
): Promise<MatchmakingStatus> {
  const timeControl = getTimeControl(timeControlId);
  const rules = newGameRulesConfiguration();
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

    const authorityResult = await client.query<{
      rating: number;
      rating_deviation: number;
      algorithm_version: string;
      rating_updated_at: Date;
      preference_revision: number;
      display_preference: RatingDisplayPreference;
      bot_match_preference: BotMatchPreference;
      handicap_preference: "even-only" | "verified-handicap-ok";
    }>(
      `SELECT rating.rating::double precision AS rating,
              rating.rating_deviation::double precision AS rating_deviation,
              rating.algorithm_version,
              rating.updated_at AS rating_updated_at,
              preference.preference_revision,
              preference.display_preference,
              preference.bot_match_preference,
              preference.handicap_preference
         FROM player_glicko2_ratings rating
         JOIN player_rating_preferences preference
           ON preference.user_id = rating.user_id
        WHERE rating.player_key = $1
        FOR UPDATE OF rating,preference`,
      [playerKey],
    );
    const authority = authorityResult.rows[0];
    const registered = playerKey.startsWith("user:");
    if (registered && !authority) {
      throw new Error("Registered matchmaking requires an authoritative global rating state.");
    }
    if (!registered && !playerKey.startsWith("guest:")) {
      throw new Error("Matchmaking identity is unsupported.");
    }
    const pool: MatchPool = authority ? "registered-rated" : "guest-unrated";
    const botMatchPreference: BotMatchPreference = authority?.bot_match_preference ?? "never";
    const handicapPreference = authority?.handicap_preference ?? "even-only";

    // A no-op conflict update materializes and locks the participant row even
    // when concurrent requests both began before it existed.
    await client.query(
      `INSERT INTO matchmaking_queue (
         player_key, board_size, time_control, rules_profile, status, game_id,
         matchmaking_policy_version,match_pool,rules_snapshot,rules_version_snapshot,
         scoring_method_snapshot,komi_snapshot,handicap_snapshot,rating_snapshot,
         rating_deviation_snapshot,rating_algorithm_version,rating_state_updated_at,
         preference_revision,display_preference_snapshot,bot_match_preference,reliable_latency_ms,
         latency_evidence_version,latency_observed_at,abandonment_risk,
         abandonment_policy_version,abandonment_evaluated_at,handicap_preference,
         bot_fallback_not_before
       )
       VALUES ($1,$2,$3,$4,'waiting',NULL,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,
               $15,$16,$17,$18,NULL,NULL,NULL,'normal','abandonment-risk-v1',NOW(),$19,
               NOW() + make_interval(secs => $20::int))
       ON CONFLICT (player_key) DO UPDATE
       SET player_key = EXCLUDED.player_key`,
      [
        playerKey, boardSize, timeControlId, rules.rulesProfile,
        ADAPTIVE_MATCH_POLICY_VERSION, pool, rules.ruleset, JAPANESE_1989_CONTRACT_ID,
        rules.scoringMethod, rules.komi, rules.handicap,
        authority?.rating ?? null, authority?.rating_deviation ?? null,
        authority?.algorithm_version ?? null, authority?.rating_updated_at ?? null,
        authority?.preference_revision ?? 1, authority?.display_preference ?? null,
        botMatchPreference, handicapPreference,
        CALIBRATED_BOT_FALLBACK_SECONDS,
      ],
    );

    const existing = await client.query<QueueRow>(
      `SELECT q.*,
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

    const requesterResult = await client.query<QueueRow>(
      `UPDATE matchmaking_queue
          SET board_size = $2, time_control = $3, rules_profile = $4,
              status = 'waiting', game_id = NULL,
              matchmaking_policy_version = $5, match_pool = $6,
              rules_snapshot = $7, rules_version_snapshot = $8,
              scoring_method_snapshot = $9, komi_snapshot = $10,
              handicap_snapshot = $11, rating_snapshot = $12,
              rating_deviation_snapshot = $13, rating_algorithm_version = $14,
              rating_state_updated_at = $15, preference_revision = $16,
              display_preference_snapshot = $17, bot_match_preference = $18,
              abandonment_risk = 'normal',
              abandonment_policy_version = 'abandonment-risk-v1',
              abandonment_evaluated_at = NOW(), handicap_preference = $19,
              reliable_latency_ms = NULL, latency_evidence_version = NULL,
              latency_observed_at = NULL,
              bot_fallback_not_before = NOW() + make_interval(secs => $20::int),
              created_at = NOW(), updated_at = NOW()
        WHERE player_key = $1
        RETURNING *`,
      [
        playerKey, boardSize, timeControlId, rules.rulesProfile,
        ADAPTIVE_MATCH_POLICY_VERSION, pool, rules.ruleset, JAPANESE_1989_CONTRACT_ID,
        rules.scoringMethod, rules.komi, rules.handicap,
        authority?.rating ?? null, authority?.rating_deviation ?? null,
        authority?.algorithm_version ?? null, authority?.rating_updated_at ?? null,
        authority?.preference_revision ?? 1, authority?.display_preference ?? null,
        botMatchPreference, handicapPreference,
        CALIBRATED_BOT_FALLBACK_SECONDS,
      ],
    );

    const requester = requesterResult.rows[0];
    if (!requester) throw new Error("Matchmaking queue state was not persisted.");
    let opponent: QueueRow | undefined;
    const opponentResult = await client.query<QueueRow>(
        `SELECT q.*
           FROM matchmaking_queue q
          WHERE q.board_size = $1 AND q.time_control = $2
            AND q.rules_profile = $3
            AND q.status = 'waiting' AND q.player_key <> $4
            AND q.matchmaking_policy_version = $5
            AND q.match_pool = $6
            AND q.updated_at >= NOW() - INTERVAL '5 minutes'
            AND (
              q.match_pool = 'guest-unrated'
              OR EXISTS (
                SELECT 1 FROM player_glicko2_ratings live_rating
                 WHERE live_rating.player_key = q.player_key
                   AND live_rating.rating IS NOT DISTINCT FROM q.rating_snapshot
                   AND live_rating.rating_deviation IS NOT DISTINCT FROM q.rating_deviation_snapshot
                   AND live_rating.algorithm_version IS NOT DISTINCT FROM q.rating_algorithm_version
                   AND live_rating.updated_at IS NOT DISTINCT FROM q.rating_state_updated_at
              )
            )
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
          LIMIT 8
          FOR UPDATE SKIP LOCKED`,
        [
          boardSize, timeControlId, rules.rulesProfile, playerKey,
          ADAPTIVE_MATCH_POLICY_VERSION, pool,
        ],
      );
    const ranked = rankAdaptiveMatchCandidates(
      adaptiveEntry(requester),
      opponentResult.rows.map(adaptiveEntry),
      () => ({ nowMs: Date.now(), blockedEitherDirection: false }),
    );
    for (const rankedCandidate of ranked) {
      if (!rankedCandidate.evaluation.eligible) continue;
      const candidate = opponentResult.rows.find(
        (row) => row.player_key === rankedCandidate.candidate.playerKey,
      );
      if (!candidate) continue;
      // The pair lock makes the final block check linearizable with chat and
      // moderation after adaptive ranking has selected a bounded candidate.
      await lockPlayerPair(client, playerKey, candidate.player_key);
      if (await isPlayerPairBlocked(client, playerKey, candidate.player_key)) continue;
      const finalEvaluation = evaluateAdaptiveMatch(
        adaptiveEntry(requester), adaptiveEntry(candidate),
        { nowMs: Date.now(), blockedEitherDirection: false },
      );
      if (!finalEvaluation.eligible) continue;
      opponent = candidate;
      break;
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
          AND matchmaking_policy_version = $6 AND match_pool = $7
          AND status = 'waiting' AND game_id IS NULL`,
      [
        gameId,
        rules.rulesProfile,
        [opponent.player_key, playerKey],
        boardSize,
        timeControlId,
        ADAPTIVE_MATCH_POLICY_VERSION,
        pool,
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
