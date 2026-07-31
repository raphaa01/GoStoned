import { randomUUID } from "node:crypto";
import { buildGameAnalysis } from "@/lib/analysis/evaluate";
import type { AnalysisInput } from "@/lib/analysis/types";
import { query } from "@/lib/db";
import type { KataGoEngine } from "./engine";

type ClaimedJob = { id: string; input: AnalysisInput; attempts: number };

async function claimJob(workerId: string, jobId?: string): Promise<ClaimedJob | null> {
  await query(
    `UPDATE game_analysis_jobs
        SET status = 'failed', error_code = 'worker_retries_exhausted',
            error_message = 'The analysis worker stopped before completing this job.',
            lease_expires_at = NULL, worker_id = NULL, updated_at = NOW()
      WHERE status = 'running' AND attempts >= 3 AND lease_expires_at < NOW()`,
  );
  const result = await query<ClaimedJob>(
    `UPDATE game_analysis_jobs
        SET status = 'running', attempts = attempts + 1, worker_id = $1,
            started_at = COALESCE(started_at, NOW()),
            lease_expires_at = NOW() + INTERVAL '20 minutes', updated_at = NOW()
      WHERE id = (
        SELECT id FROM game_analysis_jobs
         WHERE attempts < 3
           AND ($2::uuid IS NULL OR id = $2::uuid)
           AND (status = 'queued' OR (status = 'running' AND lease_expires_at < NOW()))
         ORDER BY created_at, id
         FOR UPDATE SKIP LOCKED
         LIMIT 1
      )
      RETURNING id, input, attempts`,
    [workerId, jobId ?? null],
  );
  return result.rows[0] ?? null;
}

export async function runAnalysisOnce(
  engine: KataGoEngine,
  options: { engineVersion: string; modelName: string; maxVisits: number; jobId?: string },
): Promise<string | null> {
  const workerId = `analysis:${randomUUID()}`;
  const job = await claimJob(workerId, options.jobId);
  if (!job) return null;
  try {
    const turns = await engine.analyze(job.id, job.input, options.maxVisits);
    const result = buildGameAnalysis(job.input, turns, {
      version: options.engineVersion,
      model: options.modelName,
      visitsPerTurn: options.maxVisits,
    });
    await query(
      `UPDATE game_analysis_jobs
          SET status = 'completed', result = $2::jsonb, completed_at = NOW(),
              lease_expires_at = NULL, error_code = NULL, error_message = NULL,
              updated_at = NOW()
        WHERE id = $1 AND status = 'running' AND worker_id = $3`,
      [job.id, JSON.stringify(result), workerId],
    );
    console.log(`Analysis ${job.id} completed.`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown KataGo worker error.";
    const finalAttempt = job.attempts >= 3;
    await query(
      `UPDATE game_analysis_jobs
          SET status = $2, error_code = 'katago_analysis_failed', error_message = $3,
              lease_expires_at = NULL, worker_id = NULL, updated_at = NOW()
        WHERE id = $1 AND status = 'running' AND worker_id = $4`,
      [job.id, finalAttempt ? "failed" : "queued", message.slice(0, 1_000), workerId],
    );
    throw error;
  }
  return job.id;
}
