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
            </Link>
            <div className="chapter-copy">
              <p className="chapter-kicker"><Gamepad2 aria-hidden="true" size={21} />{copy.playChapterKicker}</p>
              <h2 id="home-play-title">{copy.playChapterTitle.replace(/[.!?。！？]+$/, "")}</h2>
              <p>{copy.playChapterBody}</p>
              <dl className="chapter-facts" aria-label={copy.playChapterTitle}>
                <div><dt>{dictionary.play.boardSize}</dt><dd>19×19</dd></div>
                <div><dt>{dictionary.play.timeControl}</dt><dd>{dictionary.timeControls.rapid.name}</dd></div>
                <div><dt>{dictionary.game.move}</dt><dd>124</dd></div>
                <div><dt>{dictionary.game.yourTurn}</dt><dd>06:42</dd></div>
              </dl>
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
              </Link>
              <div className="chapter-copy">
                <p className="chapter-kicker"><BookOpen aria-hidden="true" size={21} />{copy.learnChapterKicker}</p>
                <h2 id="home-learn-title">{copy.learnChapterTitle.replace(/[.!?。！？]+$/, "")}</h2>
                <p>{copy.learnChapterBody}</p>
                <div className="chapter-progress" aria-label={copy.learnChapterTitle}>
                  <span><i style={{ width: "34%" }} /></span><strong>6 / 18</strong>
                </div>
              </div>
            </div>
          </section>

          <section aria-labelledby="home-puzzles-title" className="home-chapter home-chapter--puzzles" id="home-puzzles">
            <div className="home-chapter-inner">
              <Link aria-label={copy.puzzlesChapterAction} className="board-feature-link" href={href("/puzzles")}>
                <GoBoardScene label={copy.puzzlesChapterTitle} scene="puzzles" />
              </Link>
              <div className="chapter-copy">
                <p className="chapter-kicker"><Puzzle aria-hidden="true" size={21} />{copy.puzzlesChapterKicker}</p>
                <h2 id="home-puzzles-title">{copy.puzzlesChapterTitle.replace(/[.!?。！？]+$/, "")}</h2>
                <p>{copy.puzzlesChapterBody}</p>
                <dl className="chapter-facts chapter-facts--compact" aria-label={copy.puzzlesChapterTitle}>
                  <div><dt>{dictionary.puzzles.daily}</dt><dd>184</dd></div>
                  <div><dt>{dictionary.puzzles.lifeAndDeath}</dt><dd>{dictionary.puzzles.intermediate}</dd></div>
                </dl>
              </div>
            </div>
          </section>
        </div>

        <section aria-labelledby="home-review-title" className="home-chapter home-chapter--review" id="home-review">
          <div className="home-chapter-inner">
            <div className="chapter-copy">
              <p className="chapter-kicker"><Search aria-hidden="true" size={21} />{copy.reviewChapterKicker}</p>
              <h2 id="home-review-title">{copy.reviewChapterTitle.replace(/[.!?。！？]+$/, "")}</h2>
              <p>{copy.reviewChapterBody}</p>
              <dl className="chapter-facts chapter-facts--inverse" aria-label={copy.reviewChapterTitle}>
                <div><dt>{dictionary.analysisReview.move}</dt><dd>124</dd></div>
                <div><dt>{dictionary.analysisReview.winChance}</dt><dd>63%</dd></div>
                <div><dt>{dictionary.analysisReview.score}</dt><dd>+2.7</dd></div>
              </dl>
            </div>
            <Link aria-label={copy.reviewChapterAction} className="board-feature-link" href={reviewHref}>
              <GoBoardScene label={copy.reviewChapterTitle} scene="review" />
            </Link>
          </div>
        </section>

        <section className="platform-status" id="home-progress" aria-labelledby="home-progress-title">
          <div className="platform-status-heading">
            <div>
              <p className="chapter-kicker"><Trophy aria-hidden="true" size={21} />{copy.progressChapterKicker}</p>
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

          <div className="progress-preview" aria-hidden="true">
            <div>
              <span>{dictionary.profile.globalRating}</span>
              <strong>1,842</strong>
              <small>+36</small>
            </div>
            <svg viewBox="0 0 720 120" preserveAspectRatio="none">
              <path className="progress-preview__area" d="M0 102C72 96 114 88 168 91S258 67 314 72 401 51 466 57 555 29 612 38 678 20 720 12V120H0Z" />
              <path className="progress-preview__line" d="M0 102C72 96 114 88 168 91S258 67 314 72 401 51 466 57 555 29 612 38 678 20 720 12" />
            </svg>
            <ol className="progress-preview__form">
              {["W", "W", "L", "W", "W"].map((result, index) => <li className={result === "W" ? "is-win" : "is-loss"} key={`${result}-${index}`}>{result}</li>)}
            </ol>
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
