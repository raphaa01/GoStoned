import "server-only";
import { trafficWindow, type TrafficPeriod } from "./trafficOptions";

const VERCEL_ANALYTICS_API = "https://api.vercel.com/v1/query/web-analytics";
const ADMIN_PATH_FILTER = "environment eq 'production' and not startswith(requestPath, '/webanalytics')";

type FetchLike = typeof fetch;

type VisitRow = {
  timestamp?: string;
  country?: string;
  requestPath?: string;
  referrerHostname?: string;
  deviceType?: string;
  browserName?: string;
  osName?: string;
  route?: string;
  pageviews: number;
  visitors: number;
};

type AggregateResponse = {
  data?: unknown;
};

export type TrafficBreakdown = {
  label: string;
  pageviews: number;
  visitors: number;
};

export type TrafficDay = TrafficBreakdown & {
  date: string;
};

export type VercelTrafficReport = {
  period: TrafficPeriod;
  totals: { pageviews: number; visitors: number };
  lifetime: { pageviews: number; visitors: number };
  since: string;
  until: string;
  days: TrafficDay[];
  countries: TrafficBreakdown[];
  pages: TrafficBreakdown[];
  referrers: TrafficBreakdown[];
  devices: TrafficBreakdown[];
  browsers: TrafficBreakdown[];
  operatingSystems: TrafficBreakdown[];
  routes: TrafficBreakdown[];
};

type VercelAnalyticsConfig = {
  token: string;
  projectId: string;
  teamId?: string;
};

function requiredConfig(): VercelAnalyticsConfig {
  const token = process.env.WEB_ANALYTICS_VERCEL_TOKEN?.trim();
  const projectId = (process.env.WEB_ANALYTICS_PROJECT_ID ?? process.env.VERCEL_PROJECT_ID)?.trim();
  const teamId = (process.env.WEB_ANALYTICS_TEAM_ID ?? process.env.VERCEL_ORG_ID)?.trim();
  if (!token || !projectId) throw new Error("Web Analytics API is not configured.");
  return { token, projectId, teamId: teamId || undefined };
}

function finiteCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

function visitRows(value: unknown): VisitRow[] {
  if (!Array.isArray(value)) return [];
  return value.map((row) => {
    const candidate = row && typeof row === "object" ? row as Record<string, unknown> : {};
    return {
      timestamp: typeof candidate.timestamp === "string" ? candidate.timestamp : undefined,
      country: typeof candidate.country === "string" ? candidate.country : undefined,
      requestPath: typeof candidate.requestPath === "string" ? candidate.requestPath : undefined,
      referrerHostname: typeof candidate.referrerHostname === "string" ? candidate.referrerHostname : undefined,
      deviceType: typeof candidate.deviceType === "string" ? candidate.deviceType : undefined,
      browserName: typeof candidate.browserName === "string" ? candidate.browserName : undefined,
      osName: typeof candidate.osName === "string" ? candidate.osName : undefined,
      route: typeof candidate.route === "string" ? candidate.route : undefined,
      pageviews: finiteCount(candidate.pageviews),
      visitors: finiteCount(candidate.visitors),
    };
  });
}

async function queryVercel<T>(
  pathname: string,
  parameters: URLSearchParams,
  config: VercelAnalyticsConfig,
  fetcher: FetchLike,
): Promise<T> {
  parameters.set("projectId", config.projectId);
  if (config.teamId) parameters.set("teamId", config.teamId);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetcher(`${VERCEL_ANALYTICS_API}/${pathname}?${parameters}`, {
      cache: "no-store",
      headers: { Authorization: `Bearer ${config.token}` },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Web Analytics API returned ${response.status}.`);
    return await response.json() as T;
  } finally {
    clearTimeout(timeout);
  }
}

function breakdown(rows: VisitRow[], key: keyof VisitRow, fallback: string): TrafficBreakdown[] {
  return rows.map((row) => ({
    label: typeof row[key] === "string" && row[key] ? String(row[key]) : fallback,
    pageviews: row.pageviews,
    visitors: row.visitors,
  }));
}

export async function getVercelTrafficReport(
  now = new Date(),
  fetcher: FetchLike = fetch,
  config: VercelAnalyticsConfig = requiredConfig(),
  period: TrafficPeriod = 30,
): Promise<VercelTrafficReport> {
  const { since, until } = trafficWindow(now, period);
  const countParameters = new URLSearchParams({ filter: ADMIN_PATH_FILTER });
  const aggregateParameters = (by: string, limit = 20) => new URLSearchParams({
    since,
    until,
    by,
    limit: String(limit),
    filter: ADMIN_PATH_FILTER,
  });

  const [count, totals, days, countries, pages, referrers, devices, browsers, operatingSystems, routes] = await Promise.all([
    queryVercel<{ data?: { pageviews?: unknown; visitors?: unknown } }>("visits/count", countParameters, config, fetcher),
    queryVercel<AggregateResponse>("visits/aggregate", aggregateParameters("environment"), config, fetcher),
    queryVercel<AggregateResponse>("visits/aggregate", aggregateParameters("day", 31), config, fetcher),
    queryVercel<AggregateResponse>("visits/aggregate", aggregateParameters("country"), config, fetcher),
    queryVercel<AggregateResponse>("visits/aggregate", aggregateParameters("requestPath"), config, fetcher),
    queryVercel<AggregateResponse>("visits/aggregate", aggregateParameters("referrerHostname"), config, fetcher),
    queryVercel<AggregateResponse>("visits/aggregate", aggregateParameters("deviceType"), config, fetcher),
    queryVercel<AggregateResponse>("visits/aggregate", aggregateParameters("browserName"), config, fetcher),
    queryVercel<AggregateResponse>("visits/aggregate", aggregateParameters("osName"), config, fetcher),
    queryVercel<AggregateResponse>("visits/aggregate", aggregateParameters("route"), config, fetcher),
  ]);

  return {
    period,
    totals: { pageviews: visitRows(totals.data)[0]?.pageviews ?? 0, visitors: visitRows(totals.data)[0]?.visitors ?? 0 },
    lifetime: {
      pageviews: finiteCount(count.data?.pageviews),
      visitors: finiteCount(count.data?.visitors),
    },
    since,
    until,
    days: visitRows(days.data).map((row) => ({
      date: row.timestamp ?? "",
      label: row.timestamp ?? "",
      pageviews: row.pageviews,
      visitors: row.visitors,
    })),
    countries: breakdown(visitRows(countries.data), "country", "Unbekannt"),
    pages: breakdown(visitRows(pages.data), "requestPath", "Unbekannte Seite"),
    referrers: breakdown(visitRows(referrers.data), "referrerHostname", "Direkt / unbekannt"),
    devices: breakdown(visitRows(devices.data), "deviceType", "Unbekannt"),
    browsers: breakdown(visitRows(browsers.data), "browserName", "Unbekannt"),
    operatingSystems: breakdown(visitRows(operatingSystems.data), "osName", "Unbekannt"),
    routes: breakdown(visitRows(routes.data), "route", "Unbekannt"),
  };
}
