"use client";

import { ArrowLeft, ArrowRight, LoaderCircle, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { useI18n } from "@/components/i18n/I18nProvider";
import { ApiRequestError, readApi } from "@/lib/client/api";
import { EXPECTED_PLAYER_HEADER } from "@/lib/auth/playerBinding";
import type { AnalysisJobView } from "@/lib/analysis/types";
import {
  fixedColorScoreLead,
  fixedColorWinrates,
  formatWinrate,
  moveExplanation,
} from "@/lib/analysis/presentation";
import { replayMoves } from "@/lib/game/goEngine";
import type { GameState } from "@/lib/game/types";
import { AnalysisBoard } from "./AnalysisBoard";
import styles from "./review.module.css";

type ResponseBody = { actor: string; game: GameState; analysis: AnalysisJobView | null };

export function AnalysisReview({ gameId }: { gameId: string }) {
  const { user, loading } = useAuth();
  const { dictionary, href, locale } = useI18n();
  const copy = dictionary.analysisReview;
  const [game, setGame] = useState<GameState | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisJobView | null>(null);
  const [selectedMove, setSelectedMove] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [requesting, setRequesting] = useState(false);
  const [quotaRetryAt, setQuotaRetryAt] = useState<Date | null>(null);
  const [supportPrice, setSupportPrice] = useState<number | null>(null);

  const load = useCallback(async (method: "GET" | "POST" = "GET") => {
    if (!user) return;
    if (method === "POST") setRequesting(true);
    try {
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
        return;
      }
      setError(requestError instanceof Error ? requestError.message : copy.failed);
    } finally {
      if (method === "POST") setRequesting(false);
    }
  }, [copy.failed, gameId, user]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  useEffect(() => {
    if (analysis?.status !== "queued" && analysis?.status !== "running") return;
    const timer = window.setInterval(() => void load(), 2_500);
    return () => window.clearInterval(timer);
  }, [analysis?.status, load]);

  const result = analysis?.result ?? null;
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
    <div className={styles.reviewWorkspace}>
      <header className={styles.reviewHeader}>
        <Link href={href("/review")}><ArrowLeft size={17} /> {copy.back}</Link>
        <div><span>{game.blackPlayerName} · {game.whitePlayerName}</span><strong>{game.boardSize}×{game.boardSize} · {game.result}</strong></div>
        {result ? <span className={styles.engineBadge}>{result.engine.name} {result.engine.version}</span> : null}
      </header>

      {quotaReset ? (
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
              {[3, 5, 8, 12].map((price) => (
                <button
                  aria-pressed={supportPrice === price}
                  key={price}
                  onClick={() => setSupportPrice(price)}
                  type="button"
                >
                  {price} €
                </button>
              ))}
            </div>
            {supportPrice !== null ? <small>{copy.supportThanks}</small> : null}
          </fieldset>
          <Link className={styles.quotaBack} href={href("/review")}><ArrowLeft size={17} /> {copy.back}</Link>
        </section>
      ) : !analysis ? (
        <section className={styles.reviewStatus}>
          <h1>{copy.readyTitle}</h1>
          <p>{copy.readyDetails.replaceAll("{moves}", String(game.moveCount))}</p>
          <p className={styles.analysisNote}>{copy.startNote}</p>
          <button className="button button--primary button--lg" disabled={requesting} onClick={() => void load("POST")} type="button">
            {requesting ? <LoaderCircle className={styles.spin} size={18} /> : null}{copy.start}
          </button>
        </section>
      ) : analysis.status === "queued" || analysis.status === "running" ? (
        <section className={styles.reviewStatus}><LoaderCircle className={styles.spin} size={38} /><h1>{analysis.status === "queued" ? copy.queued : copy.running}</h1><p className={styles.analysisNote}>{copy.runningNote}</p></section>
      ) : analysis.status === "failed" ? (
        <section className={styles.reviewStatus}><h1>{copy.failed}</h1><p>{analysis.errorCode}</p><button className="button button--primary" onClick={() => void load("POST")} type="button"><RotateCcw size={17} /> {copy.retry}</button></section>
      ) : current && result && boardBefore && winrates && scoreLead ? (
        <>
          <main className={styles.reviewMain}>
            <section className={styles.boardPanel}>
              <AnalysisBoard board={board} bestMove={current.bestMove} label={copy.boardLabel.replaceAll("{size}", String(game.boardSize))} playedMove={current.playedMove} size={game.boardSize} />
              <div className={styles.moveControls}>
                <button aria-label={copy.previous} disabled={selectedMove <= 1} onClick={() => setSelectedMove((move) => Math.max(1, move - 1))} type="button"><ArrowLeft /></button>
                <span>{copy.move} <strong>{selectedMove}</strong> / {result.moves.length}</span>
                <button aria-label={copy.next} disabled={selectedMove >= result.moves.length} onClick={() => setSelectedMove((move) => Math.min(result.moves.length, move + 1))} type="button"><ArrowRight /></button>
              </div>
              <input aria-label={copy.move} className={styles.moveSlider} max={result.moves.length} min="1" onChange={(event) => setSelectedMove(Number(event.target.value))} type="range" value={selectedMove} />
            </section>

            <aside className={styles.insightPanel}>
              <div className={`${styles.classification} ${styles[current.classification]}`}><span>{copy.classifications[current.classification]}</span><strong>{current.playedMove}</strong></div>
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
                  <small>{copy.winChanceNote}</small>
                </article>
                <article className={styles.scoreMetric}>
                  <span>{copy.score}</span>
                  <strong>{scoreLead.color === "black" ? dictionary.game.black : dictionary.game.white} +{scoreLead.points.toFixed(1)}</strong>
                  <small>{copy.afterMove.replaceAll("{move}", String(selectedMove))}</small>
                </article>
              </div>
              <section className={styles.alternatives}>
                <h2>{copy.alternatives}</h2>
                {current.alternatives.map((alternative, index) => (
                  <article key={`${current.moveNumber}:${alternative.move}`}>
                    <span>{index + 1}</span><strong>{alternative.move}</strong>
                    <div><b>{current.color === "black" ? dictionary.game.black : dictionary.game.white} {formatWinrate(alternative.winrate)}</b><small>{alternative.scoreLead > 0 ? "+" : ""}{alternative.scoreLead.toFixed(1)} · {alternative.visits} {copy.visits}</small></div>
                  </article>
                ))}
              </section>
            </aside>
          </main>
          <nav aria-label={copy.movesLabel} className={styles.moveStrip}>
            {result.moves.map((move) => (
              <button aria-current={move.moveNumber === selectedMove ? "step" : undefined} className={styles[move.classification]} key={move.moveNumber} onClick={() => setSelectedMove(move.moveNumber)} type="button"><small>{move.moveNumber}</small><strong>{move.playedMove}</strong><span>{copy.classifications[move.classification]}</span></button>
            ))}
          </nav>
        </>
      ) : null}
    </div>
  );
}
