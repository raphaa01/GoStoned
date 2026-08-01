import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { botDifficultyForRating } from "@/lib/bot/difficulty";
import { botDisplayName, deterministicUnit } from "@/lib/bot/identity";
import { botStrengthForRating, GOSTONE_BOT_MODEL } from "@/lib/bot/modelV1";
import { query, withTransaction } from "@/lib/db";
import {
  DEFAULT_MATCH_RULES,
  resolveRulesConfiguration,
} from "@/lib/game/rulesPolicy";
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
import {
  selectNearestCalibratedBot,
  botConfigurationKey,
  type BotCalibrationEvidence,
  type BotGameConfiguration,
  type BotProfileCandidate,
  type CalibratedBotProfile,
} from "./calibratedBotPolicy";

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
  rules_snapshot?: "chinese";
  rules_version_snapshot?: string;
  scoring_method_snapshot?: "area";
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
  evaluation_now?: Date;
  bot_fallback_not_before?: Date | null;
};

type ActiveBotProfileRow = {
  profile_id: string;
  profile_contract_version: "calibrated-bot-profile-v1";
  profile_fingerprint: string;
  transparent_name: string;
  engine_family: string;
  engine_version: string;
  model_version: string;
  config_version: string;
  fixed_rating: string | number;
  fixed_rating_deviation: string | number;
  handicap_mode: "even" | "verified-handicap";
  acceptance_policy_version: "bot-calibration-acceptance-v1";
  source_revision: string;
  dataset_digest: string;
  runner_digest: string;
  reproduction_command: string;
  calibration_games: number;
  holdout_games: number;
  distinct_registered_humans: number;
  estimated_rating: string | number;
  standard_error: string | number;
  unresolved_audit_findings: number;
  activation_id: string | number;
  configurations: Array<{
    configurationKey: string;
    boardSize: BoardSize;
    timeControl: TimeControlId;
    rulesProfile: string;
    rulesVersion: string;
    komi: string | number;
    handicap: number;
    games: number;
  }>;
};

type CancellationOptions = {
  staleOnly?: boolean;
};

const CALIBRATED_BOT_FALLBACK_SECONDS = 10;
const MATCH_RULES_VERSION = DEFAULT_MATCH_RULES.rulesProfile;

