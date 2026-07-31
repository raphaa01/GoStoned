"use client";

import { ArrowLeft, ArrowRight, BrainCircuit, CalendarDays, Check, Puzzle } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { usePlayerIdentity } from "@/components/auth/PlayerIdentityProvider";
import { GoBoard } from "@/components/game/GoBoard";
import { useI18n } from "@/components/i18n/I18nProvider";
import { EXPECTED_PLAYER_HEADER } from "@/lib/auth/playerBinding";
import { readApi } from "@/lib/client/api";
import { assertResponseActor } from "@/lib/client/identityAuthority";
import { applyMove } from "@/lib/game/goEngine";
import { localizedApiError } from "@/lib/i18n/dictionary";
import type { PuzzleAttemptResult, PuzzleHub, PuzzleKind } from "@/lib/puzzles/types";
import styles from "./puzzles.module.css";

type PuzzleApiResponse = PuzzleHub & { actor: string };

export function PuzzleWorkspace() {
  const { dictionary, locale } = useI18n();
  const copy = dictionary.puzzles;
  const { playerKey, loading: identityLoading, error: identityError, retry } = usePlayerIdentity();
  const [mode, setMode] = useState<PuzzleKind>("daily");
  const [hub, setHub] = useState<PuzzleHub | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<"correct" | "incorrect" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const puzzles = hub?.puzzles ?? [];

  const requestHub = useCallback(async (signal?: AbortSignal) => {
    if (!playerKey) return null;
    const response = await fetch(`/api/puzzles?mode=${mode}`, {
      cache: "no-store",
      headers: { [EXPECTED_PLAYER_HEADER]: playerKey },
      signal,
    });
    const data = await readApi<PuzzleApiResponse>(response);
    assertResponseActor(data.actor, playerKey);
    return { status: data.status, mode: data.mode, puzzles: data.puzzles } satisfies PuzzleHub;
  }, [mode, playerKey]);

  const acceptHub = useCallback((data: PuzzleHub | null) => {
    if (!data) return;
    setHub(data);
    setSelectedIndex((current) => Math.min(current, Math.max(0, data.puzzles.length - 1)));
    setError(null);
  }, []);

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      acceptHub(await requestHub(signal));
    } catch (loadError) {
      if (signal?.aborted) return;
      setError(localizedApiError(dictionary, loadError, copy.unavailable));
    }
  }, [acceptHub, copy.unavailable, dictionary, requestHub]);

  useEffect(() => {
    const controller = new AbortController();
    void requestHub(controller.signal)
      .then(acceptHub)
      .catch((loadError) => {
        if (!controller.signal.aborted) {
          setError(localizedApiError(dictionary, loadError, copy.unavailable));
        }
      });
    return () => controller.abort();
  }, [acceptHub, copy.unavailable, dictionary, requestHub]);

  useEffect(() => {
    if (hub?.status !== "generating") return;
    const timer = window.setInterval(() => void load(), 3_000);
    return () => window.clearInterval(timer);
  }, [hub?.status, load]);

  const puzzle = puzzles[selectedIndex] ?? null;
  const displayBoard = useMemo(() => {
    if (!puzzle?.solution || !puzzle.solved) return puzzle?.board ?? null;
    const result = applyMove(
      puzzle.board,
      puzzle.toPlay,
      puzzle.solution.x,
      puzzle.solution.y,
    );
    return result.ok ? result.board : puzzle.board;
  }, [puzzle]);

  const updatePuzzle = useCallback((attempt: PuzzleAttemptResult) => {
    setHub((current) => current ? {
      ...current,
      puzzles: current.puzzles.map((entry) => entry.id === attempt.puzzleId ? {
        ...entry,
        attemptCount: attempt.attemptCount,
        solved: attempt.solved,
        firstAttemptCorrect: attempt.firstAttemptCorrect,
        solution: attempt.solution,
      } : entry),
    } : current);
  }, []);

  async function submitMove(x: number, y: number) {
    if (!puzzle || !playerKey || busy || puzzle.solved) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/puzzles/${puzzle.id}/attempt`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          [EXPECTED_PLAYER_HEADER]: playerKey,
        },
        body: JSON.stringify({ x, y }),
      });
      const data = await readApi<{ actor: string; attempt: PuzzleAttemptResult }>(response);
      assertResponseActor(data.actor, playerKey);
      updatePuzzle(data.attempt);
      setFeedback(data.attempt.correct ? "correct" : "incorrect");
    } catch (attemptError) {
      setError(localizedApiError(dictionary, attemptError, copy.attemptFailed));
    } finally {
      setBusy(false);
    }
  }

  function changeProblem(direction: -1 | 1) {
    if (!hub || hub.puzzles.length === 0) return;
    setSelectedIndex((current) => (
      current + direction + hub.puzzles.length
    ) % hub.puzzles.length);
    setFeedback(null);
    setError(null);
  }

  function changeMode(nextMode: PuzzleKind) {
    if (nextMode === mode) return;
    setMode(nextMode);
    setHub(null);
    setSelectedIndex(0);
    setFeedback(null);
    setError(null);
  }

  const difficultyLabel = puzzle ? copy[puzzle.difficulty] : null;
  const colorLabel = puzzle?.toPlay === "black" ? copy.black : copy.white;
  const explanation = puzzle?.solution?.explanation[locale];
  const lastMove = puzzle?.solution && puzzle.solved
    ? { x: puzzle.solution.x, y: puzzle.solution.y }
    : null;

  return (
    <div className={styles.page}>
      <header className={styles.hero}>
        <span className="section-kicker"><BrainCircuit size={15} /> {copy.kicker}</span>
        <h1>{copy.title}</h1>
        <p>{copy.description}</p>
      </header>

      <div aria-label={copy.title} className={styles.tabs} role="tablist">
        <button
          aria-selected={mode === "daily"}
          className={mode === "daily" ? styles.activeTab : ""}
          onClick={() => changeMode("daily")}
          role="tab"
          type="button"
        >
          <CalendarDays size={18} />
          <span><strong>{copy.daily}</strong><small>{copy.dailyDescription}</small></span>
        </button>
        <button
          aria-selected={mode === "practice"}
          className={mode === "practice" ? styles.activeTab : ""}
          onClick={() => changeMode("practice")}
          role="tab"
          type="button"
        >
          <Puzzle size={18} />
          <span><strong>{copy.practice}</strong><small>{copy.practiceDescription}</small></span>
        </button>
      </div>

      {identityLoading ? (
        <div className={styles.state} role="status">{copy.loading}</div>
      ) : identityError ? (
        <div className={styles.state} role="alert">
          <p>{copy.identityError}</p>
          <button className="button button--secondary" onClick={retry} type="button">{copy.retry}</button>
        </div>
      ) : error && !puzzle ? (
        <div className={styles.state} role="alert">
          <p>{error}</p>
          <button className="button button--secondary" onClick={() => void load()} type="button">{copy.retry}</button>
        </div>
      ) : hub?.status === "generating" || !puzzle || !displayBoard ? (
        <div className={styles.state} role="status">
          <BrainCircuit size={28} />
          <h2>{copy.generating}</h2>
          <p>{copy.generatingBody}</p>
        </div>
      ) : (
        <section className={styles.workspace} aria-label={copy.title}>
          <div className={styles.boardColumn}>
            <div className={styles.positionMeta}>
              <span className={styles.colorStone} data-color={puzzle.toPlay} />
              <strong>{copy.toPlay.replace("{color}", colorLabel)}</strong>
              <span>{difficultyLabel}</span>
            </div>
            <GoBoard
              boardSize={puzzle.boardSize}
              boardState={displayBoard}
              disabled={busy || puzzle.solved}
              lastMove={lastMove}
              onIntersectionClick={submitMove}
              precisionRevision={`puzzle:${puzzle.id}:${puzzle.attemptCount}:${puzzle.solved}`}
            />
          </div>

          <aside className={styles.panel}>
            <div>
              <span className="section-kicker">{mode === "daily" ? copy.daily : copy.practice}</span>
              <h2>{copy.chooseMove}</h2>
              <p className={styles.engineNote}>{copy.engineNote}</p>
            </div>

            {feedback === "incorrect" ? <p className={styles.incorrect} role="status">{copy.incorrect}</p> : null}
            {puzzle.solved ? (
              <div className={styles.solution} role="status">
                <span><Check size={18} /> {feedback === "correct" ? copy.correct : copy.solved}</span>
                {puzzle.firstAttemptCorrect ? <small>{copy.firstTry}</small> : null}
                <h3>{copy.explanation}</h3>
                <p>{explanation}</p>
              </div>
            ) : null}
            {error ? <p className={styles.error} role="alert">{error}</p> : null}

            {mode === "practice" && puzzles.length > 1 ? (
              <div className={styles.pager}>
                <span>{copy.problemProgress.replace("{current}", String(selectedIndex + 1)).replace("{total}", String(puzzles.length))}</span>
                <div>
                  <button aria-label={copy.previous} onClick={() => changeProblem(-1)} type="button"><ArrowLeft size={18} /></button>
                  <button aria-label={copy.next} onClick={() => changeProblem(1)} type="button"><ArrowRight size={18} /></button>
                </div>
              </div>
            ) : null}
          </aside>
        </section>
      )}
    </div>
  );
}
