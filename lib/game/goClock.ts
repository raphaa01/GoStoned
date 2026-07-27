export type ClockAdvance = {
  mainTimeMs: number;
  periodsRemaining: number;
  displayTimeMs: number;
  phase: "main" | "byo-yomi";
  timedOut: boolean;
};

type ClockInput = {
  mainTimeMs: number;
  periodsRemaining: number;
  periodTimeMs: number;
  elapsedMs: number;
};

export function advanceClock({
  mainTimeMs,
  periodsRemaining,
  periodTimeMs,
  elapsedMs,
}: ClockInput): ClockAdvance {
  const safeMain = Math.max(0, Math.round(mainTimeMs));
  const safePeriods = Math.max(0, Math.round(periodsRemaining));
  const safePeriodTime = Math.max(1, Math.round(periodTimeMs));
  const safeElapsed = Math.max(0, Math.round(elapsedMs));

  if (safeElapsed < safeMain) {
    const remaining = safeMain - safeElapsed;
    return {
      mainTimeMs: remaining,
      periodsRemaining: safePeriods,
      displayTimeMs: remaining,
      phase: "main",
      timedOut: false,
    };
  }

  const overtimeElapsed = safeElapsed - safeMain;
  const periodsLost = Math.floor(overtimeElapsed / safePeriodTime);
  const periodsRemainingAfterElapsed = safePeriods - periodsLost;

  if (periodsRemainingAfterElapsed <= 0) {
    return {
      mainTimeMs: 0,
      periodsRemaining: 0,
      displayTimeMs: 0,
      phase: "byo-yomi",
      timedOut: true,
    };
  }

  const elapsedInCurrentPeriod = overtimeElapsed % safePeriodTime;
  return {
    mainTimeMs: 0,
    periodsRemaining: periodsRemainingAfterElapsed,
    displayTimeMs: safePeriodTime - elapsedInCurrentPeriod,
    phase: "byo-yomi",
    timedOut: false,
  };
}

export function restingClock(
  mainTimeMs: number,
  periodsRemaining: number,
  periodTimeMs: number,
): ClockAdvance {
  const safeMain = Math.max(0, Math.round(mainTimeMs));
  const safePeriods = Math.max(0, Math.round(periodsRemaining));
  return {
    mainTimeMs: safeMain,
    periodsRemaining: safePeriods,
    displayTimeMs:
      safeMain > 0
        ? safeMain
        : safePeriods > 0
          ? Math.max(0, Math.round(periodTimeMs))
          : 0,
    phase: safeMain > 0 ? "main" : "byo-yomi",
    timedOut: safeMain === 0 && safePeriods === 0,
  };
}
