import { query, withTransaction } from "@/lib/db";
import { GameServiceError, getGameState } from "@/lib/game/gameService";
import type { GameState } from "@/lib/game/types";
import { toGtpCoordinate } from "./coordinates";
import {
  ANALYSIS_ENGINE_CONTRACT_VERSION,
  type AnalysisInput,
  type AnalysisJobStatus,
  type AnalysisJobView,
  type GameAnalysisResult,
} from "./types";

type AnalysisJobRow = {
  id: string;
  game_id: string;
  game_version: number;
  status: AnalysisJobStatus;
  attempts: number;
  result: GameAnalysisResult | null;
  error_code: string | null;
  created_at: Date;
  started_at: Date | null;
  completed_at: Date | null;
};

type AnalysisAccountRow = {
  analysis_unlimited: boolean;
};

type AnalysisUsageRow = {
  used: number;
  retry_after_seconds: number | null;
};

export class WeeklyAnalysisLimitError extends GameServiceError {
  constructor(public readonly retryAfterSeconds: number) {
    super(
      "This account has already started its weekly KataGo analysis.",
      429,
      "analysis_weekly_limit",
    );
    this.name = "WeeklyAnalysisLimitError";
  }
}

function jobView(row: AnalysisJobRow): AnalysisJobView {
  return {
    id: row.id,
    gameId: row.game_id,
    gameVersion: row.game_version,
    status: row.status,
    attempts: row.attempts,
    result: row.result,
    errorCode: row.error_code,
    createdAt: row.created_at.toISOString(),
    startedAt: row.started_at?.toISOString() ?? null,
    completedAt: row.completed_at?.toISOString() ?? null,
  };
}

function analysisInput(game: GameState): AnalysisInput {
  return {
    contractVersion: ANALYSIS_ENGINE_CONTRACT_VERSION,
    gameId: game.id,
    gameVersion: game.version,
    boardSize: game.boardSize,
    komi: game.komi,
    rules: game.ruleset,
    moves: game.moves.map((move) => ({
      color: move.color,
      move: toGtpCoordinate(game.boardSize, move),
    })),
  };
}

function assertAnalyzable(game: GameState): void {
  if (game.status !== "finished") {
    throw new GameServiceError("Only completed games can be analyzed.", 409, "analysis_game_active");
  }
  if (game.moves.length === 0) {
    throw new GameServiceError("This game has no moves to analyze.", 409, "analysis_empty_game");
  }
}

export async function readGameAnalysis(gameId: string, playerKey: string) {
  const game = await getGameState(gameId, playerKey);
  assertAnalyzable(game);
  const result = await query<AnalysisJobRow>(
    `SELECT id, game_id, game_version, status, attempts, result, error_code,
            created_at, started_at, completed_at
       FROM game_analysis_jobs
      WHERE game_id = $1 AND game_version = $2`,
    [game.id, game.version],
  );
  return { game, analysis: result.rows[0] ? jobView(result.rows[0]) : null };
}

export async function queueGameAnalysis(gameId: string, playerKey: string, userId: string) {
  const game = await getGameState(gameId, playerKey);
  assertAnalyzable(game);
  const input = analysisInput(game);
  const row = await withTransaction(async (client) => {
    const accountResult = await client.query<AnalysisAccountRow>(
      `SELECT COALESCE(
                (to_jsonb(users) ->> 'analysis_unlimited')::boolean,
                false
              ) AS analysis_unlimited
         FROM users
        WHERE id = $1
        FOR UPDATE`,
      [userId],
    );
    const account = accountResult.rows[0];
    if (!account) {
      throw new GameServiceError("Please log in first.", 401, "authentication_required");
    }

    const existingResult = await client.query<AnalysisJobRow>(
      `SELECT id, game_id, game_version, status, attempts, result, error_code,
              created_at, started_at, completed_at
         FROM game_analysis_jobs
        WHERE game_id = $1 AND game_version = $2`,
      [game.id, game.version],
    );
    const existing = existingResult.rows[0];
    if (existing && existing.status !== "failed") return existing;

    if (!existing && !account.analysis_unlimited) {
      const usageResult = await client.query<AnalysisUsageRow>(
        `SELECT COUNT(*)::int AS used,
                GREATEST(
                  1,
                  CEIL(EXTRACT(EPOCH FROM (
                    MIN(created_at) + INTERVAL '7 days' - statement_timestamp()
                  )))
                )::int AS retry_after_seconds
           FROM game_analysis_jobs
          WHERE requested_by_key = $1
            AND created_at > statement_timestamp() - INTERVAL '7 days'`,
        [playerKey],
      );
      const usage = usageResult.rows[0];
      if (usage && usage.used >= 1) {
        throw new WeeklyAnalysisLimitError(usage.retry_after_seconds ?? 1);
      }
    }

    const result = await client.query<AnalysisJobRow>(
      `INSERT INTO game_analysis_jobs
         (game_id, game_version, requested_by_key, status, input)
       VALUES ($1, $2, $3, 'queued', $4::jsonb)
       ON CONFLICT (game_id, game_version) DO UPDATE
         SET status = CASE
               WHEN game_analysis_jobs.status = 'failed' THEN 'queued'
               ELSE game_analysis_jobs.status
             END,
             attempts = CASE
               WHEN game_analysis_jobs.status = 'failed' THEN 0
               ELSE game_analysis_jobs.attempts
             END,
             error_code = CASE
               WHEN game_analysis_jobs.status = 'failed' THEN NULL
               ELSE game_analysis_jobs.error_code
             END,
             error_message = CASE
               WHEN game_analysis_jobs.status = 'failed' THEN NULL
               ELSE game_analysis_jobs.error_message
             END,
             lease_expires_at = CASE
               WHEN game_analysis_jobs.status = 'failed' THEN NULL
               ELSE game_analysis_jobs.lease_expires_at
             END,
             worker_id = CASE
               WHEN game_analysis_jobs.status = 'failed' THEN NULL
               ELSE game_analysis_jobs.worker_id
             END,
             started_at = CASE
               WHEN game_analysis_jobs.status = 'failed' THEN NULL
               ELSE game_analysis_jobs.started_at
             END,
             completed_at = CASE
               WHEN game_analysis_jobs.status = 'failed' THEN NULL
               ELSE game_analysis_jobs.completed_at
             END,
             updated_at = NOW()
       RETURNING id, game_id, game_version, status, attempts, result, error_code,
                 created_at, started_at, completed_at`,
      [game.id, game.version, playerKey, JSON.stringify(input)],
    );
    const queued = result.rows[0];
    if (!queued) throw new Error("Analysis job did not return a result.");
    return queued;
  });
  return { game, analysis: jobView(row) };
}
