"use client";

import { ArrowLeft, ArrowRight, ChevronsLeft, ChevronsRight, LoaderCircle, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { useI18n } from "@/components/i18n/I18nProvider";
import { ApiRequestError, readApi } from "@/lib/client/api";
import { assertResponseActor } from "@/lib/client/identityAuthority";
import { localizedApiError } from "@/lib/i18n/dictionary";
import { getMobileAnalysisCopy } from "@/lib/i18n/mobileAnalysis";
import { getReviewExperienceCopy } from "@/lib/i18n/reviewExperience";
import { reviewPlayerSummary, REVIEW_CLASSIFICATIONS } from "@/lib/analysis/reviewSummary";
import { EXPECTED_PLAYER_HEADER } from "@/lib/auth/playerBinding";
import type { AnalysisJobView } from "@/lib/analysis/types";
import {
  ANALYSIS_PRICE_OPTIONS,
  type AnalysisPriceOption,
} from "@/lib/analysis/priceVote";
import {
  fixedColorScoreLead,
  fixedColorWinrates,
  formatWinrate,
  meaningfulMoveComment,
} from "@/lib/analysis/presentation";
import { replayMoves } from "@/lib/game/goEngine";
import type { GameState } from "@/lib/game/types";
import {
  readNativeKataGoAnalysis,
  runNativeKataGoAnalysis,
  usesNativeKataGoAnalysis,
} from "@/lib/mobile/nativeKataGo";
import { AnalysisBoard } from "./AnalysisBoard";
import styles from "./review.module.css";

type ResponseBody = { actor: string; game: GameState; analysis: AnalysisJobView | null };
type PriceVoteResponse = { actor: string; monthlyPriceEur: AnalysisPriceOption | null };

export function AnalysisReview({ gameId }: { gameId: string }) {
  const { user, loading } = useAuth();
  const playerKey = user?.playerKey;
  const requestController = useRef<AbortController | null>(null);
  const { dictionary, href, locale } = useI18n();
  const copy = dictionary.analysisReview;
  const progressiveCopy = getMobileAnalysisCopy(locale);
  const experienceCopy = getReviewExperienceCopy(locale);
  const router = useRouter();
  const timelineRef = useRef<HTMLElement | null>(null);
  const [showSummary, setShowSummary] = useState(false);
  const [game, setGame] = useState<GameState | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisJobView | null>(null);
  const [selectedMove, setSelectedMove] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [requesting, setRequesting] = useState(false);
  const [quotaRetryAt, setQuotaRetryAt] = useState<Date | null>(null);
  const [supportPrice, setSupportPrice] = useState<AnalysisPriceOption | null>(null);
  const [supportPriceSaving, setSupportPriceSaving] = useState(false);
  const [supportPriceSaved, setSupportPriceSaved] = useState(false);
  const [supportPriceError, setSupportPriceError] = useState<string | null>(null);
  const nativeAnalysis = usesNativeKataGoAnalysis();

  const loadSupportPrice = useCallback(async () => {
    if (!playerKey) return;
    try {
      const response = await fetch("/api/analysis-price-vote", {
        cache: "no-store",
        headers: { [EXPECTED_PLAYER_HEADER]: playerKey },
      });
      const body = await readApi<PriceVoteResponse>(response);
      assertResponseActor(body.actor, playerKey);
      setSupportPrice(body.monthlyPriceEur);
      setSupportPriceSaved(body.monthlyPriceEur !== null);
      setSupportPriceError(null);
    } catch (requestError) {
      setSupportPriceError(localizedApiError(
        dictionary,
        requestError,
        dictionary.apiErrors.internal_error,
      ));
    }
  }, [dictionary, playerKey]);

  const saveSupportPrice = useCallback(async (monthlyPriceEur: AnalysisPriceOption) => {
    if (!playerKey || supportPriceSaving) return;
    const previousPrice = supportPrice;
    const previousSaved = supportPriceSaved;
    setSupportPrice(monthlyPriceEur);
    setSupportPriceSaving(true);
    setSupportPriceSaved(false);
    setSupportPriceError(null);
    try {
      const response = await fetch("/api/analysis-price-vote", {
        method: "POST",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          [EXPECTED_PLAYER_HEADER]: playerKey,
        },
        body: JSON.stringify({ monthlyPriceEur }),
      });
      const body = await readApi<PriceVoteResponse>(response);
      assertResponseActor(body.actor, playerKey);
      setSupportPrice(body.monthlyPriceEur);
      setSupportPriceSaved(true);
    } catch (requestError) {
      setSupportPrice(previousPrice);
      setSupportPriceSaved(previousSaved);
      setSupportPriceError(localizedApiError(
        dictionary,
        requestError,
        dictionary.apiErrors.internal_error,
      ));
    } finally {
      setSupportPriceSaving(false);
    }
  }, [dictionary, supportPrice, supportPriceSaved, supportPriceSaving, playerKey]);

  const load = useCallback(async (method: "GET" | "POST" = "GET") => {
    if (!playerKey) return;
    requestController.current?.abort();
    const controller = new AbortController();
    requestController.current = controller;
    const isCurrent = () => !controller.signal.aborted && requestController.current === controller;
    if (method === "POST") {
      setRequesting(true);
      setError(null);
    }
    try {
      if (nativeAnalysis) {
        const response = await fetch(`/api/games/${gameId}`, {
          cache: "no-store",
          headers: { [EXPECTED_PLAYER_HEADER]: playerKey },
          signal: controller.signal,
        });
        const body = await readApi<{ actor: string; game: GameState }>(response);
        assertResponseActor(body.actor, playerKey);
        if (!isCurrent()) return;
        setGame(body.game);
        if (method === "POST") {
          const pendingAt = new Date().toISOString();
          setAnalysis({
            id: `local:pending:${body.game.id}:${body.game.version}`,
            gameId: body.game.id,
            gameVersion: body.game.version,
            status: "running",
            attempts: 1,
            result: null,
            errorCode: null,
            createdAt: pendingAt,
            startedAt: pendingAt,
            completedAt: null,
          });
          const next = await runNativeKataGoAnalysis(body.game, value => {
            if (isCurrent()) setAnalysis(value);
          }, controller.signal);
          if (!isCurrent()) return;
          setAnalysis(next);
        } else {
          const next = await readNativeKataGoAnalysis(body.game);
          if (!isCurrent()) return;
          setAnalysis(next);
        }
        setError(null);
        return;
      }
      const response = await fetch(`/api/games/${gameId}/analysis`, {
        method,
        cache: "no-store",
        headers: { [EXPECTED_PLAYER_HEADER]: playerKey },
        signal: controller.signal,
      });
      const body = await readApi<ResponseBody>(response);
      assertResponseActor(body.actor, playerKey);
      if (!isCurrent()) return;
      setGame(body.game);
      setAnalysis(body.analysis);
      setError(null);
    } catch (requestError) {
      if (!isCurrent()) return;
      if (
        method === "POST"
        && requestError instanceof ApiRequestError
        && requestError.code === "analysis_weekly_limit"
      ) {
        const retryAfter = requestError.retryAfterSeconds ?? 7 * 24 * 60 * 60;
        setQuotaRetryAt(new Date(Date.now() + retryAfter * 1_000));
        setError(null);
        void loadSupportPrice();
        return;
      }
      setError(localizedApiError(dictionary, requestError, copy.failed));
    } finally {
      if (isCurrent()) setRequesting(false);
    }
  }, [copy.failed, dictionary, gameId, loadSupportPrice, nativeAnalysis, playerKey]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => {
      window.clearTimeout(timer);
      requestController.current?.abort();
    };
  }, [load]);
  useEffect(() => {
    if (nativeAnalysis) return;
    if (analysis?.status !== "queued" && analysis?.status !== "running") return;
    const timer = window.setInterval(() => void load(), 2_500);
    return () => window.clearInterval(timer);
  }, [analysis?.status, load, nativeAnalysis]);

  const result = analysis?.result ?? null;
  const availableMoves = result?.moves.length ?? 0;
  const progress = analysis?.progress;
  const current = result?.moves[selectedMove - 1] ?? null;
  const board = useMemo(() => game ? replayMoves(game.boardSize, game.moves.slice(0, selectedMove)) : null, [game, selectedMove]);
  const boardBefore = useMemo(
    () => game ? replayMoves(game.boardSize, game.moves.slice(0, Math.max(0, selectedMove - 1))) : null,
    [game, selectedMove],
  );
  const evaluation = current ?? (result?.moves[0] ? { color: result.moves[0].color,
    winrateAfter: result.moves[0].winrateBefore, scoreLeadAfter: result.moves[0].scoreLeadBefore } : null);
  const winrates = evaluation ? fixedColorWinrates(evaluation) : null;
  const scoreLead = evaluation ? fixedColorScoreLead(evaluation) : null;
  const comment = current && boardBefore ? meaningfulMoveComment(current, boardBefore, game?.boardSize ?? 19, locale) : null;
  const summaries = useMemo(() => result ? {
    black: reviewPlayerSummary(result.moves, "black"), white: reviewPlayerSummary(result.moves, "white"),
  } : null, [result]);
  const preliminary = Boolean(result && (analysis?.status !== "completed"
    || result.moves.length < (game?.moveCount ?? 0) || summaries?.black.preliminary || summaries?.white.preliminary));
  const exitReview = () => {
    if (window.history.length > 1) router.back();
    else router.replace(href("/review"));
  };
  useEffect(() => {
    const strip = timelineRef.current;
    const active = strip?.querySelector<HTMLElement>('[aria-current="step"]');
    if (strip && active) strip.scrollTo({ left: strip.scrollLeft + active.getBoundingClientRect().left
      - strip.getBoundingClientRect().left - (strip.clientWidth - active.clientWidth) / 2, behavior: "instant" });
  }, [selectedMove, result?.moves.length, showSummary]);
  useEffect(() => {
    if (!availableMoves || showSummary) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLElement && event.target.matches("input, textarea, select, [contenteditable]")) return;
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      setSelectedMove((move) => event.key === "Home" ? 0 : event.key === "End" ? availableMoves
        : Math.max(0, Math.min(availableMoves, move + (event.key === "ArrowLeft" ? -1 : 1))));
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [availableMoves, showSummary]);
  const quotaReset = quotaRetryAt
    ? new Intl.DateTimeFormat(locale, { dateStyle: "long" }).format(quotaRetryAt)
    : null;
  return (
    <div className={`${styles.reviewWorkspace} review-workspace`}>
      <header className={styles.reviewHeader}>
        <button aria-label={experienceCopy.back} onClick={exitReview} type="button"><ArrowLeft size={22} /></button>
        <h1>{showSummary ? experienceCopy.summary : experienceCopy.title}</h1>
        <span className={styles.reviewCounter}>{progress && analysis?.status === "running"
          ? <><LoaderCircle aria-hidden="true" className={styles.spin} size={13} /> {progressiveCopy.progress
            .replace("{done}", String(progress.completedMoves)).replace("{total}", String(progress.totalMoves))}</>
          : game ? `${game.boardSize}×${game.boardSize}` : ""}</span>
      </header>

      {loading || !user ? (
        <div className={styles.reviewStatus}><LoaderCircle className={styles.spin} />…</div>
      ) : error && !game ? (
        <div className={styles.reviewStatus}><p role="alert">{error}</p><button className="button button--primary" onClick={() => void load()} type="button">{copy.retry}</button></div>
      ) : !game || !board ? (
        <div className={styles.reviewStatus}><LoaderCircle className={styles.spin} />…</div>
      ) : error ? (
        <section className={styles.reviewStatus}>
          <p role="alert">{error}</p>
          <button
            className="button button--primary"
            disabled={requesting}
            onClick={() => void load(nativeAnalysis ? "POST" : analysis ? "GET" : "POST")}
            type="button"
          >
            {requesting ? <LoaderCircle className={styles.spin} size={17} /> : <RotateCcw size={17} />}
            {copy.retry}
          </button>
        </section>
      ) : quotaReset ? (
        <section className={styles.quotaPage}>
          <div className={styles.quotaIntro}>
            <span>{copy.limitKicker}</span>
            <h1>{copy.limitTitle}</h1>
            <p>{copy.limitBody}</p>
            <strong>{copy.limitReset.replaceAll("{date}", quotaReset)}</strong>
          </div>
          <fieldset className={styles.supportPoll}>
            <legend>{copy.supportTitle}</legend>
            <p>{copy.supportBody}</p>
            <span>{copy.supportQuestion}</span>
            <div>
              {ANALYSIS_PRICE_OPTIONS.map((price) => (
                <button
                  aria-pressed={supportPrice === price}
                  disabled={supportPriceSaving}
                  key={price}
                  onClick={() => void saveSupportPrice(price)}
                  type="button"
                >
                  {price} €
                </button>
              ))}
            </div>
            {supportPriceSaved ? <small>{copy.supportThanks}</small> : null}
            {supportPriceError ? <small role="alert">{supportPriceError}</small> : null}
          </fieldset>
          <Link className={styles.quotaBack} href={href("/review")}><ArrowLeft size={17} /> {copy.back}</Link>
        </section>
      ) : !analysis ? (
        <section className={styles.reviewStatus}>
          <h1>{copy.readyTitle}</h1>
          <p>{copy.readyDetails.replaceAll("{moves}", String(game.moveCount))}</p>
          <p className={styles.analysisNote}>{nativeAnalysis ? progressiveCopy.startNote : copy.startNote}</p>
          <button className="button button--primary button--lg" disabled={requesting} onClick={() => void load("POST")} type="button">
            {requesting ? <LoaderCircle className={styles.spin} size={18} /> : null}{copy.start}
          </button>
        </section>
      ) : (analysis.status === "queued" || analysis.status === "running") && !result ? (
        <section className={styles.reviewStatus}><LoaderCircle className={styles.spin} size={38} /><h1>{analysis.status === "queued" ? copy.queued : copy.running}</h1><p className={styles.analysisNote}>{copy.runningNote}</p></section>
      ) : analysis.status === "failed" ? (
        <section className={styles.reviewStatus}><h1>{copy.failed}</h1><p>{analysis.errorCode}</p><button className="button button--primary" onClick={() => void load("POST")} type="button"><RotateCcw size={17} /> {copy.retry}</button></section>
      ) : result && boardBefore && winrates && scoreLead ? (
        showSummary && summaries ? (
          <main className={styles.summaryPage} data-review-summary>
            <div className={styles.summaryPlayers}>
              {(["black", "white"] as const).map((color) => (
                <article key={color}>
                  <i aria-hidden="true" className={`${styles.playerStone} ${color === "black" ? styles.blackMetricStone : styles.whiteMetricStone}`} />
                  <strong>{color === "black" ? game.blackPlayerName : game.whitePlayerName}</strong>
                  <small>{color === "black" ? dictionary.game.black : dictionary.game.white}</small>
                  <span className={styles.winner}>{game.winnerKey === (color === "black" ? game.blackPlayerKey : game.whitePlayerKey)
                    ? experienceCopy.winner : game.winnerKey === null ? game.result : "\u00a0"}</span>
                  <b className={styles.accuracy} title={experienceCopy.accuracyHelp}>{summaries[color].accuracy?.toFixed(1) ?? "—"}</b>
                  <small title={experienceCopy.accuracyHelp}>{experienceCopy.accuracy}</small>
                </article>
              ))}
            </div>
            <section className={styles.summaryCounts} aria-label={experienceCopy.summary}>
              {REVIEW_CLASSIFICATIONS.map((classification) => (
                <div className={styles[classification]} key={classification}>
                  <strong>{summaries.black.counts[classification]}</strong>
                  <span>{copy.classifications[classification]}</span>
                  <strong>{summaries.white.counts[classification]}</strong>
                </div>
              ))}
            </section>
            <p className={styles.summaryNote}>{game.result}{preliminary ? ` · ${experienceCopy.partial
              .replace("{done}", String(result.moves.length)).replace("{total}", String(game.moveCount))}` : ""}</p>
            <div className={styles.summaryActions}>
              <button onClick={() => setShowSummary(false)} type="button">{experienceCopy.returnToAnalysis}</button>
              <button className={styles.nextMove} onClick={exitReview} type="button">{experienceCopy.done}</button>
            </div>
          </main>
        ) : (
          <main className={styles.reviewMain} data-review-player>
            <section className={styles.evaluation} aria-label={copy.winChance}>
              <div className={styles.evaluationLabels}>
                <span><i aria-hidden="true" className={`${styles.metricStone} ${styles.blackMetricStone}`} />{dictionary.game.black} <strong>{formatWinrate(winrates.black)}</strong></span>
                <strong>{scoreLead.points < 0.05 ? "±0" : `${scoreLead.color === "black" ? dictionary.game.black : dictionary.game.white} +${scoreLead.points.toFixed(1)}`}</strong>
                <span><i aria-hidden="true" className={`${styles.metricStone} ${styles.whiteMetricStone}`} />{dictionary.game.white} <strong>{formatWinrate(winrates.white)}</strong></span>
              </div>
              <div aria-hidden="true" className={styles.winrateBar}><span style={{ width: `${winrates.black * 100}%` }} /></div>
            </section>
            <section className={styles.moveAssessment} aria-live="polite">
              <div>
                <span className={current?.classification ? styles[current.classification] : undefined}>{current?.classification
                  ? copy.classifications[current.classification] : current ? progressiveCopy.preview : experienceCopy.initial}</span>
                <strong>{current ? `${current.moveNumber}. ${current.playedMove}` : ""}</strong>
                {current?.provisional ? <small>{experienceCopy.preliminary}</small> : null}
              </div>
              {comment ? <p>{comment}</p> : null}
            </section>
            <section className={styles.boardPanel}>
              <AnalysisBoard board={board} bestMove={current?.bestMove ?? undefined} label={copy.boardLabel.replaceAll("{size}", String(game.boardSize))} playedMove={current?.playedMove} size={game.boardSize} />
            </section>
            <nav aria-label={copy.movesLabel} className={styles.moveStrip} ref={timelineRef}>
              {result.moves.map((move) => (
                <button aria-current={move.moveNumber === selectedMove ? "step" : undefined} key={move.moveNumber} onClick={() => setSelectedMove(move.moveNumber)} type="button">
                  <small>{move.moveNumber}.</small><i aria-hidden="true" className={`${styles.metricStone} ${move.color === "black" ? styles.blackMetricStone : styles.whiteMetricStone}`} /><strong>{move.playedMove}</strong>
                </button>
              ))}
            </nav>
            <div className={styles.moveControls}>
              <button aria-label={experienceCopy.first} className={styles.jumpMove} disabled={selectedMove <= 0} onClick={() => setSelectedMove(0)} type="button"><ChevronsLeft size={19} /></button>
              <button aria-label={copy.previous} disabled={selectedMove <= 0} onClick={() => setSelectedMove((move) => Math.max(0, move - 1))} type="button"><ArrowLeft size={18} /><span>{experienceCopy.previous}</span></button>
              <button className={styles.nextMove} onClick={() => selectedMove >= result.moves.length ? setShowSummary(true) : setSelectedMove((move) => move + 1)} type="button">
                <span>{selectedMove >= result.moves.length ? experienceCopy.done : experienceCopy.next}</span><ArrowRight size={18} />
              </button>
              <button aria-label={experienceCopy.last} className={styles.jumpMove} disabled={selectedMove >= result.moves.length} onClick={() => setSelectedMove(result.moves.length)} type="button"><ChevronsRight size={19} /></button>
            </div>
          </main>
        )
      ) : null}
    </div>
  );
}