async function matchWaitingPlayerWithBrowserBot(
  client: PoolClient,
  requester: QueueRow,
  configuration: BotGameConfiguration,
): Promise<MatchmakingStatus> {
  const rules = newGameRulesConfiguration();
  if (
    requester.rules_snapshot !== rules.ruleset
    || requester.rules_profile !== rules.rulesProfile
    || requester.scoring_method_snapshot !== rules.scoringMethod
    || Number(requester.komi_snapshot) !== rules.komi
    || requester.handicap_snapshot !== rules.handicap
  ) throw new Error("The queued rules snapshot changed before browser bot matching.");
  const timeControl = getTimeControl(requester.time_control);
  const targetRating = Math.max(600, Math.min(2_100, Math.round(Number(requester.rating_snapshot))));
  const targetDeviation = Math.max(
    80,
    Math.min(350, Math.round(Number(requester.rating_deviation_snapshot))),
  );
  const identitySeed = `${requester.player_key}:${requester.created_at.toISOString()}:${GOSTONE_BOT_MODEL.modelVersion}`;
  const botPlayerKey = `bot:${randomUUID()}`;
  const botIsBlack = deterministicUnit(`${identitySeed}:color`) < 0.5;
  const blackPlayerKey = botIsBlack ? botPlayerKey : requester.player_key;
  const whitePlayerKey = botIsBlack ? requester.player_key : botPlayerKey;
  const gameResult = await client.query<{ id: string }>(
    `INSERT INTO games (
       board_size,black_player_key,white_player_key,time_control,
       rules,rules_profile,scoring_method,komi,handicap,phase,to_move,
       main_time_seconds,byo_yomi_periods,byo_yomi_seconds,
       black_time_remaining_ms,white_time_remaining_ms,
       black_periods_remaining,white_periods_remaining,turn_started_at
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,'play',$10,
       $11,$12,$13,$14,$14,$12,$12,NOW()
     ) RETURNING id`,
    [
      requester.board_size, blackPlayerKey, whitePlayerKey, requester.time_control,
      rules.ruleset, rules.rulesProfile, rules.scoringMethod, rules.komi, rules.handicap,
      rules.policy.initialTurn, timeControl.mainTimeSeconds,
      timeControl.byoYomiPeriods, timeControl.byoYomiSeconds,
      timeControl.mainTimeSeconds * 1_000,
    ],
  );
  const gameId = gameResult.rows[0]?.id;
  if (!gameId) throw new Error("The browser bot game was not created.");
  const difficulty = botDifficultyForRating(targetRating);
  await client.query(
    `INSERT INTO game_bots (
       game_id,bot_player_key,display_name,color,target_rating,
       visits_per_turn,candidate_limit,temperature,rating_mode
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'browser-v1')`,
    [
      gameId, botPlayerKey, botDisplayName(identitySeed), botIsBlack ? "black" : "white",
      targetRating, difficulty.visitsPerTurn, difficulty.candidateLimit, difficulty.temperature,
    ],
  );
  const publication = await client.query(
    `UPDATE matchmaking_queue
        SET status='matched',game_id=$1,updated_at=NOW()
      WHERE player_key=$2 AND status='waiting' AND game_id IS NULL
        AND matchmaking_policy_version=$3 AND match_pool='registered-rated'`,
    [gameId, requester.player_key, ADAPTIVE_MATCH_POLICY_VERSION],
  );
  if (publication.rowCount !== 1) {
    throw new Error("Matchmaking changed before the browser bot game could be published.");
  }
  await client.query(
    `INSERT INTO game_browser_bot_bindings (
       game_id,bot_player_key,bot_color,human_player_key,model_contract_version,
       model_version,model_sha256,binding_version,configuration_key,
       opponent_rating,opponent_rating_deviation,strength_value,credit_mode,bound_game_version
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,'browser-bot-binding-v1',$8,$9,$10,$11,
               'fixed-versioned-profile',0)`,
    [
      gameId, botPlayerKey, botIsBlack ? "black" : "white", requester.player_key,
      GOSTONE_BOT_MODEL.contractVersion, GOSTONE_BOT_MODEL.modelVersion,
      GOSTONE_BOT_MODEL.artifactSha256, botConfigurationKey(configuration),
      targetRating, targetDeviation, botStrengthForRating(targetRating),
    ],
  );
  return {
    status: "matched",
    gameId,
    boardSize: requester.board_size,
    timeControl: requester.time_control,
  };
}

function newGameRulesConfiguration() {
  return resolveRulesConfiguration(DEFAULT_MATCH_RULES);
}

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
    rules: row.rules_snapshot ?? DEFAULT_MATCH_RULES.ruleset,
    rulesProfile: row.rules_profile,
    rulesVersion: row.rules_version_snapshot ?? MATCH_RULES_VERSION,
    scoringMethod: row.scoring_method_snapshot ?? DEFAULT_MATCH_RULES.scoringMethod,
    komi: Number(row.komi_snapshot ?? DEFAULT_MATCH_RULES.komi),
    handicap: row.handicap_snapshot ?? DEFAULT_MATCH_RULES.handicap,
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

