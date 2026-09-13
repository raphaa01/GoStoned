import "server-only";

const VERCEL_ANALYTICS_API = "https://api.vercel.com/v1/query/web-analytics";
const ADMIN_PATH_FILTER = "requestPath ne '/webanalytics'";

type FetchLike = typeof fetch;

type VisitRow = {
  timestamp?: string;
  country?: string;
  requestPath?: string;
  referrerHostname?: string;
  deviceType?: string;
  browserName?: string;
  osName?: string;
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

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function reportWindow(now: Date): { since: string; until: string } {
  const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 29));
  const until = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  return { since: isoDate(since), until: isoDate(until) };
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
): Promise<VercelTrafficReport> {
  const { since, until } = reportWindow(now);
  const countParameters = new URLSearchParams({ filter: ADMIN_PATH_FILTER });
  const aggregateParameters = (by: string, limit = 20) => new URLSearchParams({
    since,
    until,
    by,
    limit: String(limit),
    filter: ADMIN_PATH_FILTER,
  });

  const [count, days, countries, pages, referrers, devices, browsers, operatingSystems] = await Promise.all([
    queryVercel<{ data?: { pageviews?: unknown; visitors?: unknown } }>("visits/count", countParameters, config, fetcher),
    queryVercel<AggregateResponse>("visits/aggregate", aggregateParameters("day", 31), config, fetcher),
    queryVercel<AggregateResponse>("visits/aggregate", aggregateParameters("country"), config, fetcher),
    queryVercel<AggregateResponse>("visits/aggregate", aggregateParameters("requestPath"), config, fetcher),
    queryVercel<AggregateResponse>("visits/aggregate", aggregateParameters("referrerHostname"), config, fetcher),
    queryVercel<AggregateResponse>("visits/aggregate", aggregateParameters("deviceType"), config, fetcher),
    queryVercel<AggregateResponse>("visits/aggregate", aggregateParameters("browserName"), config, fetcher),
    queryVercel<AggregateResponse>("visits/aggregate", aggregateParameters("osName"), config, fetcher),
  ]);

  return {
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
  };
}
