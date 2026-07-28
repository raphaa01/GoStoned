"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/components/i18n/I18nProvider";
import type { GameClockState, PlayerClockState, Stone } from "@/lib/game/types";

type PlayerClockProps = {
  clock: GameClockState;
  color: Stone;
  running: boolean;
};

function formatTime(milliseconds: number) {
  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1_000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function tickClock(
  player: PlayerClockState,
  periodTimeMs: number,
  elapsedMs: number,
): PlayerClockState {
  if (elapsedMs <= 0) return player;

  if (player.phase === "main" && elapsedMs < player.mainTimeMs) {
    const remaining = player.mainTimeMs - elapsedMs;
    return { ...player, mainTimeMs: remaining, displayTimeMs: remaining };
  }

  const overtimeElapsed =
    player.phase === "main" ? elapsedMs - player.mainTimeMs : elapsedMs;
  const overtimeAvailable =
    player.displayTimeMs + Math.max(0, player.periodsRemaining - 1) * periodTimeMs;
  const overtimeRemaining = Math.max(0, overtimeAvailable - overtimeElapsed);
  const periodsRemaining =
    overtimeRemaining === 0 ? 0 : Math.ceil(overtimeRemaining / periodTimeMs);
  const displayTimeMs =
    overtimeRemaining === 0
      ? 0
      : overtimeRemaining - (periodsRemaining - 1) * periodTimeMs;

  return {
    mainTimeMs: 0,
    periodsRemaining,
    displayTimeMs,
    phase: "byo-yomi",
  };
}

export function PlayerClock({ clock, color, running }: PlayerClockProps) {
  const { dictionary } = useI18n();
  const copy = dictionary.game;
  const [localNow, setLocalNow] = useState(() => Date.now());

  useEffect(() => {
    if (!running) return;
    const interval = window.setInterval(() => setLocalNow(Date.now()), 200);
    return () => window.clearInterval(interval);
  }, [running]);

  const player = clock[color];
  const elapsedMs = running
    ? Math.max(0, localNow - (clock.clientReceivedAt ?? localNow))
    : 0;
  const visible = tickClock(player, clock.byoYomiSeconds * 1_000, elapsedMs);

  return (
    <div
      aria-label={`${color === "black" ? copy.black : copy.white} ${copy.clockLabel} ${formatTime(visible.displayTimeMs)}`}
      className={`player-clock ${running ? "is-running" : ""} ${
        visible.phase === "byo-yomi" ? "is-byo-yomi" : ""
      }`}
    >
      <strong>{formatTime(visible.displayTimeMs)}</strong>
      <span>
        {visible.phase === "main"
          ? copy.mainTime
          : `Byo-yomi · ${visible.periodsRemaining} ${
              visible.periodsRemaining === 1 ? copy.period : copy.periods
            }`}
      </span>
    </div>
  );
}
