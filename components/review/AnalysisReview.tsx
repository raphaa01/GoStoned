"use client";

import { ArrowLeft, ArrowRight, ChevronsLeft, ChevronsRight, LoaderCircle, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { useI18n } from "@/components/i18n/I18nProvider";
import { ApiRequestError, readApi } from "@/lib/client/api";
import { assertResponseActor } from "@/lib/client/identityAuthority";
import { localizedApiError } from "@/lib/i18n/dictionary";
import { getMobileAnalysisCopy } from "@/lib/i18n/mobileAnalysis";
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
  moveExplanation,
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
  const { dictionary, href, locale } = useI18n();
  const copy = dictionary.analysisReview;
  const progressiveCopy = getMobileAnalysisCopy(locale);
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
    if (!user) return;
    try {
      const response = await fetch("/api/analysis-price-vote", {
        cache: "no-store",
        headers: { [EXPECTED_PLAYER_HEADER]: user.playerKey },
      });
      const body = await readApi<PriceVoteResponse>(response);
      assertResponseActor(body.actor, user.playerKey);
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
  }, [dictionary, user]);

  const saveSupportPrice = useCallback(async (monthlyPriceEur: AnalysisPriceOption) => {
    if (!user || supportPriceSaving) return;
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
          [EXPECTED_PLAYER_HEADER]: user.playerKey,
        },
        body: JSON.stringify({ monthlyPriceEur }),
      });
      const body = await readApi<PriceVoteResponse>(response);
      assertResponseActor(body.actor, user.playerKey);
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
  }, [dictionary, supportPrice, supportPriceSaved, supportPriceSaving, user]);

  const load = useCallback(async (method: "GET" | "POST" = "GET") => {
    if (!user) return;
    if (method === "POST") {
      setRequesting(true);
      setError(null);
    }
    try {
      if (nativeAnalysis) {
        const response = await fetch(`/api/games/${gameId}`, {
          cache: "no-store",
          headers: { [EXPECTED_PLAYER_HEADER]: user.playerKey },
        });
        const body = await readApi<{ game: GameState }>(response);
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
          setAnalysis(await runNativeKataGoAnalysis(body.game, setAnalysis));
        } else {
          setAnalysis(await readNativeKataGoAnalysis(body.game));
        }
        setError(null);
        return;
      }
      const response = await fetch(`/api/games/${gameId}/analysis`, {
        method,
        cache: "no-store",
        headers: { [EXPECTED_PLAYER_HEADER]: user.playerKey },
      });
      const body = await readApi<ResponseBody>(response);
      setGame(body.game);
      setAnalysis(body.analysis);
      setError(null);
    } catch (requestError) {
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
      if (method === "POST") setRequesting(false);
    }
  }, [copy.failed, dictionary, gameId, loadSupportPrice, nativeAnalysis, user]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  useEffect(() => {
    if (nativeAnalysis) return;
    if (analysis?.status !== "queued" && analysis?.status !== "running") return;
    const timer = window.setInterval(() => void load(), 2_500);
    return () => window.clearInterval(timer);
  }, [analysis?.status, load, nativeAnalysis]);

  const result = analysis?.result ?? null;
  const progress = analysis?.progress;
  const current = result?.moves[selectedMove - 1] ?? null;
  const board = useMemo(() => game ? replayMoves(game.boardSize, game.moves.slice(0, selectedMove)) : null, [game, selectedMove]);
  const boardBefore = useMemo(
    () => game ? replayMoves(game.boardSize, game.moves.slice(0, Math.max(0, selectedMove - 1))) : null,
    [game, selectedMove],
  );
  const winrates = current ? fixedColorWinrates(current) : null;
  const scoreLead = current ? fixedColorScoreLead(current) : null;
  const quotaReset = quotaRetryAt
    ? new Intl.DateTimeFormat(locale, { dateStyle: "long" }).format(quotaRetryAt)
    : null;
  if (loading || !user) return <div className={styles.reviewStatus}><LoaderCircle className={styles.spin} />…</div>;
  if (error && !game) return <div className={styles.reviewStatus}><p role="alert">{error}</p><button className="button button--primary" onClick={() => void load()} type="button">{copy.retry}</button></div>;
  if (!game || !board) return <div className={styles.reviewStatus}><LoaderCircle className={styles.spin} />…</div>;

  return (
    <div className={`${styles.reviewWorkspace} review-workspace`}>
      <header className={styles.reviewHeader}>
        <Link href={href("/review")}><ArrowLeft size={17} /> {copy.back}</Link>
        <div><span>{game.blackPlayerName} · {game.whitePlayerName}</span><strong>{game.boardSize}×{game.boardSize} · {game.result}</strong></div>
        {result ? <span className={styles.engineBadge}>{result.engine.name} {result.engine.version}</span> : null}
      </header>

      {error ? (
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
      ) : current && result && boardBefore && winrates && scoreLead ? (
        <main className={styles.reviewMain}>
          {progress ? (
            <section aria-live="polite" className={styles.analysisProgress}>
              <div>
                <strong>{progress.phase === "preview" ? progressiveCopy.preview : progressiveCopy.quality}</strong>
                <span>{progress.phase === "preview" ? progressiveCopy.previewNote : progressiveCopy.qualityNote}</span>
              </div>
              <span>{progressiveCopy.progress
                .replace("{done}", String(progress.phase === "quality" ? progress.refinedMoves : progress.completedMoves))
                .replace("{total}", String(progress.totalMoves))}</span>
              <i aria-hidden="true"><b style={{ width: `${Math.min(100, ((progress.phase === "quality" ? progress.refinedMoves : progress.completedMoves) / Math.max(1, progress.totalMoves)) * 100)}%` }} /></i>
            </section>
          ) : null}
          <section className={`${styles.coachCard} ${current.classification ? styles[current.classification] : ""}`}>
            <div className={styles.coachCardHeading}>
              <span>{current.classification ? copy.classifications[current.classification] : progressiveCopy.preview}</span>
              <strong>{current.playedMove}</strong>
            </div>
            {nativeAnalysis && current.bestMove ? (
              <div className={styles.nativeRecommendation}>
                <span>{progressiveCopy.bestMove} <strong>{current.bestMove}</strong></span>
                {current.provisional ? <small>{progressiveCopy.provisional}</small> : null}
              </div>
            ) : null}
            <span className={styles.coachCardLabel}>{copy.explanation}</span>
            <p>{moveExplanation(current, boardBefore, game.boardSize, locale)}</p>
          </section>

          <section className={styles.boardPanel}>
            <AnalysisBoard board={board} bestMove={current.bestMove ?? undefined} label={copy.boardLabel.replaceAll("{size}", String(game.boardSize))} playedMove={current.playedMove} size={game.boardSize} />
            <div className={styles.moveControls}>
              <button aria-label={`${copy.previous} · 1`} disabled={selectedMove <= 1} onClick={() => setSelectedMove(1)} type="button"><ChevronsLeft /></button>
              <button aria-label={copy.previous} disabled={selectedMove <= 1} onClick={() => setSelectedMove((move) => Math.max(1, move - 1))} type="button"><ArrowLeft /></button>
              <span>{copy.move} <strong>{selectedMove}</strong> / {result.moves.length}</span>
              <button className={styles.nextMove} disabled={selectedMove >= result.moves.length} onClick={() => setSelectedMove((move) => Math.min(result.moves.length, move + 1))} type="button"><span>{copy.next}</span><ArrowRight /></button>
              <button aria-label={`${copy.next} · ${result.moves.length}`} disabled={selectedMove >= result.moves.length} onClick={() => setSelectedMove(result.moves.length)} type="button"><ChevronsRight /></button>
            </div>
            <input aria-label={copy.move} className={styles.moveSlider} max={result.moves.length} min="1" onChange={(event) => setSelectedMove(Number(event.target.value))} type="range" value={selectedMove} />
            <nav aria-label={copy.movesLabel} className={styles.moveStrip}>
              {result.moves.map((move) => (
                <button aria-current={move.moveNumber === selectedMove ? "step" : undefined} className={move.classification ? styles[move.classification] : undefined} key={move.moveNumber} onClick={() => setSelectedMove(move.moveNumber)} type="button"><small>{move.moveNumber}</small><strong>{move.playedMove}</strong><span>{move.classification ? copy.classifications[move.classification] : progressiveCopy.preview}</span></button>
              ))}
            </nav>
          </section>

          <aside className={styles.insightPanel}>
            <div className={`${styles.classification} ${current.classification ? styles[current.classification] : ""}`}><span>{current.classification ? copy.classifications[current.classification] : progressiveCopy.preview}</span><strong>{current.playedMove}</strong></div>
            <div className={styles.explanationBlock}>
              <span>{copy.explanation}</span>
              <p className={styles.explanation}>{moveExplanation(current, boardBefore, game.boardSize, locale)}</p>
            </div>
            <div className={styles.metrics}>
              <article className={styles.winrateMetric}>
                <span>{copy.winChance}</span>
                <div className={styles.winrateValues}>
                  <strong><i className={`${styles.metricStone} ${styles.blackMetricStone}`} />{dictionary.game.black} {formatWinrate(winrates.black)}</strong>
                  <strong><i className={`${styles.metricStone} ${styles.whiteMetricStone}`} />{dictionary.game.white} {formatWinrate(winrates.white)}</strong>
                </div>
                <div aria-hidden="true" className={styles.winrateBar}><span style={{ width: `${winrates.black * 100}%` }} /></div>
              </article>
              <article className={styles.scoreMetric}>
                <span>{copy.score}</span>
                <strong>{scoreLead.color === "black" ? dictionary.game.black : dictionary.game.white} +{scoreLead.points.toFixed(1)}</strong>
              </article>
            </div>
            <section className={styles.alternatives}>
              <h2>{copy.alternatives}</h2>
              {current.alternatives.length === 0 ? <p>{progressiveCopy.noAlternatives}</p> : null}
              {current.alternatives.map((alternative, index) => (
                <article key={`${current.moveNumber}:${alternative.move}`}>
                  <span>{index + 1}</span><strong>{alternative.move}</strong>
                  <div><b>{current.color === "black" ? dictionary.game.black : dictionary.game.white} {formatWinrate(alternative.winrate)}</b></div>
                </article>
              ))}
            </section>
          </aside>
        </main>
      ) : null}
    </div>
  );
}