function calibratedBotCandidate(row: ActiveBotProfileRow): BotProfileCandidate {
  const supportedConfigurations = row.configurations.map((configuration) => ({
    boardSize: configuration.boardSize,
    timeControl: configuration.timeControl,
    rulesProfile: configuration.rulesProfile,
    rulesVersion: configuration.rulesVersion,
    komi: Number(configuration.komi),
    handicap: configuration.handicap,
  }));
  const profile: CalibratedBotProfile = {
    contractVersion: row.profile_contract_version,
    profileId: row.profile_id,
    transparentName: row.transparent_name,
    engineFamily: row.engine_family,
    engineVersion: row.engine_version,
    modelVersion: row.model_version,
    configVersion: row.config_version,
    fixedRating: Number(row.fixed_rating),
    fixedRatingDeviation: Number(row.fixed_rating_deviation),
    supportedConfigurations,
    handicapMode: row.handicap_mode,
  };
  const evidence: BotCalibrationEvidence = {
    acceptancePolicyVersion: row.acceptance_policy_version,
    profileContractVersion: row.profile_contract_version,
    profileId: row.profile_id,
    profileFingerprint: row.profile_fingerprint,
    sourceRevision: row.source_revision,
    datasetDigest: row.dataset_digest,
    runnerDigest: row.runner_digest,
    reproductionCommand: row.reproduction_command,
    games: row.calibration_games,
    holdoutGames: row.holdout_games,
    distinctRegisteredHumans: row.distinct_registered_humans,
    estimatedRating: Number(row.estimated_rating),
    standardError: Number(row.standard_error),
    unresolvedAuditFindings: row.unresolved_audit_findings,
    coverage: row.configurations.map((configuration) => ({
      configurationKey: configuration.configurationKey,
      games: configuration.games,
    })),
  };
  return { profile, evidence };
}

