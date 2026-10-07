import "server-only";
import type { PoolClient } from "pg";
import { withReadOnlyTransaction } from "@/lib/db";
import { ANALYSIS_PRICE_OPTIONS } from "@/lib/analysis/priceVote";
import { trafficWindow, type TrafficPeriod } from "./trafficOptions";

type Count = number | string;
type Timestamp = Date | string;
type ReviewSummaryRow = {
  total_requests: Count; total_started: Count; requests: Count; started: Count;
  completed: Count; failed: Count; queued: Count; running: Count; requesters: Count;
};
type ReviewJobRow = {
  id: string; created_at: Timestamp; started_at: Timestamp | null;
  completed_at: Timestamp | null; status: string; attempts: number;
};

export type ReviewAnalyticsReport = {
  period: TrafficPeriod;
  summary: {
    totalRequests: number; totalStarted: number; requests: number; started: number;
    completed: number; failed: number; queued: number; running: number; requesters: number;
  };
  days: { date: string; requests: number; started: number; completed: number }[];
  recent: {
    id: string; requestedAt: string; startedAt: string | null;
    completedAt: string | null; status: string; attempts: number;
  }[];
};

export type PriceSurveyReport = {
  period: TrafficPeriod;
  voters: number;
  accounts: number;
  newVoters: number;
  updatedVotes: number;
  averagePrice: number | null;
  options: { euros: number; voters: number }[];
  recent: { euros: number; createdAt: string; updatedAt: string }[];
};

function count(value: Count): number { return Number(value); }
function iso(value: Timestamp): string { return new Date(value).toISOString(); }

async function readReviews(client: PoolClient, now: Date, period: TrafficPeriod): Promise<ReviewAnalyticsReport> {
  const { since, until } = trafficWindow(now, period);
  const values = [since, until];
  // Only durable server review jobs. Native analyses, bot turns and puzzle jobs
  // use separate storage. A cached result or worker retry is not another job.
  const summary = await client.query<ReviewSummaryRow>(`SELECT
    COUNT(*) AS total_requests,
    COUNT(*) FILTER (WHERE started_at IS NOT NULL) AS total_started,
    COUNT(*) FILTER (WHERE created_at BETWEEN $1::timestamptz AND $2::timestamptz) AS requests,
    COUNT(*) FILTER (WHERE started_at BETWEEN $1::timestamptz AND $2::timestamptz) AS started,
    COUNT(*) FILTER (WHERE status = 'completed' AND completed_at BETWEEN $1::timestamptz AND $2::timestamptz) AS completed,
    COUNT(*) FILTER (WHERE status = 'failed' AND created_at BETWEEN $1::timestamptz AND $2::timestamptz) AS failed,
    COUNT(*) FILTER (WHERE status = 'queued') AS queued,
    COUNT(*) FILTER (WHERE status = 'running') AS running,
    COUNT(DISTINCT requested_by_key) FILTER (WHERE created_at BETWEEN $1::timestamptz AND $2::timestamptz) AS requesters
    FROM game_analysis_jobs`, values);
  const days = await client.query<{ day: string; requests: Count; started: Count; completed: Count }>(`WITH days AS (
      SELECT generate_series(($1::timestamptz AT TIME ZONE 'UTC')::date,
        ($2::timestamptz AT TIME ZONE 'UTC')::date, INTERVAL '1 day')::date AS day
    ), events AS (
      SELECT (created_at AT TIME ZONE 'UTC')::date AS day, 'request' AS kind FROM game_analysis_jobs WHERE created_at BETWEEN $1::timestamptz AND $2::timestamptz
      UNION ALL
      SELECT (started_at AT TIME ZONE 'UTC')::date, 'start' FROM game_analysis_jobs WHERE started_at BETWEEN $1::timestamptz AND $2::timestamptz
      UNION ALL
      SELECT (completed_at AT TIME ZONE 'UTC')::date, 'complete' FROM game_analysis_jobs WHERE status = 'completed' AND completed_at BETWEEN $1::timestamptz AND $2::timestamptz
    ) SELECT TO_CHAR(days.day, 'YYYY-MM-DD') AS day,
      COUNT(*) FILTER (WHERE events.kind = 'request') AS requests,
      COUNT(*) FILTER (WHERE events.kind = 'start') AS started,
      COUNT(*) FILTER (WHERE events.kind = 'complete') AS completed
      FROM days LEFT JOIN events USING (day) GROUP BY days.day ORDER BY days.day`, values);
  const recent = await client.query<ReviewJobRow>(`SELECT id, created_at, started_at, completed_at, status, attempts
    FROM game_analysis_jobs WHERE created_at BETWEEN $1::timestamptz AND $2::timestamptz
    ORDER BY created_at DESC, id LIMIT 20`, values);
  const row = summary.rows[0];
  if (!row) throw new Error("Review analytics summary is unavailable.");
  return {
    period,
    summary: {
      totalRequests: count(row.total_requests), totalStarted: count(row.total_started),
      requests: count(row.requests), started: count(row.started), completed: count(row.completed),
      failed: count(row.failed), queued: count(row.queued), running: count(row.running), requesters: count(row.requesters),
    },
    days: days.rows.map((day) => ({ date: day.day, requests: count(day.requests), started: count(day.started), completed: count(day.completed) })),
    recent: recent.rows.map((job) => ({ id: job.id, requestedAt: iso(job.created_at), startedAt: job.started_at ? iso(job.started_at) : null,
      completedAt: job.completed_at ? iso(job.completed_at) : null, status: job.status, attempts: job.attempts })),
  };
}

