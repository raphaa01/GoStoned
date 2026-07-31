"use client";

import { useEffect, useRef, useState } from "react";
import {
  formatScoringCountdown,
  scoringDeadlineRemainingMs,
  type ScoringDeadlineClock,
} from "@/lib/client/scoringDeadline";

type ScoringDecisionCountdownProps = {
  actionLabel: string;
  clock: ScoringDeadlineClock;
  deadlineKey: string;
  disabled: boolean;
  expiredLabel: string;
  expiresAt: string;
  label: string;
  onExpired: () => void;
};

export function ScoringDecisionCountdown({
  actionLabel,
  clock,
  deadlineKey,
  disabled,
  expiredLabel,
  expiresAt,
  label,
  onExpired,
}: ScoringDecisionCountdownProps) {
  const onExpiredRef = useRef(onExpired);
  const triggeredDeadline = useRef("");
  const [remainingMs, setRemainingMs] = useState(() =>
    scoringDeadlineRemainingMs(expiresAt, clock));

  useEffect(() => {
    onExpiredRef.current = onExpired;
  }, [onExpired]);

  useEffect(() => {
    const tick = () => {
      const remaining = scoringDeadlineRemainingMs(expiresAt, clock);
      setRemainingMs(remaining);
      if (
        remaining === 0
        && !disabled
        && triggeredDeadline.current !== deadlineKey
      ) {
        triggeredDeadline.current = deadlineKey;
        onExpiredRef.current();
      }
    };
    tick();
    const interval = window.setInterval(tick, 1_000);
    return () => window.clearInterval(interval);
  }, [clock, deadlineKey, disabled, expiresAt]);

  const expired = remainingMs === 0;
  const countdown = formatScoringCountdown(remainingMs);
  return (
    <div className={`scoring-countdown ${expired ? "is-expired" : ""}`}>
      <span>{label}</span>
      <time
        aria-label={`${label}: ${expired ? expiredLabel : countdown}`}
        dateTime={expiresAt}
      >
        {expired ? expiredLabel : countdown}
      </time>
      {expired ? (
        <>
          <span aria-atomic="true" aria-live="polite" className="sr-only" role="status">
            {expiredLabel}
          </span>
          <button disabled={disabled} onClick={onExpired} type="button">
            {actionLabel}
          </button>
        </>
      ) : null}
    </div>
  );
}
