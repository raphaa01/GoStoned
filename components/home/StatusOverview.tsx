"use client";

import { ChevronRight, Swords, Trophy, Users } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/components/i18n/I18nProvider";

type PublicActivityCount = number | "under_5";
type PlatformSummary = {
  unfinishedGames: PublicActivityCount;
  gamesStartedLast24Hours: PublicActivityCount;
  recentlyWaitingPlayers: PublicActivityCount;
  observedAt: string;
};
type SummaryState =
  | { kind: "loading" }
  | { kind: "ready"; summary: PlatformSummary }
  | { kind: "unavailable" };

export function StatusOverview() {
  const { dictionary, href, locale } = useI18n();
  const copy = dictionary.home;
  const [summaryState, setSummaryState] = useState<SummaryState>({ kind: "loading" });
  const [requestKey, setRequestKey] = useState(0);
  const [retrying, setRetrying] = useState(false);
  const statusRef = useRef<HTMLParagraphElement>(null);
  const focusStatusAfterSuccess = useRef(false);

  useEffect(() => {
    let active = true;
    fetch("/api/games").then(async (response) => {
      if (!response.ok) throw new Error("Game summary unavailable");
      return (await response.json()) as { summary: PlatformSummary };
    }).then((result) => {
      if (!active) return;
      setSummaryState({ kind: "ready", summary: result.summary });
      setRetrying(false);
    }).catch(() => {
      if (active) {
        setSummaryState({ kind: "unavailable" });
        setRetrying(false);
      }
    });
    return () => {
      active = false;
    };
  }, [requestKey]);

  useEffect(() => {
    if (summaryState.kind !== "ready" || !focusStatusAfterSuccess.current) return;
    focusStatusAfterSuccess.current = false;
    statusRef.current?.focus();
  }, [summaryState]);

  const summary = summaryState.kind === "ready" ? summaryState.summary : null;
  const activityStatus = summary
    ? copy.activityDefinition.replace(
      "{time}",
      new Intl.DateTimeFormat(locale, { timeStyle: "short" }).format(new Date(summary.observedAt)),
    )
    : summaryState.kind === "loading"
      ? copy.activityLoading
      : copy.activityUnavailable;
  const displayCount = (count: PublicActivityCount | undefined) => count === "under_5"
    ? copy.fewerThanFive
    : count ?? "–";
  const retryActivity = () => {
    if (retrying) return;
    focusStatusAfterSuccess.current = true;
    setRetrying(true);
    setSummaryState({ kind: "loading" });
    setRequestKey((value) => value + 1);
  };

  return (
    <section className="platform-status">
      <div className="platform-status-heading">
        <div>
          <span className="section-kicker">{copy.platformKicker}</span>
          <h2>{copy.platformTitle}</h2>
        </div>
        <Link href={href("/leaderboard")}>{copy.leaderboard} <ChevronRight size={17} /></Link>
      </div>

      <div className="platform-metrics">
        <article><Users size={20} /><span>{copy.recentlyWaitingPlayers}</span><strong>{displayCount(summary?.recentlyWaitingPlayers)}</strong></article>
        <article><Swords size={20} /><span>{copy.unfinishedGames}</span><strong>{displayCount(summary?.unfinishedGames)}</strong></article>
        <article><Trophy size={20} /><span>{copy.gamesStartedLast24Hours}</span><strong>{displayCount(summary?.gamesStartedLast24Hours)}</strong></article>
      </div>

      <div className="platform-activity-status">
        <p
          aria-atomic="true"
          aria-live="polite"
          className="platform-activity-note"
          ref={statusRef}
          role="status"
          tabIndex={-1}
        >
          {activityStatus}
        </p>
        {summaryState.kind === "unavailable" || retrying ? (
          <button
            className="button button--secondary"
            disabled={retrying}
            onClick={retryActivity}
            type="button"
          >
            {retrying ? copy.retryingActivity : copy.retryActivity}
          </button>
        ) : null}
      </div>
    </section>
  );
}