async function readSurvey(client: PoolClient, now: Date, period: TrafficPeriod): Promise<PriceSurveyReport> {
  const { since, until } = trafficWindow(now, period);
  const summary = await client.query<{ voters: Count; accounts: Count; new_voters: Count; updated_votes: Count; average_price: string | null }>(`SELECT
    COUNT(*) AS voters, (SELECT COUNT(*) FROM users) AS accounts,
    COUNT(*) FILTER (WHERE created_at BETWEEN $1::timestamptz AND $2::timestamptz) AS new_voters,
    COUNT(*) FILTER (WHERE updated_at BETWEEN $1::timestamptz AND $2::timestamptz) AS updated_votes,
    AVG(monthly_price_eur)::text AS average_price FROM analysis_price_votes`, [since, until]);
  const options = await client.query<{ monthly_price_eur: number; voters: Count }>(`SELECT monthly_price_eur, COUNT(*) AS voters
    FROM analysis_price_votes GROUP BY monthly_price_eur ORDER BY monthly_price_eur`);
  const recent = await client.query<{ monthly_price_eur: number; created_at: Timestamp; updated_at: Timestamp }>(`SELECT monthly_price_eur, created_at, updated_at
    FROM analysis_price_votes WHERE updated_at BETWEEN $1::timestamptz AND $2::timestamptz
    ORDER BY updated_at DESC, user_id LIMIT 20`, [since, until]);
  const row = summary.rows[0];
  if (!row) throw new Error("Price survey summary is unavailable.");
  return {
    period, voters: count(row.voters), accounts: count(row.accounts), newVoters: count(row.new_voters), updatedVotes: count(row.updated_votes),
    averagePrice: row.average_price === null ? null : Number(row.average_price),
    options: ANALYSIS_PRICE_OPTIONS.map((euros) => ({ euros, voters: count(options.rows.find((option) => option.monthly_price_eur === euros)?.voters ?? 0) })),
    recent: recent.rows.map((vote) => ({ euros: vote.monthly_price_eur, createdAt: iso(vote.created_at), updatedAt: iso(vote.updated_at) })),
  };
}

export function getReviewAnalyticsReport(now: Date, period: TrafficPeriod): Promise<ReviewAnalyticsReport> {
  return withReadOnlyTransaction((client) => readReviews(client, now, period));
}

export function getPriceSurveyReport(now: Date, period: TrafficPeriod): Promise<PriceSurveyReport> {
  return withReadOnlyTransaction((client) => readSurvey(client, now, period));
}
