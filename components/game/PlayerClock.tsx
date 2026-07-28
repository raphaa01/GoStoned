"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/components/i18n/I18nProvider";
import { advanceVisibleClock } from "@/lib/client/playerClock";
import type { GameClockState, Stone } from "@/lib/game/types";

type PlayerClockProps = {
  clock: GameClockState;
  color: Stone;
  observedAt: number | null;
  running: boolean;
};

function formatTime(milliseconds: number) {
  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1_000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function PlayerClock({ clock, color, observedAt, running }: PlayerClockProps) {
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
  const visible = advanceVisibleClock(player, clock.byoYomiSeconds * 1_000, elapsedMs);
  const estimated = observedAt !== null;
  const awaitingServer = running
    && visible.displayTimeMs === 0
    && visible.periodsRemaining === 0;
  const authorityLabel = awaitingServer
    ? copy.awaitingServer
    : estimated
      ? copy.clockEstimated
      : "";

  return (
    <div
      aria-label={`${color === "black" ? copy.black : copy.white} ${copy.clockLabel} ${formatTime(visible.displayTimeMs)}${authorityLabel ? ` · ${authorityLabel}` : ""}`}
      className={`player-clock ${running ? "is-running" : ""} ${
        visible.phase === "byo-yomi" ? "is-byo-yomi" : ""
      } ${estimated ? "is-estimated" : ""}`}
    >
      <strong>{formatTime(visible.displayTimeMs)}</strong>
      <span>
        {awaitingServer
          ? copy.awaitingServer
          : `${estimated ? `${copy.clockEstimated} · ` : ""}${
              visible.phase === "main"
                ? copy.mainTime
                : `${copy.byoYomi} · ${visible.periodsRemaining} ${
                    visible.periodsRemaining === 1 ? copy.period : copy.periods
                  }`
            }`}
      </span>
    </div>
  );
}
