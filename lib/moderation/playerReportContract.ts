export const PLAYER_REPORT_CATEGORIES = [
  "abuse_or_hate",
  "threat_or_sexual_safety",
  "fair_play",
  "stalling_or_abandonment",
  "spam_scam_or_identity",
  "other",
] as const;

export type PlayerReportCategory = (typeof PLAYER_REPORT_CATEGORIES)[number];

export function isPlayerReportCategory(value: unknown): value is PlayerReportCategory {
  return typeof value === "string"
    && PLAYER_REPORT_CATEGORIES.includes(value as PlayerReportCategory);
}
