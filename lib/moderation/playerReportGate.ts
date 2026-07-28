export const PLAYER_REPORTING_ENABLED_ENV = "PLAYER_REPORTING_ENABLED";

export function isPlayerReportingEnabled(
  value = process.env[PLAYER_REPORTING_ENABLED_ENV],
): boolean {
  return value === "true";
}
