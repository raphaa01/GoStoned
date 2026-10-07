export const TRAFFIC_PERIODS = [1, 7, 30] as const;
export type TrafficPeriod = typeof TRAFFIC_PERIODS[number];

export function parseTrafficPeriod(value: unknown): TrafficPeriod {
  return value === "1" ? 1 : value === "7" ? 7 : 30;
}

export function trafficWindow(now: Date, period: TrafficPeriod) {
  return {
    since: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - period + 1)).toISOString(),
    until: now.toISOString(),
  };
}
