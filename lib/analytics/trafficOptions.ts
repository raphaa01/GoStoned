export const TRAFFIC_PERIODS = [1, 7, 30] as const;
export type TrafficPeriod = typeof TRAFFIC_PERIODS[number];
export const ENGAGEMENT_PERIODS = [1, 7, 30, "all"] as const;
export type EngagementPeriod = typeof ENGAGEMENT_PERIODS[number];

export function parseEngagementPeriod(value: unknown, fallback: TrafficPeriod = 30): EngagementPeriod {
  return value === "all" ? "all" : value === "1" ? 1 : value === "7" ? 7 : value === "30" ? 30 : fallback;
}

export function parseTrafficPeriod(value: unknown): TrafficPeriod {
  return value === "1" ? 1 : value === "7" ? 7 : 30;
}

export function trafficWindow(now: Date, period: TrafficPeriod) {
  return {
    since: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - period + 1)).toISOString(),
    until: now.toISOString(),
  };
}
