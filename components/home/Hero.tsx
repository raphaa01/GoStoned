"use client";

import { BookOpen, Gamepad2, Play, Puzzle, Search, Trophy } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useAccountFeatureHref } from "@/components/auth/useAccountFeatureHref";
import { GoBoardScene } from "@/components/home/GoBoardScene";
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

export function Hero() {
  const { dictionary, href, locale } = useI18n();
  const learnHref = useAccountFeatureHref("/learn");
  const profileHref = useAccountFeatureHref("/profile");
  const reviewHref = useAccountFeatureHref("/review");
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
          <p className="hero-worlds-line">{copy.heroWorlds.replace(/[.!?。！？]+$/, "")}</p>
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
            {copy.startPlay} <Play aria-hidden="true" fill="currentColor" size={18} />
          </Link>
        </div>
      </section>

      <div className="home-chapters">
        <section aria-labelledby="home-play-title" className="home-chapter home-chapter--play" id="home-play">
          <div className="home-chapter-inner">
            <Link aria-label={copy.playChapterAction} className="board-feature-link" href={href("/play")}>
              <GoBoardScene label={copy.playChapterTitle} scene="play" />
              <span aria-hidden="true" className="board-action-glyph"><Play fill="currentColor" size={18} /></span>
            </Link>
            <div className="chapter-copy">
              <p className="chapter-kicker"><Gamepad2 aria-hidden="true" size={17} />{copy.playChapterKicker}</p>
              <h2 id="home-play-title">{copy.playChapterTitle.replace(/[.!?。！？]+$/, "")}</h2>
              <p>{copy.playChapterBody}</p>
              <nav aria-label={copy.playChapterAction} className="board-size-choices">
                {([9, 13, 19] as const).map((size) => (
                  <Link aria-label={`${copy.playChapterAction}: ${size}×${size}`} href={`${href("/play")}?size=${size}`} key={size}>
                    <span aria-hidden="true" className="board-size-glyph" />
                    <strong>{size}×{size}</strong>
                  </Link>
                ))}
              </nav>
            </div>
          </div>
        </section>

        <div className="home-feature-pair">
          <section aria-labelledby="home-learn-title" className="home-chapter home-chapter--learn" id="home-learn">
            <div className="home-chapter-inner">
              <Link aria-label={copy.learnChapterAction} className="board-feature-link" href={learnHref}>
                <GoBoardScene label={copy.learnChapterTitle} scene="learn" />
                <span aria-hidden="true" className="board-action-glyph"><BookOpen size={18} /></span>
              </Link>
              <div className="chapter-copy">
                <p className="chapter-kicker"><BookOpen aria-hidden="true" size={17} />{copy.learnChapterKicker}</p>
                <h2 id="home-learn-title">{copy.learnChapterTitle.replace(/[.!?。！？]+$/, "")}</h2>
                <p>{copy.learnChapterBody}</p>
              </div>
            </div>
          </section>

          <section aria-labelledby="home-puzzles-title" className="home-chapter home-chapter--puzzles" id="home-puzzles">
            <div className="home-chapter-inner">
              <Link aria-label={copy.puzzlesChapterAction} className="board-feature-link" href={href("/puzzles")}>
                <GoBoardScene label={copy.puzzlesChapterTitle} scene="puzzles" />
                <span aria-hidden="true" className="board-action-glyph"><Puzzle size={18} /></span>
              </Link>
              <div className="chapter-copy">
                <p className="chapter-kicker"><Puzzle aria-hidden="true" size={17} />{copy.puzzlesChapterKicker}</p>
                <h2 id="home-puzzles-title">{copy.puzzlesChapterTitle.replace(/[.!?。！？]+$/, "")}</h2>
                <p>{copy.puzzlesChapterBody}</p>
              </div>
            </div>
          </section>
        </div>

        <section aria-labelledby="home-review-title" className="home-chapter home-chapter--review" id="home-review">
          <div className="home-chapter-inner">
            <div className="chapter-copy">
              <p className="chapter-kicker"><Search aria-hidden="true" size={17} />{copy.reviewChapterKicker}</p>
              <h2 id="home-review-title">{copy.reviewChapterTitle.replace(/[.!?。！？]+$/, "")}</h2>
              <p>{copy.reviewChapterBody}</p>
            </div>
            <Link aria-label={copy.reviewChapterAction} className="board-feature-link" href={reviewHref}>
              <GoBoardScene label={copy.reviewChapterTitle} scene="review" />
              <span aria-hidden="true" className="board-action-glyph"><Search size={18} /></span>
            </Link>
          </div>
        </section>

        <section className="platform-status" id="home-progress" aria-labelledby="home-progress-title">
          <div className="platform-status-heading">
            <div>
              <p className="chapter-kicker"><Trophy aria-hidden="true" size={17} />{copy.progressChapterKicker}</p>
              <h2 id="home-progress-title">{copy.progressChapterTitle.replace(/[.!?。！？]+$/, "")}</h2>
              <p>{copy.progressChapterBody}</p>
            </div>
            <Link className="chapter-symbol-link" href={profileHref}><Trophy aria-hidden="true" size={19} /><span>{copy.progressChapterAction}</span></Link>
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
              className={`platform-activity-note${summary ? "" : " sr-only"}`}
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
