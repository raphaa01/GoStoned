import { randomUUID } from "node:crypto";
import { analyzeGameProgressively } from "@/lib/analysis/progressive";
import type { AnalysisInput } from "@/lib/analysis/types";
import { query } from "@/lib/db";
import type { KataGoEngine } from "./engine";

type ClaimedJob = { id: string; input: AnalysisInput; attempts: number };

type AnalysisRunOptions = {
  engineVersion: string;
  modelName: string;
  maxVisits: number;
  previewVisits: number;
  chunkMoves: number;
};

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
  options: AnalysisRunOptions & { jobId?: string },
): Promise<string | null> {
  const workerId = `analysis:${randomUUID()}`;
  const job = await claimJob(workerId, options.jobId);
  if (!job) return null;
  try {
    await completeClaimedAnalysis(engine, job, workerId, options);
    console.log(`Analysis ${job.id} completed.`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown KataGo worker error.";
    const finalAttempt = job.attempts >= 3;
    await query(
      `UPDATE game_analysis_jobs
          SET status = $2, result = NULL, progress = NULL,
              error_code = 'katago_analysis_failed', error_message = $3,
              lease_expires_at = NULL, worker_id = NULL, updated_at = NOW()
        WHERE id = $1 AND status = 'running' AND worker_id = $4`,
      [job.id, finalAttempt ? "failed" : "queued", message.slice(0, 1_000), workerId],
    );
    throw error;
  }
  return job.id;
}

export async function completeClaimedAnalysis(
  engine: KataGoEngine,
  job: ClaimedJob,
  workerId: string,
  options: AnalysisRunOptions,
): Promise<void> {
  const result = await analyzeGameProgressively({
    input: job.input,
    engineVersion: options.engineVersion,
    modelName: options.modelName,
    previewVisits: Math.min(options.previewVisits, options.maxVisits),
    qualityVisits: options.maxVisits,
    chunkMoves: options.chunkMoves,
    analyzePositions: (turnNumbers, visits, phase) => engine.analyzePositions(
      `${job.id}:${phase}:${turnNumbers[0]}-${turnNumbers[turnNumbers.length - 1]}`,
      job.input,
      visits,
      turnNumbers,
    ),
    publish: async (partial, progress) => {
      const update = await query(
        `UPDATE game_analysis_jobs
            SET result = $2::jsonb, progress = $3::jsonb, updated_at = NOW()
          WHERE id = $1 AND status = 'running' AND worker_id = $4`,
        [job.id, JSON.stringify(partial), JSON.stringify(progress), workerId],
      );
      if (update.rowCount !== 1) {
        throw new Error("The analysis job lease was lost while publishing progress.");
      }
    },
  });
  const update = await query(
    `UPDATE game_analysis_jobs
        SET status = 'completed', result = $2::jsonb, progress = NULL, completed_at = NOW(),
            lease_expires_at = NULL, error_code = NULL, error_message = NULL,
            updated_at = NOW()
      WHERE id = $1 AND status = 'running' AND worker_id = $3`,
    [job.id, JSON.stringify(result), workerId],
  );
  if (update.rowCount !== 1) {
    throw new Error("The analysis job lease was lost before completion.");
  }
}
