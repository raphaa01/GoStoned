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
import { routeSnapshot, invalidateRouteData, readRouteData, puzzleRouteKey } from "@/lib/client/routeCache";
import { ApiRequestError, readApi } from "@/lib/client/api";
import { assertResponseActor } from "@/lib/client/identityAuthority";
import { applyMove } from "@/lib/game/goEngine";
import type { Position, Stone } from "@/lib/game/types";
import { localizedApiError } from "@/lib/i18n/dictionary";
import {
  DAILY_PUZZLE_CYCLE_LENGTH,
  type PuzzleAttemptResult,
  type PuzzleAttemptAction,
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
  const [hub, setHub] = useState<PuzzleHub | null>(() => playerKey ? routeSnapshot<PuzzleHub>(puzzleRouteKey(initialMode, playerKey)) ?? null : null);
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
  const currentHub = hubOwner === playerKey ? hub : null;
  const puzzles = useMemo(() => currentHub?.puzzles ?? [], [currentHub]);

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

  const authenticated = Boolean(user);
  const requestHub = useCallback(async (signal?: AbortSignal) => {
    if (!playerKey || (mode === "practice" && !authenticated)) return null;
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
  }, [mode, playerKey, authenticated]);

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

  async function submitMove(x: number, y: number, action: PuzzleAttemptAction = "play") {
    if (!puzzle || !playerKey || busy || puzzle.solved || (branchLine && action === "play")) return;
    setSelectedPuzzleId(puzzle.id);
    setSelectedPuzzleOwner(playerKey);
    if (action === "play") setPendingMove({ x, y, color: puzzle.toPlay });
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
        body: JSON.stringify({ x, y, revision: puzzle.variationRevision, ...(action === "play" ? {} : { action }) }),
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
      void submitMove(0, 0, "undo");
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
    if (busy || hintBusy) return;
    if (nextMode === mode) return;
    if (nextMode === "practice" && !user) {
      if (!authLoading) {
        router.push(personalPuzzlesRegistrationHref);
      }
      return;
    }
    setMode(nextMode);
    setHub(playerKey ? routeSnapshot<PuzzleHub>(puzzleRouteKey(nextMode, playerKey)) ?? null : null);
    setHubOwner(playerKey);
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
  const explanation = (puzzle?.solution?.explanation[locale] ?? puzzle?.solution?.explanation.en)?.trim();
  const solutionNote = explanation && !/^(Goal reached|Ziel erreicht|Correct|Richtig)[.!]?$/i.test(explanation) ? explanation : null;
  const lastPly = visibleLine[visibleLine.length - 1] ?? null;
  const progress = copy.problemProgress
    .replace("{current}", String(mode === "daily" ? puzzle?.collectionOrder ?? 1 : selectedProblemIndex + 1))
    .replace("{total}", String(mode === "daily" ? currentHub?.dailyCycleLength ?? DAILY_PUZZLE_CYCLE_LENGTH : puzzles.length));
  const showNext = mode === "daily" ? puzzle?.solved : puzzles.length > 1;

  return (
    <div className={styles.page}>
      <header className={styles.hero}>
        <h1 className="product-page-title">{dictionary.nav.puzzles}</h1>
      </header>

      <div aria-label={copy.title} className={styles.tabs} role="tablist">
        <button aria-selected={mode === "daily"} className={mode === "daily" ? styles.activeTab : ""} disabled={busy || hintBusy} onClick={() => changeMode("daily")} role="tab" type="button">
          <strong>{copy.daily}</strong>
        </button>
        <button aria-selected={mode === "practice"} className={mode === "practice" ? styles.activeTab : ""} disabled={authLoading || busy || hintBusy} onClick={() => changeMode("practice")} role="tab" type="button">
          <strong>{copy.practice}</strong>
        </button>
      </div>

      {identityError ? (
        <div className={styles.state} role="alert"><p>{copy.identityError}</p><button className="button button--secondary" onClick={retry} type="button">{copy.retry}</button></div>
      ) : error && !currentHub ? (
        <div className={styles.state} role="alert"><p>{error}</p><button className="button button--secondary" onClick={() => void load()} type="button">{copy.retry}</button></div>
      ) : identityLoading || !puzzle || !displayBoard ? (
        <p aria-busy="true" className={styles.loading} role="status">{copy.loading}</p>
      ) : (
        <section className={styles.workspace} aria-label={mode === "daily" ? copy.daily : copy.practice} aria-busy={busy}>
          <div className={styles.positionMeta}>
            <div>
              <div className={styles.turn}>
                <span aria-hidden="true" className={styles.colorStone} data-color={puzzle.toPlay} />
                <strong>{copy.toPlay.replace("{color}", colorLabel)}</strong>
                <span>{puzzle.rankKyu ? copy.approximateRank.replace("{rank}", String(puzzle.rankKyu)) : difficultyLabel}</span>
              </div>
              <div className={styles.prompt}>
                <span>{progress}</span>
                {puzzle.goal ? <p>{puzzle.goal[locale] ?? puzzle.goal.en}</p> : null}
              </div>
            </div>
            {!puzzle.solved && !branchLine ? (
              <button aria-label={copy.hint} className={styles.hintButton} disabled={hintBusy || busy} onClick={() => void showHint()} title={copy.hint} type="button">
                <CircleHelp aria-hidden="true" size={20} />
              </button>
            ) : null}
          </div>

          {feedback === "incorrect" ? <p className={styles.message} role="status">{branchFeedback ?? copy.incorrect}</p> : null}
          <div className={styles.boardColumn}>
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
          </div>

          <div className={styles.controls}>
            {puzzle.solved ? (
              <p className={styles.solution} role="status">
                <Check aria-hidden="true" size={18} /> {puzzle.firstAttemptCorrect ? copy.firstTry : copy.solved}
              </p>
            ) : (
              <div className={styles.feedbackActions}>
                <button className="button button--secondary" disabled={busy || branchLine !== null} onClick={() => void submitMove(0, 0, "pass")} type="button">{dictionary.game.pass}</button>
                <button className="button button--secondary" disabled={busy || (!branchLine && !puzzle.variationProgress.length)} onClick={() => { if (branchLine) clearTransientState(); else void submitMove(0, 0, "restart"); }} type="button">
                  <RotateCcw aria-hidden="true" size={16} /> {copy.retry}
                </button>
                <button className="button button--secondary" disabled={busy || (!branchLine && !puzzle.variationProgress.length)} onClick={undoPuzzleMove} type="button">
                  <Undo2 aria-hidden="true" size={16} /> {copy.undoMove}
                </button>
              </div>
            )}
            {showNext ? (
              <button className="button button--primary" disabled={busy || hintBusy || (mode === "daily" && authLoading)} onClick={mode === "daily" ? () => changeMode("practice") : changeProblem} type="button">
                {mode === "daily" ? copy.practice : copy.next} <ArrowRight aria-hidden="true" size={18} />
              </button>
            ) : null}
          </div>
          {feedback !== "incorrect" && !puzzle.solved && branchFeedback ? <p className={styles.message} role="status">{branchFeedback}</p> : null}
          {puzzle.solved && solutionNote ? (
            <details className={styles.explanation}>
              <summary>{copy.explanation}</summary>
              <p>{solutionNote}</p>
            </details>
          ) : null}
          {error ? <p className={styles.error} role="alert">{error}</p> : null}
        </section>
      )}
    </div>
  );
}
