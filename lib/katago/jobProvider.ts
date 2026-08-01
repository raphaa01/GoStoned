import { query } from "@/lib/db";
import { dispatchKataGoJob, isKataGoOnDemandConfigured } from "./dispatch";
import type {
  CanonicalKataGoScoringRequest,
  KataGoScoringProvider,
} from "./contracts";
import { kataGoError } from "./errors";

type ScoringJobRow = {
  id: string;
  request: CanonicalKataGoScoringRequest;
  status: "queued" | "running" | "completed" | "failed";
  result: unknown | null;
  attempts: number;
  error_code: string | null;
};

type QueryLike = typeof query;
type DispatchLike = (kind: "analysis", targetId: string) => Promise<boolean>;

type JobProviderOptions = Readonly<{
  query?: QueryLike;
  dispatch?: DispatchLike;
  pollIntervalMs?: number;
}>;

function sameRequest(
  stored: CanonicalKataGoScoringRequest,
  requested: CanonicalKataGoScoringRequest,
): boolean {
  return JSON.stringify(stored) === JSON.stringify(requested);
}

class KataGoScoringJobProvider implements KataGoScoringProvider {
  readonly kind: "hosted-http" | "local-http";
  private readonly runQuery: QueryLike;
  private readonly dispatch: DispatchLike | null;
  private readonly pollIntervalMs: number;

  constructor(
    kind: "hosted-http" | "local-http",
    options: JobProviderOptions = {},
  ) {
    this.kind = kind;
    this.runQuery = options.query ?? query;
    this.dispatch = kind === "hosted-http"
      ? options.dispatch ?? dispatchKataGoJob
      : null;
    this.pollIntervalMs = options.pollIntervalMs ?? 200;
    if (
      !Number.isSafeInteger(this.pollIntervalMs)
      || this.pollIntervalMs < 25
      || this.pollIntervalMs > 2_000
    ) {
      throw kataGoError("provider_not_configured", "The KataGo scoring poll interval is invalid.");
    }
  }

  private async load(requestIdentity: string): Promise<ScoringJobRow> {
    const result = await this.runQuery<ScoringJobRow>(
      `SELECT id,request,status,result,attempts,error_code
         FROM katago_scoring_jobs
        WHERE request_identity=$1`,
      [requestIdentity],
    );
    const row = result.rows[0];
    if (!row) {
      throw kataGoError("provider_unavailable", "The durable KataGo scoring job disappeared.", {
        retryable: true,
      });
    }
    return row;
  }

  async analyze(
    request: CanonicalKataGoScoringRequest,
    options: Readonly<{ signal: AbortSignal }>,
  ): Promise<unknown> {
    await this.runQuery(
      `INSERT INTO katago_scoring_jobs (
         request_identity,game_id,scoring_revision,analysis_purpose,request
       ) VALUES ($1,$2,$3,$4,$5::jsonb)
       ON CONFLICT (request_identity) DO NOTHING`,
      [
        request.requestIdentity,
        request.gameId,
        request.scoringRevision,
        request.analysisPurpose,
        JSON.stringify(request),
      ],
    );
    let row = await this.load(request.requestIdentity);
    if (!sameRequest(row.request, request)) {
      throw kataGoError("stale_response", "The durable KataGo job has conflicting request evidence.");
    }
    if (row.status === "failed" && row.attempts < 3) {
      await this.runQuery(
        `UPDATE katago_scoring_jobs
            SET status='queued',error_code=NULL,error_message=NULL,updated_at=NOW()
          WHERE id=$1 AND status='failed' AND attempts<3`,
        [row.id],
      );
      row = await this.load(request.requestIdentity);
    }
    if (this.dispatch && row.status === "queued") {
      const dispatched = await this.dispatch("analysis", row.id);
      if (!dispatched) {
        throw kataGoError("provider_not_configured", "The Modal KataGo dispatcher is not configured.");
      }
    }
    while (!options.signal.aborted) {
      if (row.status === "completed") {
        if (row.result === null) {
          throw kataGoError("invalid_response", "The completed KataGo scoring job has no result.");
        }
        return row.result;
      }
      if (row.status === "failed") {
        throw kataGoError(
          "provider_unavailable",
          `The KataGo scoring worker failed (${row.error_code ?? "unknown"}).`,
          { retryable: row.attempts < 3 },
        );
      }
      await new Promise<void>((resolve, reject) => {
        const abort = () => {
          clearTimeout(timer);
          reject(kataGoError("request_aborted", "KataGo scoring was cancelled."));
        };
        const timer = setTimeout(() => {
          options.signal.removeEventListener("abort", abort);
          resolve();
        }, this.pollIntervalMs);
        options.signal.addEventListener("abort", abort, { once: true });
      });
      row = await this.load(request.requestIdentity);
      if (!sameRequest(row.request, request)) {
        throw kataGoError("stale_response", "The durable KataGo job changed request identity.");
      }
    }
    throw kataGoError("request_aborted", "KataGo scoring was cancelled.");
  }
}

export class ModalKataGoScoringProvider extends KataGoScoringJobProvider {
  constructor(options: JobProviderOptions = {}) {
    super("hosted-http", options);
  }
}

export class LocalWorkerKataGoScoringProvider extends KataGoScoringJobProvider {
  constructor(options: Omit<JobProviderOptions, "dispatch"> = {}) {
    super("local-http", options);
  }
}

export function modalKataGoScoringProviderFromEnvironment(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): ModalKataGoScoringProvider {
  if (!isKataGoOnDemandConfigured(environment)) {
    throw kataGoError(
      "provider_not_configured",
      "Modal KataGo dispatch credentials are not configured.",
    );
  }
  return new ModalKataGoScoringProvider();
}
