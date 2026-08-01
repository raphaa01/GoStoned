import { randomUUID } from "node:crypto";
import { toGtpCoordinate } from "@/lib/analysis/coordinates";
import { ANALYSIS_ENGINE_CONTRACT_VERSION, type AnalysisInput } from "@/lib/analysis/types";
import { query } from "@/lib/db";
import {
  KATAGO_OPPONENT_OWNERSHIP_THRESHOLD,
  type CanonicalKataGoScoringRequest,
  type KataGoScoringResponse,
  type KataGoStoneAssessment,
} from "@/lib/katago/contracts";
import type { KataGoEngine } from "./engine";

type ClaimedScoringJob = {
  id: string;
  request: CanonicalKataGoScoringRequest;
  attempts: number;
};

export type ScoringWorkerIdentity = Readonly<{
  engineVersion: string;
  modelVersion: string;
  configVersion: string;
  maxVisits: number;
}>;

async function claimScoringJob(
  workerId: string,
  jobId?: string,
): Promise<ClaimedScoringJob | null> {
  await query(
    `UPDATE katago_scoring_jobs
        SET status='failed',error_code='worker_retries_exhausted',
            error_message='The scoring worker stopped before completing this job.',
            lease_expires_at=NULL,worker_id=NULL,updated_at=NOW()
      WHERE status='running' AND attempts>=3 AND lease_expires_at<NOW()`,
  );
  const result = await query<ClaimedScoringJob>(
    `UPDATE katago_scoring_jobs
        SET status='running',attempts=attempts+1,worker_id=$1,
            started_at=COALESCE(started_at,NOW()),
            lease_expires_at=NOW()+INTERVAL '2 minutes',updated_at=NOW()
      WHERE id=(
        SELECT id FROM katago_scoring_jobs
         WHERE attempts<3 AND ($2::uuid IS NULL OR id=$2::uuid)
           AND (status='queued' OR (status='running' AND lease_expires_at<NOW()))
         ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT 1
      )
      RETURNING id,request,attempts`,
    [workerId, jobId ?? null],
  );
  return result.rows[0] ?? null;
}

function analysisInput(request: CanonicalKataGoScoringRequest): AnalysisInput {
  return {
    contractVersion: ANALYSIS_ENGINE_CONTRACT_VERSION,
    gameId: request.gameId,
    gameVersion: request.stoppedMoveNumber,
    boardSize: request.boardSize,
    komi: request.rules.komi,
    rules: request.rules.ruleset === "japanese" ? "japanese" : "chinese",
    moves: request.moves.map((move) => ({
      color: move.color,
      move: toGtpCoordinate(request.boardSize, move),
    })),
  };
}

function stoneAssessments(
  request: CanonicalKataGoScoringRequest,
  ownership: readonly number[],
): readonly KataGoStoneAssessment[] {
  const expected = request.boardSize * request.boardSize;
  if (ownership.length !== expected) {
    throw new Error(`KataGo ownership contained ${ownership.length} points instead of ${expected}.`);
  }
  const stones: KataGoStoneAssessment[] = [];
  for (let y = 0; y < request.boardSize; y += 1) {
    for (let x = 0; x < request.boardSize; x += 1) {
      const color = request.board[y][x];
      if (!color) continue;
      const value = ownership[y * request.boardSize + x];
      if (!Number.isFinite(value) || value < -1 || value > 1) {
        throw new Error("KataGo ownership was outside the supported range.");
      }
      const own = color === "black" ? value : -value;
      const opponent = -own;
      const status = opponent >= KATAGO_OPPONENT_OWNERSHIP_THRESHOLD
        ? "dead"
        : own >= KATAGO_OPPONENT_OWNERSHIP_THRESHOLD
          ? "alive"
          : "unknown";
      stones.push({ x, y, status, confidence: Math.min(1, Math.abs(value)) });
    }
  }
  return stones;
}

async function completeScoringJob(
  engine: KataGoEngine,
  job: ClaimedScoringJob,
  workerId: string,
  identity: ScoringWorkerIdentity,
): Promise<void> {
  const request = job.request;
  if (
    request.engine.engineVersion !== identity.engineVersion
    || request.engine.modelVersion !== identity.modelVersion
    || request.engine.configVersion !== identity.configVersion
  ) {
    throw new Error("The scoring request does not match this worker's engine identity.");
  }
  const visitLimit = Math.max(1, Math.min(request.maxVisits, identity.maxVisits));
  const turn = await engine.analyzeCurrent(
    `scoring:${job.id}`,
    analysisInput(request),
    visitLimit,
    { includeOwnership: true, priority: 120, reportDuringSearchEvery: 0.25, timeoutMs: 20_000 },
  );
  if (!turn.ownership) throw new Error("KataGo did not return scoring ownership.");
  const result: KataGoScoringResponse = {
    contractVersion: request.contractVersion,
    analysisPurpose: request.analysisPurpose,
    requestIdentity: request.requestIdentity,
    gameId: request.gameId,
    stoppedBoardHash: request.stoppedBoardHash,
    stoppedMoveNumber: request.stoppedMoveNumber,
    scoringRevision: request.scoringRevision,
    boardSize: request.boardSize,
    rules: request.rules,
    playerToMove: request.playerToMove,
    engine: {
      name: "KataGo",
      engineVersion: identity.engineVersion,
      modelVersion: identity.modelVersion,
      configVersion: identity.configVersion,
      visits: Math.max(1, Math.min(visitLimit, Math.trunc(turn.rootInfo.visits))),
    },
    ownership: Array.from({ length: request.boardSize }, (_, y) =>
      turn.ownership!.slice(y * request.boardSize, (y + 1) * request.boardSize)
    ),
    stones: stoneAssessments(request, turn.ownership),
  };
  const updated = await query(
    `UPDATE katago_scoring_jobs
        SET status='completed',result=$2::jsonb,completed_at=NOW(),
            lease_expires_at=NULL,error_code=NULL,error_message=NULL,updated_at=NOW()
      WHERE id=$1 AND status='running' AND worker_id=$3`,
    [job.id, JSON.stringify(result), workerId],
  );
  if (updated.rowCount !== 1) throw new Error("The scoring job lease changed before publication.");
}

async function failScoringJob(
  job: ClaimedScoringJob,
  workerId: string,
  error: unknown,
): Promise<void> {
  const message = error instanceof Error ? error.message : "Unknown KataGo scoring error.";
  await query(
    `UPDATE katago_scoring_jobs
        SET status='failed',error_code='katago_scoring_failed',error_message=$2,
            lease_expires_at=NULL,worker_id=NULL,updated_at=NOW()
      WHERE id=$1 AND status='running' AND worker_id=$3`,
    [job.id, message.slice(0, 1_000), workerId],
  );
  console.error(`Scoring ${job.id} failed on attempt ${job.attempts}:`, message);
}

export async function runScoringOnce(
  engine: KataGoEngine,
  identity: ScoringWorkerIdentity,
  jobId?: string,
): Promise<string | null> {
  const workerId = `scoring:${randomUUID()}`;
  const job = await claimScoringJob(workerId, jobId);
  if (!job) return null;
  try {
    await completeScoringJob(engine, job, workerId, identity);
    console.log(`Scoring ${job.id} completed.`);
    return job.id;
  } catch (error) {
    await failScoringJob(job, workerId, error);
    return null;
  }
}