async function matchWaitingPlayerWithCalibratedBot(
  client: PoolClient,
  requester: QueueRow,
  allowOnDemandBot: boolean,
): Promise<MatchmakingStatus | null> {
  const now = requester.evaluation_now;
  if (
    !allowOnDemandBot
    || requester.status !== "waiting"
    || requester.match_pool !== "registered-rated"
    || requester.rating_snapshot === null
    || requester.rating_snapshot === undefined
    || requester.rating_deviation_snapshot === null
    || requester.rating_deviation_snapshot === undefined
    || !(requester.bot_fallback_not_before instanceof Date)
    || !(now instanceof Date)
    || requester.bot_fallback_not_before > now
  ) return null;

  const configuration: BotGameConfiguration = {
    boardSize: requester.board_size,
    timeControl: requester.time_control,
    rulesProfile: requester.rules_profile,
    rulesVersion: requester.rules_version_snapshot ?? MATCH_RULES_VERSION,
    komi: Number(requester.komi_snapshot ?? DEFAULT_MATCH_RULES.komi),
    handicap: requester.handicap_snapshot ?? DEFAULT_MATCH_RULES.handicap,
  };
  // The paid/server KataGo profile path is deliberately bypassed. Normal bot
  // matches always bind the versioned browser-local GoStone model.
  const rows: ActiveBotProfileRow[] = [];
  const selection = selectNearestCalibratedBot({
    globalRating: Number(requester.rating_snapshot),
    ratingDeviation: Number(requester.rating_deviation_snapshot),
  }, configuration, rows.map(calibratedBotCandidate), requester.handicap_preference ?? "even-only");
  if (!selection) return matchWaitingPlayerWithBrowserBot(client, requester, configuration);
  const selectedRow = rows.find(({ profile_id }) => profile_id === selection.profile.profileId);
  if (!selectedRow) throw new Error("The selected calibrated bot profile disappeared.");

  const rules = newGameRulesConfiguration();
  if (
    requester.rules_snapshot !== rules.ruleset
    || requester.rules_profile !== rules.rulesProfile
    || requester.scoring_method_snapshot !== rules.scoringMethod
    || Number(requester.komi_snapshot) !== rules.komi
    || requester.handicap_snapshot !== rules.handicap
  ) throw new Error("The queued rules snapshot changed before calibrated bot matching.");
  const timeControl = getTimeControl(requester.time_control);
  const identitySeed = `${requester.player_key}:${requester.created_at.toISOString()}:${selection.profile.profileId}`;
  const botPlayerKey = `bot:${randomUUID()}`;
  const botIsBlack = deterministicUnit(`${identitySeed}:color`) < 0.5;
  const blackPlayerKey = botIsBlack ? botPlayerKey : requester.player_key;
  const whitePlayerKey = botIsBlack ? requester.player_key : botPlayerKey;
  const gameResult = await client.query<{ id: string }>(
    `INSERT INTO games (
       board_size,black_player_key,white_player_key,time_control,
       rules,rules_profile,scoring_method,komi,handicap,phase,to_move,
       main_time_seconds,byo_yomi_periods,byo_yomi_seconds,
       black_time_remaining_ms,white_time_remaining_ms,
       black_periods_remaining,white_periods_remaining,turn_started_at
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,'play',$10,
       $11,$12,$13,$14,$14,$12,$12,NOW()
     ) RETURNING id`,
    [
      requester.board_size, blackPlayerKey, whitePlayerKey, requester.time_control,
      rules.ruleset, rules.rulesProfile, rules.scoringMethod, rules.komi, rules.handicap,
      rules.policy.initialTurn, timeControl.mainTimeSeconds,
      timeControl.byoYomiPeriods, timeControl.byoYomiSeconds,
      timeControl.mainTimeSeconds * 1_000,
    ],
  );
  const gameId = gameResult.rows[0]?.id;
  if (!gameId) throw new Error("The calibrated bot game was not created.");
  const difficulty = botDifficultyForRating(selection.profile.fixedRating);
  await client.query(
    `INSERT INTO game_bots (
       game_id,bot_player_key,display_name,color,target_rating,
       visits_per_turn,candidate_limit,temperature,rating_mode
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'calibrated-v1')`,
    [
      gameId, botPlayerKey, selection.profile.transparentName,
      botIsBlack ? "black" : "white", difficulty.targetRating,
      difficulty.visitsPerTurn, difficulty.candidateLimit, difficulty.temperature,
    ],
  );
  const publication = await client.query(
    `UPDATE matchmaking_queue
        SET status='matched',game_id=$1,updated_at=NOW()
      WHERE player_key=$2 AND status='waiting' AND game_id IS NULL
        AND matchmaking_policy_version=$3 AND match_pool='registered-rated'
        AND bot_match_preference='calibrated-rated-after-wait'`,
    [gameId, requester.player_key, ADAPTIVE_MATCH_POLICY_VERSION],
  );
  if (publication.rowCount !== 1) {
    throw new Error("Matchmaking changed before the calibrated bot game could be published.");
  }
  await client.query(
    `INSERT INTO game_calibrated_bot_bindings (
       game_id,bot_player_key,bot_color,human_player_key,profile_id,activation_id,
       binding_version,profile_contract_version,profile_fingerprint,engine_family,
       engine_version,model_version,config_version,opponent_rating,
       opponent_rating_deviation,configuration_key,credit_mode,
       rating_credit_policy_version,bound_game_version
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,
       'calibrated-bot-rating-credit-v1',0
     )`,
    [
      gameId, botPlayerKey, botIsBlack ? "black" : "white", requester.player_key,
      selection.binding.profileId, selectedRow.activation_id,
      selection.binding.bindingVersion, selection.binding.profileContractVersion,
      selection.binding.profileFingerprint, selection.binding.engineFamily,
      selection.binding.engineVersion, selection.binding.modelVersion,
      selection.binding.configVersion, selection.binding.opponentRating,
      selection.binding.opponentRatingDeviation, selection.binding.configurationKey,
      selection.binding.creditMode,
    ],
  );
  return {
    status: "matched",
    gameId,
    boardSize: requester.board_size,
    timeControl: requester.time_control,
  };
}

