import type { PlayerClockState } from "@/lib/game/types";

export function advanceVisibleClock(
  player: PlayerClockState,
  periodTimeMs: number,
  elapsedMs: number,
): PlayerClockState {
  const safeMain = Math.max(0, Math.round(player.mainTimeMs));
  const safePeriods = Math.max(0, Math.round(player.periodsRemaining));
  const safePeriodTime = Math.max(1, Math.round(periodTimeMs));
  const safeElapsed = Math.max(0, Math.round(elapsedMs));
  if (safeElapsed === 0) return player;

  if (player.phase === "main" && safeElapsed < safeMain) {
    const remaining = safeMain - safeElapsed;
    return { ...player, mainTimeMs: remaining, displayTimeMs: remaining };
  }

  if (safePeriods === 0) {
    return { mainTimeMs: 0, periodsRemaining: 0, displayTimeMs: 0, phase: "byo-yomi" };
  }

  const overtimeElapsed = player.phase === "main" ? safeElapsed - safeMain : safeElapsed;
  const firstPeriodTime = player.phase === "main"
    ? safePeriodTime
    : Math.min(safePeriodTime, Math.max(0, Math.round(player.displayTimeMs)));
  if (overtimeElapsed < firstPeriodTime) {
    return {
      mainTimeMs: 0,
      periodsRemaining: safePeriods,
      displayTimeMs: firstPeriodTime - overtimeElapsed,
      phase: "byo-yomi",
    };
  }

  const elapsedAfterFirst = overtimeElapsed - firstPeriodTime;
  const periodsAfterFirst = safePeriods - 1;
  const additionalPeriodsLost = Math.floor(elapsedAfterFirst / safePeriodTime);
  const periodsRemaining = periodsAfterFirst - additionalPeriodsLost;
  if (periodsRemaining <= 0) {
    return { mainTimeMs: 0, periodsRemaining: 0, displayTimeMs: 0, phase: "byo-yomi" };
  }

  return {
    mainTimeMs: 0,
    periodsRemaining,
    displayTimeMs: safePeriodTime - (elapsedAfterFirst % safePeriodTime),
    phase: "byo-yomi",
  };
}
