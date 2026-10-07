import { query } from "@/lib/db";
import { analyticsPath } from "./paths";
import { trafficWindow, type EngagementPeriod } from "./trafficOptions";

export type EngagementSample = { path: string; milliseconds: number; started: boolean };
export type EngagementRow = { path: string; views: number; milliseconds: number };
export type EngagementReport = { views: number; milliseconds: number; pages: EngagementRow[] };

export function parseEngagementSample(body: Record<string, unknown>): EngagementSample | null {
  if (Object.keys(body).length !== 3 || typeof body.path !== "string"
    || typeof body.started !== "boolean" || typeof body.milliseconds !== "number"
    || !Number.isInteger(body.milliseconds) || body.milliseconds < 0 || body.milliseconds > 60_000) return null;
  const path = analyticsPath(body.path);
  return path ? { path, milliseconds: body.milliseconds, started: body.started } : null;
}

export async function recordEngagement(sample: EngagementSample) {
  await query(`INSERT INTO web_analytics_engagement (hour, path, views, visible_ms)
    VALUES (date_trunc('hour', statement_timestamp()), $1, $2, $3)
    ON CONFLICT (hour, path) DO UPDATE
    SET views = web_analytics_engagement.views + EXCLUDED.views,
        visible_ms = web_analytics_engagement.visible_ms + EXCLUDED.visible_ms`,
  [sample.path, sample.started ? 1 : 0, sample.milliseconds]);
}

export async function getEngagementReport(now: Date, period: EngagementPeriod): Promise<EngagementReport> {
  const since = period === "all" ? null : trafficWindow(now, period).since;
  const until = now.toISOString();
  const result = await query<{ path: string; views: string; milliseconds: string }>(
    `SELECT path, SUM(views)::text AS views, SUM(visible_ms)::text AS milliseconds
     FROM web_analytics_engagement WHERE ($1::timestamptz IS NULL OR hour >= $1::timestamptz) AND hour <= $2::timestamptz
     GROUP BY path ORDER BY SUM(visible_ms) DESC, path`, [since, until]);
  const pages = result.rows.map((row) => ({ path: row.path, views: Number(row.views), milliseconds: Number(row.milliseconds) }));
  return { pages, views: pages.reduce((sum, row) => sum + row.views, 0), milliseconds: pages.reduce((sum, row) => sum + row.milliseconds, 0) };
}
