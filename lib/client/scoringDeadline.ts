import type { GameClockState } from "@/lib/game/types";

export type ScoringDeadlineClock = Pick<GameClockState, "serverNow" | "clientReceivedAt">;

/**
 * Calculate a scoring deadline from the last server-time anchor. This avoids
 * trusting the browser's wall clock to agree with the game server.
 */
export function scoringDeadlineRemainingMs(
  expiresAt: string,
  clock: ScoringDeadlineClock,
  observedAt = Date.now(),
): number {
  const deadline = Date.parse(expiresAt);
  const serverAnchor = Date.parse(clock.serverNow);
  if (!Number.isFinite(deadline) || !Number.isFinite(serverAnchor)) return 0;
  const clientAnchor = Number.isFinite(clock.clientReceivedAt)
    ? clock.clientReceivedAt!
    : observedAt;
  const elapsed = Math.max(0, observedAt - clientAnchor);
  return Math.max(0, deadline - serverAnchor - elapsed);
}

export function formatScoringCountdown(remainingMs: number): string {
  if (!Number.isFinite(remainingMs) || remainingMs <= 0) return "0:00";
  const totalSeconds = Math.ceil(remainingMs / 1_000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
