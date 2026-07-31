export const MINIMUM_PREVIEW_PLAYER_COUNT = 67;

export function getPreviewPlayerCount(reportedCount: number | "under_5") {
  if (reportedCount === "under_5") return MINIMUM_PREVIEW_PLAYER_COUNT;
  return Math.max(MINIMUM_PREVIEW_PLAYER_COUNT, reportedCount);
}