export async function getMatchmakingStatus(
  playerKey: string,
  options: { allowOnDemandBot?: boolean } = {},
): Promise<MatchmakingStatus> {
  const result = await query<QueueRow>(
    `SELECT q.*,
            g.status AS game_status,
            q.updated_at < NOW() - INTERVAL '5 minutes' AS is_stale,
            statement_timestamp() AS evaluation_now
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
  if (row?.status === "waiting") {
    return joinMatchmaking(playerKey, row.board_size, row.time_control, {
      preserveWaitingSince: true,
      allowOnDemandBot: options.allowOnDemandBot === true,
    });
  }
  return mapQueue(row);
}

export async function joinMatchmaking(
  playerKey: string,
  boardSize: BoardSize,
  timeControlId: TimeControlId,
  options: { preserveWaitingSince?: boolean; allowOnDemandBot?: boolean } = {},
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
      rating_updated_at: string;
      preference_revision: number;
      display_preference: RatingDisplayPreference;
      bot_match_preference: BotMatchPreference;
      handicap_preference: "even-only" | "verified-handicap-ok";
    }>(
      `SELECT rating.rating::double precision AS rating,
              rating.rating_deviation::double precision AS rating_deviation,
              rating.algorithm_version,
              rating.updated_at::text AS rating_updated_at,
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
        ADAPTIVE_MATCH_POLICY_VERSION, pool, rules.ruleset, MATCH_RULES_VERSION,
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
              g.status AS game_status,
              statement_timestamp() AS evaluation_now
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

    const existingRow = existing.rows[0];
    const preserveWaitingSince = options.preserveWaitingSince === true
      && existingRow?.status === "waiting"
      && existingRow.game_id === null
      && existingRow.board_size === boardSize
      && existingRow.time_control === timeControlId
      && existingRow.rules_profile === rules.rulesProfile
      && existingRow.matchmaking_policy_version === ADAPTIVE_MATCH_POLICY_VERSION
      && existingRow.match_pool === pool;
    const requesterResult = preserveWaitingSince
      ? { rows: [existingRow], rowCount: 1 }
      : await client.query<QueueRow>(
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
          RETURNING *,statement_timestamp() AS evaluation_now`,
        [
          playerKey, boardSize, timeControlId, rules.rulesProfile,
          ADAPTIVE_MATCH_POLICY_VERSION, pool, rules.ruleset, MATCH_RULES_VERSION,
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
        `SELECT q.*,statement_timestamp() AS evaluation_now
           FROM matchmaking_queue q
          WHERE q.board_size = $1 AND q.time_control = $2
            AND q.rules_profile = $3
            AND q.status = 'waiting' AND q.player_key <> $4
            AND q.matchmaking_policy_version = $5
            AND q.match_pool = $6
            AND q.updated_at >= NOW() - INTERVAL '5 minutes'
            AND q.abandonment_risk <> 'restricted'
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
            AND (
              $6::text = 'guest-unrated'
              OR ABS(q.rating_snapshot - $7::numeric) <=
                LEAST(500::numeric,
                  100 + 20 * GREATEST(
                    EXTRACT(EPOCH FROM (statement_timestamp() - q.created_at)),
                    EXTRACT(EPOCH FROM (statement_timestamp() - $9::timestamptz))
                  ) / 60
                )
                + LEAST(200::numeric,
                    0.35 * (q.rating_deviation_snapshot + $8::numeric))
            )
          ORDER BY q.created_at, q.player_key
          LIMIT 8
          FOR UPDATE SKIP LOCKED`,
        [
          boardSize, timeControlId, rules.rulesProfile, playerKey,
          ADAPTIVE_MATCH_POLICY_VERSION, pool,
          requester.rating_snapshot ?? 0,
          requester.rating_deviation_snapshot ?? 350,
          requester.created_at,
        ],
      );
    const evaluationNowMs = opponentResult.rows[0]?.evaluation_now?.getTime()
      ?? requester.evaluation_now?.getTime()
      ?? Date.now();
    const ranked = rankAdaptiveMatchCandidates(
      adaptiveEntry(requester),
      opponentResult.rows.map(adaptiveEntry),
      () => ({ nowMs: evaluationNowMs, blockedEitherDirection: false }),
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
        { nowMs: evaluationNowMs, blockedEitherDirection: false },
      );
      if (!finalEvaluation.eligible) continue;
      opponent = candidate;
      break;
    }
    if (!opponent) {
      const botMatch = await matchWaitingPlayerWithCalibratedBot(
        client,
        requester,
        options.allowOnDemandBot === true,
      );
      if (botMatch) return botMatch;
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
