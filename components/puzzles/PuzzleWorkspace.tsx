"use client";

import {
  ArrowLeft,
  ArrowRight,
  Check,
  CircleHelp,
  RotateCcw,
  Undo2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/auth/AuthProvider";
import { usePlayerIdentity } from "@/components/auth/PlayerIdentityProvider";
import { GoBoard } from "@/components/game/GoBoard";
import { useI18n } from "@/components/i18n/I18nProvider";
import { EXPECTED_PLAYER_HEADER } from "@/lib/auth/playerBinding";
import { accountRegistrationPath } from "@/lib/auth/returnPath";
import { cachedRouteData, invalidateRouteData, readRouteData, puzzleRouteKey } from "@/lib/client/routeCache";
import { ApiRequestError, readApi } from "@/lib/client/api";
import { assertResponseActor } from "@/lib/client/identityAuthority";
import { applyMove } from "@/lib/game/goEngine";
import type { Position, Stone } from "@/lib/game/types";
import { localizedApiError } from "@/lib/i18n/dictionary";
import {
  DAILY_PUZZLE_CYCLE_LENGTH,
  PUZZLE_CATEGORIES,
  type PuzzleAttemptResult,
  type PuzzleCategory,
  type PuzzleHub,
  type PuzzleHint,
  type PuzzleKind,
  type PuzzlePly,
} from "@/lib/puzzles/types";
import { localPuzzleViewportSize } from "@/lib/puzzles/puzzleViewport";
import {
  PUZZLE_CATALOG_SOURCES,
  puzzlesForCatalogCategory,
  resumePuzzleIndex,
  type PuzzleCatalogCategory,
} from "@/lib/puzzles/categoryProgress";
import styles from "./puzzles.module.css";

type PuzzleApiResponse = PuzzleHub & { actor: string };
type Feedback = "correct" | "incorrect" | "continue" | null;

function PuzzleLoading({ label }: { label: string }) {
  return (
    <div aria-busy="true" className={styles.loadingWorkspace} role="status">
      <span className="sr-only">{label}</span>
      <div aria-hidden="true" className={styles.loadingBoard} />
      <div aria-hidden="true" className={styles.loadingPanel}>
        <i /><b /><i /><i /><span />
      </div>
    </div>
  );
}

function lineBoard(base: PuzzleHub["puzzles"][number]["board"], line: readonly PuzzlePly[]) {
  let board = base;
  for (const ply of line) {
    const applied = applyMove(board, ply.color, ply.x, ply.y);
    if (!applied.ok) return base;
    board = applied.board;
  }
  return board;
}

export function PuzzleWorkspace({ initialMode = "daily" }: { initialMode?: PuzzleKind }) {
  const router = useRouter();
  const { loading: authLoading, user } = useAuth();
  const { dictionary, href, locale } = useI18n();
  const copy = dictionary.puzzles;
  const { playerKey, loading: identityLoading, error: identityError, retry } = usePlayerIdentity();
  const personalPuzzlesRegistrationHref = href(
    accountRegistrationPath("/puzzles?mode=practice"),
  );
  const [mode, setMode] = useState<PuzzleKind>(initialMode);
  const [hub, setHub] = useState<PuzzleHub | null>(() => playerKey ? cachedRouteData<PuzzleHub>(puzzleRouteKey(initialMode, playerKey)) ?? null : null);
  const [hubOwner, setHubOwner] = useState(playerKey);
  const [selectedCategory, setSelectedCategory] = useState<PuzzleCatalogCategory | null>(null);
  const [selectedProblemIndex, setSelectedProblemIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [branchLine, setBranchLine] = useState<PuzzlePly[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hintMove, setHintMove] = useState<PuzzleHint | null>(null);
  const [hintBusy, setHintBusy] = useState(false);
  const [pendingMove, setPendingMove] = useState<(Position & { color: Stone }) | null>(null);
  const puzzles = useMemo(() => hubOwner === playerKey ? hub?.puzzles ?? [] : [], [hub?.puzzles, hubOwner, playerKey]);

  const redirectAccountFailure = useCallback((requestError: unknown) => {
    if (
      mode !== "practice"
      || !(requestError instanceof ApiRequestError)
      || (requestError.code !== "authentication_required"
        && requestError.code !== "session_expired")
    ) return false;
    router.replace(personalPuzzlesRegistrationHref);
    return true;
  }, [mode, personalPuzzlesRegistrationHref, router]);

  const requestHub = useCallback(async (signal?: AbortSignal) => {
    if (!playerKey || (mode === "practice" && !user)) return null;
    const data = await readRouteData(puzzleRouteKey(mode, playerKey), async () => {
      const response = await fetch(`/api/puzzles?mode=${mode}`, {
        cache: "no-store",
        headers: { [EXPECTED_PLAYER_HEADER]: playerKey },
        signal: AbortSignal.timeout(20_000),
      });
      const result = await readApi<PuzzleApiResponse>(response);
      assertResponseActor(result.actor, playerKey);
      return result;
    });
    if (signal?.aborted) return null;
    return {
      status: data.status,
      mode: data.mode,
      puzzles: data.puzzles,
      expectedPerCategory: data.expectedPerCategory,
      categoryCounts: data.categoryCounts,
      dailyCycleLength: data.dailyCycleLength,
    } satisfies PuzzleHub;
  }, [mode, playerKey, user]);

  useEffect(() => {
    if (mode !== "practice" || authLoading || user) return;
    router.replace(personalPuzzlesRegistrationHref);
  }, [authLoading, mode, personalPuzzlesRegistrationHref, router, user]);

  const acceptHub = useCallback((data: PuzzleHub | null) => {
    if (!data) return;
    setHub(data);
    setHubOwner(playerKey);
    setError(null);
  }, [playerKey]);

  const load = useCallback(async (signal?: AbortSignal) => {
    if (playerKey) invalidateRouteData(puzzleRouteKey(mode, playerKey));
    try {
      acceptHub(await requestHub(signal));
    } catch (loadError) {
      if (signal?.aborted) return;
      if (redirectAccountFailure(loadError)) return;
      setError(localizedApiError(dictionary, loadError, copy.unavailable));
    }
  }, [acceptHub, copy.unavailable, dictionary, redirectAccountFailure, requestHub, mode, playerKey]);

  useEffect(() => {
    const controller = new AbortController();
    void requestHub(controller.signal)
      .then(acceptHub)
      .catch((loadError) => {
        if (!controller.signal.aborted) {
          if (redirectAccountFailure(loadError)) return;
          setError(localizedApiError(dictionary, loadError, copy.unavailable));
        }
      });
    return () => controller.abort();
  }, [acceptHub, copy.unavailable, dictionary, redirectAccountFailure, requestHub]);

  useEffect(() => {
    const incompleteCatalog = mode === "practice"
      && PUZZLE_CATEGORIES.some((category) => (
        puzzles.filter((entry) => entry.category === category).length
          < (hub?.categoryCounts[category] ?? hub?.expectedPerCategory ?? 10)
      ));
    if (hub?.status !== "generating" && !incompleteCatalog) return;
    const timer = window.setInterval(() => void load(), 5_000);
    return () => window.clearInterval(timer);
  }, [hub?.categoryCounts, hub?.expectedPerCategory, hub?.status, load, mode, puzzles]);

  const categoryPuzzles = selectedCategory
    ? puzzlesForCatalogCategory(puzzles, selectedCategory)
    : [];
  const puzzle = mode === "daily"
    ? puzzles[0] ?? null
    : categoryPuzzles[selectedProblemIndex] ?? null;

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
    if (playerKey) invalidateRouteData(puzzleRouteKey(mode, playerKey));
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
  }, [mode, playerKey]);

  async function submitMove(x: number, y: number) {
    if (!puzzle || !playerKey || busy || puzzle.solved || branchLine) return;
    setPendingMove({ x, y, color: puzzle.toPlay });
    setBusy(true);
    setHintMove(null);
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
        }
        setFeedback("incorrect");
      } else if (data.attempt.outcome === "continue") {
        setFeedback("continue");
      } else {
        setFeedback("correct");
      }
    } catch (attemptError) {
      if (redirectAccountFailure(attemptError)) return;
      setError(localizedApiError(dictionary, attemptError, copy.attemptFailed));
    } finally {
      setPendingMove(null);
      setBusy(false);
    }
  }

  async function showHint() {
    if (!puzzle || !playerKey || hintBusy || puzzle.solved || branchLine) return;
    setHintBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/puzzles/${puzzle.id}/hint`, {
        cache: "no-store",
        headers: { [EXPECTED_PLAYER_HEADER]: playerKey },
      });
      const data = await readApi<{ actor: string; hint: PuzzleHint }>(response);
      assertResponseActor(data.actor, playerKey);
      setHintMove(data.hint);
    } catch (hintError) {
      if (redirectAccountFailure(hintError)) return;
      setError(localizedApiError(dictionary, hintError, copy.hintFailed));
    } finally {
      setHintBusy(false);
    }
  }

  function clearTransientState() {
    setFeedback(null);
    setBranchLine(null);
    setError(null);
    setHintMove(null);
    setPendingMove(null);
  }

  function undoPuzzleMove() {
    if (!branchLine?.length) {
      clearTransientState();
      return;
    }

    // The server retains the last correct decision. Remove the failed move
    // together with its refutation so the next move can use that revision.
    setBranchLine(null);
    setFeedback(puzzle?.variationProgress.length ? "continue" : null);
    setError(null);
    setHintMove(null);
    setPendingMove(null);
  }

  function changeMode(nextMode: PuzzleKind) {
    if (nextMode === mode) return;
    if (nextMode === "practice" && !user) {
      if (!authLoading) {
        router.push(personalPuzzlesRegistrationHref);
      }
      return;
    }
    setMode(nextMode);
    setHub(null);
    setSelectedCategory(null);
    setSelectedProblemIndex(0);
    clearTransientState();
  }

  function chooseCategory(category: PuzzleCatalogCategory) {
    setSelectedCategory(category);
    setSelectedProblemIndex(resumePuzzleIndex(puzzles, category));
    clearTransientState();
  }

  function chooseProblem(index: number) {
    setSelectedProblemIndex(index);
    clearTransientState();
  }

  function changeProblem(direction: -1 | 1) {
    if (categoryPuzzles.length === 0) return;
    const next = (selectedProblemIndex + direction + categoryPuzzles.length) % categoryPuzzles.length;
    setSelectedProblemIndex(next);
    clearTransientState();
  }

  const categories = [
    { id: "life_and_death" as const, title: copy.lifeAndDeath, description: copy.lifeAndDeathDescription, sources: PUZZLE_CATALOG_SOURCES.life_and_death },
    { id: "tesuji" as const, title: copy.tesuji, description: copy.tesujiDescription, sources: PUZZLE_CATALOG_SOURCES.tesuji },
    { id: "capturing_race" as const, title: copy.capturingRace, description: copy.capturingRaceDescription, sources: PUZZLE_CATALOG_SOURCES.capturing_race },
    { id: "endgame" as const, title: copy.endgame, description: copy.endgameDescription, sources: PUZZLE_CATALOG_SOURCES.endgame },
    { id: "ko" as const, title: copy.gokyoKo, description: copy.gokyoKoDescription, sources: PUZZLE_CATALOG_SOURCES.ko },
  ];
  const categoryCopy = categories.find((entry) => entry.id === selectedCategory);
  const difficultyLabel = puzzle ? copy[puzzle.difficulty] : null;
  const colorLabel = puzzle?.toPlay === "black" ? copy.black : copy.white;
  const explanation = puzzle?.solution?.explanation[locale] ?? puzzle?.solution?.explanation.en;
  const lastPly = visibleLine[visibleLine.length - 1] ?? null;
  const expected = selectedCategory
    ? categoryPuzzles.length
    : hub?.expectedPerCategory ?? 10;
  const dailyCycleLength = hub?.dailyCycleLength ?? DAILY_PUZZLE_CYCLE_LENGTH;
  function categoryButton(category: typeof categories[number]) {
    const sources: readonly PuzzleCategory[] = category.sources;
    const ready = puzzles.filter((entry) => entry.category !== null && sources.includes(entry.category)).length;
    const total = sources.reduce((sum, source) => sum + (hub?.categoryCounts[source] ?? 0), 0)
      || hub?.expectedPerCategory
      || 10;
    return (
      <button key={category.id} onClick={() => chooseCategory(category.id)} type="button">
        <span><strong>{category.title}</strong></span>
        <small>{copy.catalogProgress.replace("{ready}", String(ready)).replace("{total}", String(total))}</small>
      </button>
    );
  }

  return (
    <div className={styles.page}>
      <header className={styles.hero}>
        <h1 className="product-page-title">{dictionary.nav.puzzles}</h1>
      </header>

      <div aria-label={copy.title} className={styles.tabs} role="tablist">
        <button aria-selected={mode === "daily"} className={mode === "daily" ? styles.activeTab : ""} onClick={() => changeMode("daily")} role="tab" type="button">
          <strong>{copy.daily}</strong>
        </button>
        <button aria-selected={mode === "practice"} className={mode === "practice" ? styles.activeTab : ""} disabled={authLoading} onClick={() => changeMode("practice")} role="tab" type="button">
          <strong>{copy.practice}</strong>
        </button>
      </div>

      {identityLoading ? (
        <PuzzleLoading label={copy.loading} />
      ) : identityError ? (
        <div className={styles.state} role="alert"><p>{copy.identityError}</p><button className="button button--secondary" onClick={retry} type="button">{copy.retry}</button></div>
      ) : error && !hub ? (
        <div className={styles.state} role="alert"><p>{error}</p><button className="button button--secondary" onClick={() => void load()} type="button">{copy.retry}</button></div>
      ) : mode === "practice" && !hub ? (
        <PuzzleLoading label={copy.loading} />
      ) : mode === "practice" && selectedCategory === null ? (
        <section className={styles.catalog} aria-labelledby="puzzle-category-title">
          <div className={styles.catalogHeader}>
            <h2 id="puzzle-category-title">{copy.chooseCategory}</h2>
          </div>
          <div className={styles.categoryGrid}>
            {categories.map(categoryButton)}
          </div>
        </section>
      ) : !puzzle || !displayBoard ? (
        <PuzzleLoading label={copy.generating} />
      ) : (
        <>
          {mode === "practice" ? (
            <div className={styles.collectionBar}>
              <button className={styles.backButton} onClick={() => { setSelectedCategory(null); clearTransientState(); }} type="button"><ArrowLeft size={16} /> {copy.backToCategories}</button>
              <div><strong>{categoryCopy?.title}</strong><span>{copy.approximateRank.replace("{rank}", String(puzzle.rankKyu ?? "–"))}</span></div>
              {expected > 20 ? (
                <label className={styles.problemJump}>
                  <span>{copy.problemProgress.replace("{current}", String(selectedProblemIndex + 1)).replace("{total}", String(expected))}</span>
                  <select aria-label={copy.problemProgress.replace("{current}", String(selectedProblemIndex + 1)).replace("{total}", String(expected))} onChange={(event) => chooseProblem(Number(event.target.value))} value={selectedProblemIndex}>
                    {Array.from({ length: expected }, (_, index) => index).map((index) => (
                      <option key={index} value={index}>{index + 1}</option>
                    ))}
                  </select>
                </label>
              ) : (
                <nav aria-label={copy.problemProgress.replace("{current}", String(selectedProblemIndex + 1)).replace("{total}", String(expected))}>
                  {Array.from({ length: expected }, (_, index) => index).map((index) => {
                    const entry = categoryPuzzles[index];
                    return <button aria-current={index === selectedProblemIndex ? "step" : undefined} disabled={!entry} key={index} onClick={() => chooseProblem(index)} type="button">{index + 1}</button>;
                  })}
                </nav>
              )}
            </div>
          ) : null}

          <section className={styles.workspace} aria-label={copy.title}>
            <div className={styles.boardColumn}>
              <div className={styles.positionMeta}>
                <span className={styles.colorStone} data-color={puzzle.toPlay} />
                <strong>{copy.toPlay.replace("{color}", colorLabel)}</strong>
                <span>{puzzle.rankKyu ? copy.approximateRank.replace("{rank}", String(puzzle.rankKyu)) : difficultyLabel}</span>
              </div>
              <div className={styles.taskPrompt}>
                <div>
                  <span className={styles.problemLabel}>{mode === "daily"
                    ? `${copy.daily} · ${copy.problemProgress.replace("{current}", String(puzzle.collectionOrder ?? 1)).replace("{total}", String(dailyCycleLength))}`
                    : `${categoryCopy?.title} · ${copy.problemNumber.replace("{number}", String(selectedProblemIndex + 1))}`}</span>
                </div>
                {!puzzle.solved && !branchLine ? (
                  <button aria-label={copy.hint} className={styles.hintButton} disabled={hintBusy || busy} onClick={() => void showHint()} title={copy.hint} type="button">
                    <CircleHelp size={20} />
                  </button>
                ) : null}
              </div>
              {feedback === "incorrect" ? (
                <div className={styles.inlineIncorrect} role="status">
                  <strong>{copy.incorrect}</strong>
                </div>
              ) : null}
              <GoBoard
                boardSize={puzzle.boardSize}
                boardState={displayBoard}
                disabled={busy || puzzle.solved || branchLine !== null}
                lastMove={lastPly ? { x: lastPly.x, y: lastPly.y } : null}
                hintMove={hintMove}
                onIntersectionClick={submitMove}
                pendingMove={pendingMove}
                previewColor={puzzle.toPlay}
                precisionRevision={`puzzle:${puzzle.id}:${puzzle.variationRevision}:${visibleLine.length}:${branchLine !== null}`}
                viewportSize={puzzle.category?.startsWith("gokyo_") ? localPuzzleViewportSize(displayBoard) : undefined}
              />
              {feedback === "incorrect" ? (
                <div className={styles.feedbackActions}>
                  <button className="button button--primary" onClick={clearTransientState} type="button">
                    <RotateCcw aria-hidden="true" size={16} /> {copy.retry}
                  </button>
                  <button className="button button--secondary" onClick={undoPuzzleMove} type="button">
                    <Undo2 aria-hidden="true" size={16} /> {copy.undoMove}
                  </button>
                </div>
              ) : null}
            </div>

            <aside className={styles.panel}>
              <div className={styles.panelPrompt}>
                <div>
                  <span className={styles.problemLabel}>{mode === "daily"
                    ? `${copy.daily} · ${copy.problemProgress.replace("{current}", String(puzzle.collectionOrder ?? 1)).replace("{total}", String(dailyCycleLength))}`
                    : `${categoryCopy?.title} · ${copy.problemNumber.replace("{number}", String(selectedProblemIndex + 1))}`}</span>
                </div>
                {!puzzle.solved && !branchLine ? (
                  <button aria-label={copy.hint} className={styles.hintButton} disabled={hintBusy || busy} onClick={() => void showHint()} title={copy.hint} type="button">
                    <CircleHelp size={20} />
                  </button>
                ) : null}
              </div>
              {feedback === "continue" ? <p className={styles.continue} role="status">{copy.continueLine}</p> : null}
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
                  <span>{copy.problemProgress.replace("{current}", String(selectedProblemIndex + 1)).replace("{total}", String(expected))}</span>
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
