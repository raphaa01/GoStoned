"use client";

import {
  ArrowLeft,
  ArrowRight,
  BrainCircuit,
  CalendarDays,
  Check,
  Crosshair,
  HeartPulse,
  Puzzle,
  Sparkles,
  TimerReset,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { usePlayerIdentity } from "@/components/auth/PlayerIdentityProvider";
import { GoBoard } from "@/components/game/GoBoard";
import { useI18n } from "@/components/i18n/I18nProvider";
import type { LocalizedText } from "@/lib/i18n/config";
import { EXPECTED_PLAYER_HEADER } from "@/lib/auth/playerBinding";
import { readApi } from "@/lib/client/api";
import { assertResponseActor } from "@/lib/client/identityAuthority";
import { applyMove } from "@/lib/game/goEngine";
import { localizedApiError } from "@/lib/i18n/dictionary";
import {
  PUZZLE_CATEGORIES,
  type PuzzleAttemptResult,
  type PuzzleCategory,
  type PuzzleHub,
  type PuzzleKind,
  type PuzzlePly,
} from "@/lib/puzzles/types";
import styles from "./puzzles.module.css";

type PuzzleApiResponse = PuzzleHub & { actor: string };
type Feedback = "correct" | "incorrect" | "continue" | null;

function lineBoard(base: PuzzleHub["puzzles"][number]["board"], line: readonly PuzzlePly[]) {
  let board = base;
  for (const ply of line) {
    const applied = applyMove(board, ply.color, ply.x, ply.y);
    if (!applied.ok) return base;
    board = applied.board;
  }
  return board;
}

export function PuzzleWorkspace() {
  const { dictionary, locale } = useI18n();
  const copy = dictionary.puzzles;
  const { playerKey, loading: identityLoading, error: identityError, retry } = usePlayerIdentity();
  const [mode, setMode] = useState<PuzzleKind>("daily");
  const [hub, setHub] = useState<PuzzleHub | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<PuzzleCategory | null>(null);
  const [selectedOrder, setSelectedOrder] = useState(1);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [branchLine, setBranchLine] = useState<PuzzlePly[] | null>(null);
  const [branchExplanation, setBranchExplanation] = useState<LocalizedText | null>(null);
  const [error, setError] = useState<string | null>(null);
  const puzzles = useMemo(() => hub?.puzzles ?? [], [hub?.puzzles]);

  const requestHub = useCallback(async (signal?: AbortSignal) => {
    if (!playerKey) return null;
    const response = await fetch(`/api/puzzles?mode=${mode}`, {
      cache: "no-store",
      headers: { [EXPECTED_PLAYER_HEADER]: playerKey },
      signal,
    });
    const data = await readApi<PuzzleApiResponse>(response);
    assertResponseActor(data.actor, playerKey);
    return {
      status: data.status,
      mode: data.mode,
      puzzles: data.puzzles,
      expectedPerCategory: data.expectedPerCategory,
    } satisfies PuzzleHub;
  }, [mode, playerKey]);

  const acceptHub = useCallback((data: PuzzleHub | null) => {
    if (!data) return;
    setHub(data);
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
    const incompleteCatalog = mode === "practice"
      && (hub?.puzzles.length ?? 0) < PUZZLE_CATEGORIES.length * (hub?.expectedPerCategory ?? 10);
    if (hub?.status !== "generating" && !incompleteCatalog) return;
    const timer = window.setInterval(() => void load(), 5_000);
    return () => window.clearInterval(timer);
  }, [hub?.expectedPerCategory, hub?.puzzles.length, hub?.status, load, mode]);

  const categoryPuzzles = useMemo(() => (
    selectedCategory
      ? puzzles.filter((entry) => entry.category === selectedCategory)
      : []
  ), [puzzles, selectedCategory]);
  const puzzle = mode === "daily"
    ? puzzles[0] ?? null
    : categoryPuzzles.find((entry) => entry.collectionOrder === selectedOrder) ?? null;

  const visibleLine = useMemo(() => {
    if (!puzzle) return [];
    if (branchLine) return branchLine;
    if (puzzle.solved && puzzle.solution) return puzzle.solution.line;
    return puzzle.variationProgress;
  }, [branchLine, puzzle]);
  const displayBoard = useMemo(() => (
    puzzle ? lineBoard(puzzle.board, visibleLine) : null
  ), [puzzle, visibleLine]);

  const updatePuzzle = useCallback((attempt: PuzzleAttemptResult) => {
    setHub((current) => current ? {
      ...current,
      puzzles: current.puzzles.map((entry) => entry.id === attempt.puzzleId ? {
        ...entry,
        attemptCount: attempt.attemptCount,
        solved: attempt.solved,
        firstAttemptCorrect: attempt.firstAttemptCorrect,
        variationProgress: attempt.variationProgress,
        variationRevision: attempt.variationRevision,
        solution: attempt.solution,
      } : entry),
    } : current);
  }, []);

  async function submitMove(x: number, y: number) {
    if (!puzzle || !playerKey || busy || puzzle.solved || branchLine) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/puzzles/${puzzle.id}/attempt`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          [EXPECTED_PLAYER_HEADER]: playerKey,
        },
        body: JSON.stringify({ x, y, revision: puzzle.variationRevision }),
      });
      const data = await readApi<{ actor: string; attempt: PuzzleAttemptResult }>(response);
      assertResponseActor(data.actor, playerKey);
      const priorProgress = puzzle.variationProgress;
      updatePuzzle(data.attempt);
      if (data.attempt.outcome === "retry") {
        if (puzzle.category) {
          setBranchLine([...priorProgress, ...data.attempt.displayLine]);
          setBranchExplanation(data.attempt.feedback);
        }
        setFeedback("incorrect");
      } else if (data.attempt.outcome === "continue") {
        setFeedback("continue");
      } else {
        setFeedback("correct");
      }
    } catch (attemptError) {
      setError(localizedApiError(dictionary, attemptError, copy.attemptFailed));
    } finally {
      setBusy(false);
    }
  }

  function clearTransientState() {
    setFeedback(null);
    setBranchLine(null);
    setBranchExplanation(null);
    setError(null);
  }

  function changeMode(nextMode: PuzzleKind) {
    if (nextMode === mode) return;
    setMode(nextMode);
    setHub(null);
    setSelectedCategory(null);
    setSelectedOrder(1);
    clearTransientState();
  }

  function chooseCategory(category: PuzzleCategory) {
    setSelectedCategory(category);
    const first = puzzles.find((entry) => entry.category === category)?.collectionOrder ?? 1;
    setSelectedOrder(first);
    clearTransientState();
  }

  function chooseProblem(order: number) {
    setSelectedOrder(order);
    clearTransientState();
  }

  function changeProblem(direction: -1 | 1) {
    if (categoryPuzzles.length === 0) return;
    const current = categoryPuzzles.findIndex((entry) => entry.collectionOrder === selectedOrder);
    const next = (Math.max(0, current) + direction + categoryPuzzles.length) % categoryPuzzles.length;
    setSelectedOrder(categoryPuzzles[next]?.collectionOrder ?? 1);
    clearTransientState();
  }

  const categories = [
    { id: "life_and_death" as const, icon: HeartPulse, title: copy.lifeAndDeath, body: copy.lifeAndDeathDescription },
    { id: "tesuji" as const, icon: Sparkles, title: copy.tesuji, body: copy.tesujiDescription },
    { id: "capturing_race" as const, icon: Crosshair, title: copy.capturingRace, body: copy.capturingRaceDescription },
    { id: "endgame" as const, icon: TimerReset, title: copy.endgame, body: copy.endgameDescription },
  ];
  const categoryCopy = categories.find((entry) => entry.id === selectedCategory);
  const difficultyLabel = puzzle ? copy[puzzle.difficulty] : null;
  const colorLabel = puzzle?.toPlay === "black" ? copy.black : copy.white;
  const explanation = puzzle?.solution?.explanation[locale];
  const lastPly = visibleLine[visibleLine.length - 1] ?? null;
  const expected = hub?.expectedPerCategory ?? 10;

  return (
    <div className={styles.page}>
      <header className={styles.hero}>
        <span className="section-kicker"><BrainCircuit size={15} /> {copy.kicker}</span>
        <h1>{copy.title}</h1>
        <p>{copy.description}</p>
      </header>

      <div aria-label={copy.title} className={styles.tabs} role="tablist">
        <button aria-selected={mode === "daily"} className={mode === "daily" ? styles.activeTab : ""} onClick={() => changeMode("daily")} role="tab" type="button">
          <CalendarDays size={18} />
          <span><strong>{copy.daily}</strong><small>{copy.dailyDescription}</small></span>
        </button>
        <button aria-selected={mode === "practice"} className={mode === "practice" ? styles.activeTab : ""} onClick={() => changeMode("practice")} role="tab" type="button">
          <Puzzle size={18} />
          <span><strong>{copy.practice}</strong><small>{copy.practiceDescription}</small></span>
        </button>
      </div>

      {identityLoading ? (
        <div className={styles.state} role="status">{copy.loading}</div>
      ) : identityError ? (
        <div className={styles.state} role="alert"><p>{copy.identityError}</p><button className="button button--secondary" onClick={retry} type="button">{copy.retry}</button></div>
      ) : error && !hub ? (
        <div className={styles.state} role="alert"><p>{error}</p><button className="button button--secondary" onClick={() => void load()} type="button">{copy.retry}</button></div>
      ) : mode === "practice" && selectedCategory === null ? (
        <section className={styles.catalog} aria-labelledby="puzzle-category-title">
          <div className={styles.catalogHeader}>
            <h2 id="puzzle-category-title">{copy.chooseCategory}</h2>
            <p>{copy.categoryDescription}</p>
          </div>
          <div className={styles.categoryGrid}>
            {categories.map((category) => {
              const ready = puzzles.filter((entry) => entry.category === category.id).length;
              const Icon = category.icon;
              return (
                <button key={category.id} onClick={() => chooseCategory(category.id)} type="button">
                  <span className={styles.categoryIcon}><Icon size={22} /></span>
                  <strong>{category.title}</strong>
                  <p>{category.body}</p>
                  <small>{copy.catalogProgress.replace("{ready}", String(ready)).replace("{total}", String(expected))}</small>
                </button>
              );
            })}
          </div>
        </section>
      ) : hub?.status === "generating" || !puzzle || !displayBoard ? (
        <div className={styles.state} role="status"><BrainCircuit size={28} /><h2>{copy.generating}</h2><p>{copy.generatingBody}</p></div>
      ) : (
        <>
          {mode === "practice" ? (
            <div className={styles.collectionBar}>
              <button className={styles.backButton} onClick={() => { setSelectedCategory(null); clearTransientState(); }} type="button"><ArrowLeft size={16} /> {copy.backToCategories}</button>
              <div><strong>{categoryCopy?.title}</strong><span>{copy.approximateRank.replace("{rank}", String(puzzle.rankKyu ?? "–"))}</span></div>
              <nav aria-label={copy.problemProgress.replace("{current}", String(selectedOrder)).replace("{total}", String(expected))}>
                {Array.from({ length: expected }, (_, index) => index + 1).map((order) => {
                  const entry = categoryPuzzles.find((candidate) => candidate.collectionOrder === order);
                  return <button aria-current={order === selectedOrder ? "step" : undefined} disabled={!entry} key={order} onClick={() => chooseProblem(order)} type="button">{order}</button>;
                })}
              </nav>
            </div>
          ) : null}

          <section className={styles.workspace} aria-label={copy.title}>
            <div className={styles.boardColumn}>
              <div className={styles.positionMeta}>
                <span className={styles.colorStone} data-color={puzzle.toPlay} />
                <strong>{copy.toPlay.replace("{color}", colorLabel)}</strong>
                <span>{puzzle.rankKyu ? copy.approximateRank.replace("{rank}", String(puzzle.rankKyu)) : difficultyLabel}</span>
              </div>
              <GoBoard
                boardSize={puzzle.boardSize}
                boardState={displayBoard}
                disabled={busy || puzzle.solved || branchLine !== null}
                lastMove={lastPly ? { x: lastPly.x, y: lastPly.y } : null}
                onIntersectionClick={submitMove}
                precisionRevision={`puzzle:${puzzle.id}:${puzzle.variationRevision}:${visibleLine.length}:${branchLine !== null}`}
              />
            </div>

            <aside className={styles.panel}>
              <div>
                <span className="section-kicker">{mode === "daily" ? copy.daily : `${categoryCopy?.title} · ${copy.problemNumber.replace("{number}", String(puzzle.collectionOrder ?? 1))}`}</span>
                <h2>{puzzle.category ? copy.chooseVariationMove : copy.chooseMove}</h2>
                <p className={styles.engineNote}>{copy.engineNote}</p>
              </div>

              {feedback === "continue" ? <p className={styles.continue} role="status">{copy.continueLine}</p> : null}
              {feedback === "incorrect" ? (
                <div className={styles.incorrect} role="status">
                  <strong>{copy.incorrect}</strong>
                  {branchExplanation ? <p>{branchExplanation[locale]}</p> : null}
                  {branchLine ? <button className="button button--secondary" onClick={clearTransientState} type="button">{copy.retryVariation}</button> : null}
                </div>
              ) : null}
              {puzzle.solved ? (
                <div className={styles.solution} role="status">
                  <span><Check size={18} /> {feedback === "correct" ? copy.correct : copy.solved}</span>
                  {puzzle.firstAttemptCorrect ? <small>{copy.firstTry}</small> : null}
                  <h3>{copy.explanation}</h3>
                  <p>{explanation}</p>
                </div>
              ) : null}
              {error ? <p className={styles.error} role="alert">{error}</p> : null}

              {mode === "practice" && categoryPuzzles.length > 1 ? (
                <div className={styles.pager}>
                  <span>{copy.problemProgress.replace("{current}", String(puzzle.collectionOrder ?? selectedOrder)).replace("{total}", String(expected))}</span>
                  <div>
                    <button aria-label={copy.previous} onClick={() => changeProblem(-1)} type="button"><ArrowLeft size={18} /></button>
                    <button aria-label={copy.next} onClick={() => changeProblem(1)} type="button"><ArrowRight size={18} /></button>
                  </div>
                </div>
              ) : null}
            </aside>
          </section>
        </>
      )}
    </div>
  );
}
