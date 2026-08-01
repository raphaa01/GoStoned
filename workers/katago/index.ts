import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { hostname } from "node:os";
import { buildGameAnalysis } from "@/lib/analysis/evaluate";
import type { AnalysisInput } from "@/lib/analysis/types";
import { closePool, query } from "@/lib/db";
import { KataGoEngine } from "./engine";
import { runPuzzleLoop, type PuzzleLoopState } from "./puzzles";

type ClaimedJob = { id: string; input: AnalysisInput; attempts: number };

const workerId = `${hostname()}:${randomUUID()}`;
const pollMs = Math.max(500, Number(process.env.KATAGO_POLL_INTERVAL_MS) || 2_000);
const maxVisits = Math.max(20, Number(process.env.KATAGO_MAX_VISITS) || 20);
const engineVersion = process.env.KATAGO_VERSION || "v1.17.0";
const modelName = process.env.KATAGO_MODEL_NAME || "b10c384h6nbttflrs";
const engineOptions = {
  binary: process.env.KATAGO_BINARY || "/opt/katago/katago",
  model: process.env.KATAGO_MODEL || "/opt/katago/model.bin.gz",
  config: process.env.KATAGO_CONFIG || "/opt/katago/analysis.cfg",
};
const analysisEngine = new KataGoEngine(engineOptions);
let stopping = false;
let activeJob: string | null = null;
const puzzleState: PuzzleLoopState = { activeJobId: null };
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

async function publishWorkerHeartbeat(ready: boolean): Promise<void> {
  await query(
    `INSERT INTO katago_workers (
       worker_id, capabilities, engine_version, model_name, ready, last_seen_at
     ) VALUES ($1, ARRAY['analysis', 'puzzle'], $2, $3, $4, NOW())
     ON CONFLICT (worker_id) DO UPDATE
       SET capabilities = EXCLUDED.capabilities,
           engine_version = EXCLUDED.engine_version,
           model_name = EXCLUDED.model_name,
           ready = EXCLUDED.ready,
           last_seen_at = EXCLUDED.last_seen_at`,
    [workerId, engineVersion, modelName, ready],
  );
}

async function claimJob(): Promise<ClaimedJob | null> {
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
           AND (status = 'queued' OR (status = 'running' AND lease_expires_at < NOW()))
         ORDER BY created_at, id
         FOR UPDATE SKIP LOCKED
         LIMIT 1
      )
      RETURNING id, input, attempts`,
    [workerId],
  );
  return result.rows[0] ?? null;
}

async function finishJob(job: ClaimedJob) {
  const turns = await analysisEngine.analyze(job.id, job.input, maxVisits);
  const result = buildGameAnalysis(job.input, turns, {
    version: engineVersion,
    model: modelName,
    visitsPerTurn: maxVisits,
  });
  await query(
    `UPDATE game_analysis_jobs
        SET status = 'completed', result = $2::jsonb, completed_at = NOW(),
            lease_expires_at = NULL, error_code = NULL, error_message = NULL,
            updated_at = NOW()
      WHERE id = $1 AND status = 'running' AND worker_id = $3`,
    [job.id, JSON.stringify(result), workerId],
  );
}

async function failJob(job: ClaimedJob, error: unknown) {
  const message = error instanceof Error ? error.message : "Unknown KataGo worker error.";
  const finalAttempt = job.attempts >= 3;
  await query(
    `UPDATE game_analysis_jobs
        SET status = $2, error_code = $3, error_message = $4,
            lease_expires_at = NULL, worker_id = NULL, updated_at = NOW()
      WHERE id = $1 AND status = 'running' AND worker_id = $5`,
    [job.id, finalAttempt ? "failed" : "queued", "katago_analysis_failed", message.slice(0, 1_000), workerId],
  );
  console.error(`Analysis ${job.id} failed on attempt ${job.attempts}:`, message);
}

async function loop() {
  while (!stopping) {
    const job = await claimJob();
    if (!job) {
      await new Promise((resolve) => setTimeout(resolve, pollMs));
      continue;
    }
    activeJob = job.id;
    try {
      await finishJob(job);
      console.log(`Analysis ${job.id} completed.`);
    } catch (error) {
      await failJob(job, error);
    } finally {
      activeJob = null;
    }
  }
}

const healthPort = Math.max(1, Number(process.env.PORT) || 8080);
const healthServer = createServer((request, response) => {
  if (request.url !== "/health") {
    response.writeHead(404).end();
    return;
  }
  response.setHeader("content-type", "application/json");
  response.statusCode = analysisEngine.running ? 200 : 503;
  response.end(JSON.stringify({
    ok: analysisEngine.running,
    service: "gostone-katago-worker",
    activeJob,
    activePuzzleJob: puzzleState.activeJobId,
    error: analysisEngine.error,
  }));
});
healthServer.listen(healthPort, "0.0.0.0", () => {
  console.log(`GoStone KataGo worker ${workerId} listening on :${healthPort}.`);
});

async function shutdown() {
  if (stopping) return;
  stopping = true;
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  healthServer.close();
  await publishWorkerHeartbeat(false).catch(() => undefined);
  analysisEngine.close();
  await closePool();
}

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());

publishWorkerHeartbeat(analysisEngine.running).then(() => {
  heartbeatTimer = setInterval(() => {
    void publishWorkerHeartbeat(analysisEngine.running)
      .catch((error) => console.error("KataGo heartbeat failed:", error));
  }, 5_000);
}).catch((error) => console.error("Initial KataGo heartbeat failed:", error));

Promise.all([
  loop(),
  runPuzzleLoop(analysisEngine, puzzleState, () => stopping, { engineVersion, modelName }),
]).catch(async (error) => {
  console.error("KataGo worker stopped:", error);
  await shutdown();
  process.exitCode = 1;
});
