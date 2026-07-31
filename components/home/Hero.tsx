"use client";

import { ArrowRight } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/components/i18n/I18nProvider";
import { getPreviewPlayerCount } from "@/lib/stats/playerCountPreview";

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

export function Hero() {
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
  const waitingStatus = summaryState.kind === "loading"
    ? copy.heroActivityLoading
    : summaryState.kind === "unavailable"
      ? copy.heroActivityUnavailable
      : copy.heroActivityReady.replace(
        "{count}",
        String(getPreviewPlayerCount(summaryState.summary.recentlyWaitingPlayers)),
      );
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

  return (
    <div className="home-experience">
      <section className="home-hero" aria-labelledby="home-title">
        <span aria-hidden="true" className="hero-edge hero-edge--left">{copy.edgeLeft}</span>
        <span aria-hidden="true" className="hero-edge hero-edge--right">{copy.edgeRight}</span>

        <div className="home-hero-copy">
          <h1 id="home-title"><span lang="ja">{copy.heroJapanese}</span></h1>
          <p className="hero-worlds-line">{copy.heroWorlds}</p>
        </div>

        <div aria-hidden="true" className="hero-stone-stage">
          <span className="hero-ripple hero-ripple--one" />
          <span className="hero-ripple hero-ripple--two" />
          <Image
            alt=""
            className="hero-stone-image"
            height={1024}
            priority
            sizes="(max-width: 620px) 94vw, 920px"
            src="/images/gostone-hero-stone.webp"
            width={1536}
          />
        </div>

        <div className="hero-actions">
          <Link className="button button--primary button--lg hero-start" href={href("/play")}>
            {copy.startPlay} <ArrowRight aria-hidden="true" size={20} />
          </Link>
          <p aria-atomic="true" aria-live="polite" className="hero-live-status" role="status">
            <span aria-hidden="true" className="live-dot" /> {waitingStatus}
          </p>
        </div>
      </section>

      <div className="home-chapters">
        <section className="home-chapter home-chapter--play" aria-labelledby="home-play-title">
          <div className="chapter-visual chapter-visual--board" aria-hidden="true">
            <span className="chapter-stone chapter-stone--black" />
            <span className="chapter-stone chapter-stone--white" />
            <span className="chapter-ripple" />
          </div>
          <div className="chapter-copy">
            <span className="section-kicker">{copy.playChapterKicker}</span>
            <h2 id="home-play-title">{copy.playChapterTitle}</h2>
            <p>{copy.playChapterBody}</p>
            <Link className="chapter-link" href={href("/play")}>{copy.playChapterAction} <ArrowRight size={17} /></Link>
          </div>
        </section>

        <section className="home-chapter home-chapter--learn" aria-labelledby="home-learn-title">
          <div className="chapter-copy">
            <span className="section-kicker">{copy.learnChapterKicker}</span>
            <h2 id="home-learn-title">{copy.learnChapterTitle}</h2>
            <p>{copy.learnChapterBody}</p>
            <Link className="chapter-link" href={href("/learn")}>{copy.learnChapterAction} <ArrowRight size={17} /></Link>
          </div>
          <div className="chapter-visual chapter-visual--lesson" aria-hidden="true">
            <span className="lesson-stone lesson-stone--one" />
            <span className="lesson-stone lesson-stone--two" />
            <span className="lesson-stone lesson-stone--three" />
            <span className="lesson-liberty lesson-liberty--one" />
            <span className="lesson-liberty lesson-liberty--two" />
          </div>
        </section>

        <section className="home-chapter home-chapter--puzzles" aria-labelledby="home-puzzles-title">
          <div className="chapter-copy">
            <span className="section-kicker">{copy.puzzlesChapterKicker}</span>
            <h2 id="home-puzzles-title">{copy.puzzlesChapterTitle}</h2>
            <p>{copy.puzzlesChapterBody}</p>
            <Link className="chapter-link" href={href("/puzzles")}>{copy.puzzlesChapterAction} <ArrowRight size={17} /></Link>
          </div>
          <div className="chapter-visual chapter-visual--puzzles" aria-hidden="true">
            <span className="puzzle-stone puzzle-stone--black puzzle-stone--one" />
            <span className="puzzle-stone puzzle-stone--black puzzle-stone--two" />
            <span className="puzzle-stone puzzle-stone--black puzzle-stone--three" />
            <span className="puzzle-stone puzzle-stone--white puzzle-stone--four" />
            <span className="puzzle-stone puzzle-stone--white puzzle-stone--five" />
            <span className="puzzle-vital-point" />
            <span className="puzzle-sequence-line" />
            <span className="puzzle-sequence-label">1</span>
          </div>
        </section>

        <section className="home-chapter home-chapter--review" aria-labelledby="home-review-title">
          <div className="chapter-visual chapter-visual--review" aria-hidden="true">
            <span className="review-path review-path--played" />
            <span className="review-path review-path--alternative" />
            <span className="review-key-move" />
          </div>
          <div className="chapter-copy">
            <span className="section-kicker">{copy.reviewChapterKicker}</span>
            <h2 id="home-review-title">{copy.reviewChapterTitle}</h2>
            <p>{copy.reviewChapterBody}</p>
            <Link className="chapter-link" href={href("/review")}>{copy.reviewChapterAction} <ArrowRight size={17} /></Link>
          </div>
        </section>

        <section className="platform-status" aria-labelledby="home-progress-title">
          <div className="platform-status-heading">
            <div>
              <span className="section-kicker">{copy.progressChapterKicker}</span>
              <h2 id="home-progress-title">{copy.progressChapterTitle}</h2>
              <p>{copy.progressChapterBody}</p>
            </div>
            <Link href={href("/profile")}>{copy.progressChapterAction} <ArrowRight size={17} /></Link>
          </div>

          <div className="platform-metrics">
            <article><span>{copy.recentlyWaitingPlayers}</span><strong>{displayCount(summary?.recentlyWaitingPlayers)}</strong></article>
            <article><span>{copy.unfinishedGames}</span><strong>{displayCount(summary?.unfinishedGames)}</strong></article>
            <article><span>{copy.gamesStartedLast24Hours}</span><strong>{displayCount(summary?.gamesStartedLast24Hours)}</strong></article>
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
              <button className="button button--secondary" disabled={retrying} onClick={retryActivity} type="button">
                {retrying ? copy.retryingActivity : copy.retryActivity}
              </button>
            ) : null}
          </div>
        </section>
      </div>
    </div>
  );
}
