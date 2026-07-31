"use client";

import { ArrowLeft, ArrowRight, BrainCircuit, LoaderCircle, RotateCcw, Sparkles } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { useI18n } from "@/components/i18n/I18nProvider";
import { readApi } from "@/lib/client/api";
import { EXPECTED_PLAYER_HEADER } from "@/lib/auth/playerBinding";
import type { AnalysisJobView } from "@/lib/analysis/types";
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

  const load = useCallback(async (method: "GET" | "POST" = "GET") => {
    if (!user) return;
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
      setError(requestError instanceof Error ? requestError.message : copy.failed);
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
  if (loading) return <div className={styles.reviewStatus}><LoaderCircle className={styles.spin} />…</div>;
  if (!user) return <div className={styles.reviewStatus}><p>{copy.savedGameSignIn}</p><Link className="button button--primary" href={href("/login")}>{copy.login}</Link></div>;
  if (error && !game) return <div className={styles.reviewStatus}><p role="alert">{error}</p><button className="button button--primary" onClick={() => void load()} type="button">{copy.retry}</button></div>;
  if (!game || !board) return <div className={styles.reviewStatus}><LoaderCircle className={styles.spin} />…</div>;

  return (
    <div className={styles.reviewWorkspace}>
      <header className={styles.reviewHeader}>
        <Link href={href("/review")}><ArrowLeft size={17} /> {copy.back}</Link>
        <div><span>{game.blackPlayerName} · {game.whitePlayerName}</span><strong>{game.boardSize}×{game.boardSize} · {game.result}</strong></div>
        {result ? <span className={styles.engineBadge}><BrainCircuit size={16} /> {result.engine.name} {result.engine.version}</span> : null}
      </header>

      {!analysis ? (
        <section className={styles.reviewStatus}>
          <BrainCircuit size={42} /><h1>{copy.reviewTitle}</h1><p>{game.moveCount} {copy.move.toLowerCase()}</p>
          <button className="button button--primary button--lg" onClick={() => void load("POST")} type="button"><Sparkles size={18} /> {copy.start}</button>
        </section>
      ) : analysis.status === "queued" || analysis.status === "running" ? (
        <section className={styles.reviewStatus}><LoaderCircle className={styles.spin} size={38} /><h1>{analysis.status === "queued" ? copy.queued : copy.running}</h1><p>{copy.job} {analysis.id.slice(0, 8)}</p></section>
      ) : analysis.status === "failed" ? (
        <section className={styles.reviewStatus}><h1>{copy.failed}</h1><p>{analysis.errorCode}</p><button className="button button--primary" onClick={() => void load("POST")} type="button"><RotateCcw size={17} /> {copy.retry}</button></section>
      ) : current && result ? (
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
              <div className={`${styles.classification} ${styles[current.classification]}`}><Sparkles /><span>{copy.classifications[current.classification]}</span><strong>{current.playedMove}</strong></div>
              <p className={styles.explanation}>{current.explanation[locale]}</p>
              <div className={styles.metrics}>
                <article><span>{copy.winChance}</span><strong>{Math.round(current.winrateAfter * 100)}%</strong><small>−{(current.winrateLoss * 100).toFixed(1)}%</small></article>
                <article><span>{copy.score}</span><strong>{current.scoreLeadAfter > 0 ? "+" : ""}{current.scoreLeadAfter.toFixed(1)}</strong><small>−{current.scoreLoss.toFixed(1)}</small></article>
              </div>
              <section className={styles.alternatives}>
                <h2>{copy.alternatives}</h2>
                {current.alternatives.map((alternative, index) => (
                  <article key={`${current.moveNumber}:${alternative.move}`}>
                    <span>{index + 1}</span><strong>{alternative.move}</strong>
                    <div><b>{Math.round(alternative.winrate * 100)}%</b><small>{alternative.scoreLead > 0 ? "+" : ""}{alternative.scoreLead.toFixed(1)} · {alternative.visits} {copy.visits}</small></div>
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
