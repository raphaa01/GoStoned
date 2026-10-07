"use client";

import {
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
  type PuzzleAttemptResult,
  type PuzzleHub,
  type PuzzleHint,
  type PuzzleKind,
  type PuzzlePly,
} from "@/lib/puzzles/types";
import { localPuzzleViewportSize } from "@/lib/puzzles/puzzleViewport";
import { nextUnsolvedPuzzle } from "@/lib/puzzles/queue";
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
    if (ply.move === "pass") continue;
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
  const [selectedPuzzleId, setSelectedPuzzleId] = useState<string | null>(null);
  const [selectedPuzzleOwner, setSelectedPuzzleOwner] = useState(playerKey);
  const [branchFeedback, setBranchFeedback] = useState<string | null>(null);
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
    if (hub?.status !== "generating") return;
    const timer = window.setInterval(() => void load(), 5_000);
    return () => window.clearInterval(timer);
  }, [hub?.categoryCounts, hub?.expectedPerCategory, hub?.status, load, mode, puzzles]);

  const puzzle = mode === "daily"
    ? puzzles[0] ?? null
    : puzzles.find((entry) => selectedPuzzleOwner === playerKey && entry.id === selectedPuzzleId) ?? nextUnsolvedPuzzle(puzzles);
  const selectedProblemIndex = puzzle ? puzzles.findIndex((entry) => entry.id === puzzle.id) : 0;

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
    if (playerKey) {
      invalidateRouteData(puzzleRouteKey("daily", playerKey));
      invalidateRouteData(puzzleRouteKey("practice", playerKey));
    }
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
  }, [playerKey]);

  async function submitMove(x: number, y: number) {
    if (!puzzle || !playerKey || busy || puzzle.solved || (branchLine && x >= 0)) return;
    setSelectedPuzzleId(puzzle.id);
    setSelectedPuzzleOwner(playerKey);
    if (x >= 0) setPendingMove({ x, y, color: puzzle.toPlay });
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
        setBranchLine(data.attempt.displayLineIsComplete ? data.attempt.displayLine : [...priorProgress, ...data.attempt.displayLine]);
        setFeedback("incorrect");
      } else if (data.attempt.outcome === "unknown") {
        setBranchFeedback(data.attempt.feedback?.[locale] ?? data.attempt.feedback?.en ?? null);
      } else if (data.attempt.outcome === "continue") {
        setBranchLine(null);
        setFeedback("continue");
      } else {
        setFeedback("correct");
      }
      if (data.attempt.outcome !== "unknown") setBranchFeedback(data.attempt.feedback?.[locale] ?? data.attempt.feedback?.en ?? null);
    } catch (attemptError) {
      if (redirectAccountFailure(attemptError)) return;
      if (attemptError instanceof ApiRequestError && attemptError.code === "puzzle_revision_conflict") {
        clearTransientState();
        await load();
      }
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
    setBranchFeedback(null);
  }

  function undoPuzzleMove() {
    if (!branchLine?.length) {
      void submitMove(-1, -1);
      return;
    }

    // The server retains the last correct decision. Remove the failed move
    // together with its refutation so the next move can use that revision.
    setBranchLine(null);
    setFeedback(puzzle?.variationProgress.length ? "continue" : null);
    setBranchFeedback(null);
    setError(null);
    setHintMove(null);
    setPendingMove(null);
  }

  function changeMode(nextMode: PuzzleKind) {
    if (busy) return;
    if (nextMode === mode) return;
    if (nextMode === "practice" && !user) {
      if (!authLoading) {
        router.push(personalPuzzlesRegistrationHref);
      }
      return;
    }
    setMode(nextMode);
    setHub(null);
    setSelectedPuzzleId(null);
    clearTransientState();
  }

  function changeProblem() {
    setSelectedPuzzleOwner(playerKey);
    setSelectedPuzzleId(nextUnsolvedPuzzle(puzzles, puzzle?.id)?.id ?? null);
    clearTransientState();
  }

  const difficultyLabel = puzzle ? copy[puzzle.difficulty] : null;
  const colorLabel = puzzle?.toPlay === "black" ? copy.black : copy.white;
  const explanation = puzzle?.solution?.explanation[locale] ?? puzzle?.solution?.explanation.en;
  const lastPly = visibleLine[visibleLine.length - 1] ?? null;
  const expected = puzzles.length;
  const dailyCycleLength = hub?.dailyCycleLength ?? DAILY_PUZZLE_CYCLE_LENGTH;

  return (
    <div className={styles.page}>
      <header className={styles.hero}>
        <h1 className="product-page-title">{dictionary.nav.puzzles}</h1>
      </header>

      <div aria-label={copy.title} className={styles.tabs} role="tablist">
        <button aria-selected={mode === "daily"} className={mode === "daily" ? styles.activeTab : ""} disabled={busy} onClick={() => changeMode("daily")} role="tab" type="button">
          <strong>{copy.daily}</strong>
        </button>
        <button aria-selected={mode === "practice"} className={mode === "practice" ? styles.activeTab : ""} disabled={authLoading || busy} onClick={() => changeMode("practice")} role="tab" type="button">
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
      ) : !puzzle || !displayBoard ? (
        <PuzzleLoading label={copy.generating} />
      ) : (
        <>
          <section className={styles.workspace} aria-label={copy.title} aria-busy={busy}>
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
                    : `${copy.practice} · ${copy.problemNumber.replace("{number}", String(selectedProblemIndex + 1))}`}</span>
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
              {puzzle.goal ? <p className={styles.goal}>{puzzle.goal[locale] ?? puzzle.goal.en}</p> : null}
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
                viewportSize={puzzle.viewportSize ?? (puzzle.category?.startsWith("gokyo_") ? localPuzzleViewportSize(displayBoard) : undefined)}
                targetStones={puzzle.targetStones}
              />
              {!puzzle.solved && (branchLine || puzzle.variationProgress.length > 0) ? (
                <div className={styles.feedbackActions}>
                  <button className="button button--primary" disabled={busy} onClick={() => { if (branchLine) clearTransientState(); else void submitMove(-2, -2); }} type="button">
                    <RotateCcw aria-hidden="true" size={16} /> {copy.retry}
                  </button>
                  <button className="button button--secondary" disabled={busy || (!branchLine && !puzzle.variationProgress.length)} onClick={undoPuzzleMove} type="button">
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
                    : `${copy.practice} · ${copy.problemNumber.replace("{number}", String(selectedProblemIndex + 1))}`}</span>
                </div>
                {!puzzle.solved && !branchLine ? (
                  <button aria-label={copy.hint} className={styles.hintButton} disabled={hintBusy || busy} onClick={() => void showHint()} title={copy.hint} type="button">
                    <CircleHelp size={20} />
                  </button>
                ) : null}
              </div>
              {branchFeedback ? <p className={styles.continue} role="status">{branchFeedback}</p> : null}
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
                  <span>{copy.problemProgress.replace("{current}", String(selectedProblemIndex + 1)).replace("{total}", String(expected))}</span>
                  <div>
                    <button aria-label={copy.next} disabled={busy} onClick={changeProblem} type="button"><ArrowRight size={18} /></button>
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
