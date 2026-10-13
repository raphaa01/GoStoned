import { advanceClock, restingClock, type ClockAdvance } from "./goClock";
import { getTimeControl } from "./timeControls";
import type { Stone, TimeControlId } from "./types";

export type LocalClock = {
  control: TimeControlId;
  black: { mainTimeMs: number; periodsRemaining: number };
  white: { mainTimeMs: number; periodsRemaining: number };
  turn: Stone;
  running: boolean;
  started: boolean;
  startedAt: number;
  elapsedMs: number;
  winner: Stone | null;
};

export function createLocalClock(control: TimeControlId, now: number, running = false): LocalClock {
  const preset = getTimeControl(control);
  const player = { mainTimeMs: preset.mainTimeSeconds * 1000, periodsRemaining: preset.byoYomiPeriods };
  return { control, black: { ...player }, white: { ...player }, turn: "black", running,
    started: running, startedAt: now, elapsedMs: 0, winner: null };
}

export function localClockReading(clock: LocalClock, color: Stone, now: number): ClockAdvance {
  const periodTimeMs = getTimeControl(clock.control).byoYomiSeconds * 1000;
  if (color !== clock.turn || !clock.started) {
    return restingClock(clock[color].mainTimeMs, clock[color].periodsRemaining, periodTimeMs);
  }
  return advanceClock({ ...clock[color], periodTimeMs,
    elapsedMs: clock.elapsedMs + (clock.running ? Math.max(0, now - clock.startedAt) : 0) });
}

export function expireLocalClock(clock: LocalClock, now: number): LocalClock {
  if (!clock.running || clock.winner || !localClockReading(clock, clock.turn, now).timedOut) return clock;
  return { ...clock, running: false, elapsedMs: clock.elapsedMs + Math.max(0, now - clock.startedAt),
    winner: clock.turn === "black" ? "white" : "black" };
}

export function switchLocalClock(clock: LocalClock, now: number): LocalClock {
  const checked = expireLocalClock(clock, now);
  if (checked.winner || (checked.started && !checked.running)) return checked;
  if (!checked.started) return { ...checked, started: true, running: true, startedAt: now };
  const reading = localClockReading(checked, checked.turn, now);
  return { ...checked, [checked.turn]: { mainTimeMs: reading.mainTimeMs, periodsRemaining: reading.periodsRemaining },
    turn: checked.turn === "black" ? "white" : "black", startedAt: now, elapsedMs: 0 };
}

export function pauseLocalClock(clock: LocalClock, now: number): LocalClock {
  const checked = expireLocalClock(clock, now);
  if (!checked.running) return checked;
  return { ...checked, running: false, elapsedMs: checked.elapsedMs + Math.max(0, now - checked.startedAt) };
}

export function resumeLocalClock(clock: LocalClock, now: number): LocalClock {
  if (clock.running || clock.winner) return clock;
  return { ...clock, started: true, running: true, startedAt: now };
}

export function formatLocalClock(milliseconds: number): string {
  const seconds = Math.ceil(Math.max(0, milliseconds) / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
