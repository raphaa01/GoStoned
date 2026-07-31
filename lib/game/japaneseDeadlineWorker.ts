import { query } from "@/lib/db";
import { GameServiceError } from "./gameServiceError";
import { resolveJapaneseScoringDeadline } from "./japaneseGameService";

export const JAPANESE_DEADLINE_BATCH_ENV = "JAPANESE_DEADLINE_RESOLVER_BATCH" as const;
export const DEFAULT_JAPANESE_DEADLINE_BATCH = 20;

type ExpiredJapaneseScoringRow = {
  game_id: string;
  revision: number;
  resolver_player_key: string;
};

export type JapaneseDeadlineBatchResult = Readonly<{
  discovered: number;
  resolved: number;
  reconciled: number;
  failed: number;
}>;

export function japaneseDeadlineBatchSize(
  raw = process.env[JAPANESE_DEADLINE_BATCH_ENV],
): number {
  if (raw === undefined || raw === "") return DEFAULT_JAPANESE_DEADLINE_BATCH;
  if (!/^[1-9]\d*$/.test(raw)) {
    throw new Error(`${JAPANESE_DEADLINE_BATCH_ENV} must be a positive whole number.`);
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value > 100) {
    throw new Error(`${JAPANESE_DEADLINE_BATCH_ENV} must be between 1 and 100.`);
  }
  return value;
}

function alreadyReconciled(error: unknown): boolean {
  return error instanceof GameServiceError && (
    error.code === "not_scoring"
    || error.code === "game_finished"
    || error.code === "scoring_revision_conflict"
  );
}

/**
 * Runs one bounded discovery pass. Candidate selection never mutates gameplay;
 * every resolution re-enters the normal game-first transaction and therefore
 * remains safe when several application instances discover the same row.
 */
export async function resolveExpiredJapaneseScoringBatch(
  limit = japaneseDeadlineBatchSize(),
): Promise<JapaneseDeadlineBatchResult> {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new Error("Japanese deadline batch limit must be between 1 and 100.");
  }
  const candidates = await query<ExpiredJapaneseScoringRow>(
    `SELECT scoring.game_id,scoring.revision,
            game.black_player_key AS resolver_player_key
       FROM game_japanese_scoring_state AS scoring
       JOIN games AS game ON game.id=scoring.game_id
      WHERE game.status='active' AND game.phase='scoring'
        AND game.rules='japanese'
        AND game.rules_profile='japanese-1989-gostone-v1'
        AND game.scoring_method='territory' AND game.komi=6.5 AND game.handicap=0
        AND scoring.expires_at<=NOW()
      ORDER BY scoring.expires_at,scoring.game_id
      LIMIT $1`,
    [limit],
  );
  let resolved = 0;
  let reconciled = 0;
  let failed = 0;
  for (const candidate of candidates.rows) {
    try {
      await resolveJapaneseScoringDeadline(
        candidate.game_id,
        candidate.resolver_player_key,
        candidate.revision,
      );
      resolved += 1;
    } catch (error) {
      if (alreadyReconciled(error)) reconciled += 1;
      else {
        failed += 1;
        console.error("Japanese scoring deadline resolution failed", {
          gameId: candidate.game_id,
          revision: candidate.revision,
          errorClass: error instanceof GameServiceError ? error.code : "internal_error",
        });
      }
    }
  }
  return Object.freeze({
    discovered: candidates.rows.length,
    resolved,
    reconciled,
    failed,
  });
}
