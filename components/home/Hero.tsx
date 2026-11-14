"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { useI18n } from "@/components/i18n/I18nProvider";
import { HomeAccountOverview } from "./HomeAccountOverview";
import { HomeShortcuts } from "./HomeShortcuts";
import { IosAppBanner } from "./IosAppBanner";

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

function PlatformActivity() {
  const { dictionary, locale } = useI18n();
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
      const result = (await response.json()) as { summary?: PlatformSummary };
      if (!result.summary) throw new Error("Game summary unavailable");
      return { summary: result.summary };
    }).then((result) => {
      if (!active) return;
      setSummaryState({ kind: "ready", summary: result.summary });
      setRetrying(false);
    }).catch(() => {
      if (!active) return;
      setSummaryState({ kind: "unavailable" });
      setRetrying(false);
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
  const displayCount = (count: PublicActivityCount | undefined) => count === "under_5"
    ? copy.fewerThanFive
    : count ?? "–";
  const activityStatus = summary
    ? copy.activityDefinition.replace(
      "{time}",
      new Intl.DateTimeFormat(locale, { timeStyle: "short" }).format(new Date(summary.observedAt)),
    )
    : summaryState.kind === "loading"
      ? copy.activityLoading
      : copy.activityUnavailable;
  const retryActivity = () => {
    if (retrying) return;
    focusStatusAfterSuccess.current = true;
    setRetrying(true);
    setSummaryState({ kind: "loading" });
    setRequestKey((value) => value + 1);
  };

  const counts = [
    [copy.recentlyWaitingPlayers, summary?.recentlyWaitingPlayers],
    [copy.unfinishedGames, summary?.unfinishedGames],
    [copy.gamesStartedLast24Hours, summary?.gamesStartedLast24Hours],
  ] as const;
  return (
    <section className="home-section">
      <dl className="home-stats">
        {counts.map(([label, count]) => (
          <div key={label}><dt>{label}</dt><dd>{displayCount(count)}</dd></div>
        ))}
      </dl>
      <div className="home-activity-note">
        <p
          aria-atomic="true"
          aria-live="polite"
          className={summaryState.kind === "unavailable" ? undefined : "sr-only"}
          ref={statusRef}
          role="status"
          tabIndex={-1}
        >
          {activityStatus}
        </p>
        {summaryState.kind === "unavailable" || retrying ? (
          <button className="button button--secondary" disabled={retrying} onClick={retryActivity} type="button">
            {retrying ? copy.retryingActivity : copy.retryActivity}
          </button>
        ) : null}
      </div>
    </section>
  );
}

export function Hero() {
  const { dictionary, href } = useI18n();
  const { user } = useAuth();

  return (
    <div className="web-home">
      <IosAppBanner />
      <section className="web-home__main" aria-labelledby="home-title">
        <h1 className="sr-only" id="home-title">GoStone</h1>
        <HomeShortcuts />
        <Link className="button button--primary web-home__play" href={href("/play")}>
          <span aria-hidden="true" /> {dictionary.home.startPlay}
        </Link>
      </section>
      {user
        ? <HomeAccountOverview key={user.playerKey} playerKey={user.playerKey} />
        : <PlatformActivity />}
    </div>
  );
}
