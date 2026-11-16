"use client";

import {
  ArrowRight,
  ChevronLeft,
  ChevronRight,
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
import { goCoordinate } from "@/lib/game/boardAccessibility";
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

type Refutation = {
  playerKey: string;
  puzzleId: string;
  mode: PuzzleKind;
  line: PuzzlePly[];
  start: number;
  shown: number;
  feedback: string | null;
};

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
  const [refutation, setRefutation] = useState<Refutation | null>(null);
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

  const replay = refutation && refutation.playerKey === playerKey && refutation.puzzleId === puzzle?.id && refutation.mode === mode
    ? refutation
    : null;
  const visibleLine = useMemo(() => {
    if (!puzzle) return [];
    if (replay) return replay.line.slice(0, replay.shown);
    if (puzzle.solved && puzzle.solution) return puzzle.solution.line;
    return puzzle.variationProgress;
  }, [puzzle, replay]);
  const settledBoard = useMemo(() => (
    puzzle ? lineBoard(puzzle.board, visibleLine) : null
  ), [puzzle, visibleLine]);
  const displayBoard = useMemo(() => {
    if (!settledBoard || !pendingMove) return settledBoard;
    const result = applyMove(settledBoard, pendingMove.color, pendingMove.x, pendingMove.y);
    return result.ok ? result.board : settledBoard;
  }, [pendingMove, settledBoard]);

  const viewportSize = useMemo(() => {
    if (!puzzle) return undefined;
    const baseSize = puzzle.viewportSize ?? (puzzle.category?.startsWith("gokyo_") ? localPuzzleViewportSize(puzzle.board) : undefined);
    if (!baseSize) return undefined;
    const line = replay?.line ?? visibleLine;
    return line.reduce((size, ply) => Math.max(size, ply.x + 1, ply.y + 1), baseSize);
  }, [puzzle, replay, visibleLine]);

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

  async function submitMove(x: number, y: number, action: Exclude<PuzzleAttemptAction, "pass"> = "play") {
    if (!puzzle || !playerKey || busy || puzzle.solved || (replay && action === "play")) return;
    setSelectedPuzzleId(puzzle.id);
    setSelectedPuzzleOwner(playerKey);
    if (action === "play") setPendingMove({ x, y, color: puzzle.toPlay });
    setBusy(true);
    setBranchFeedback(null);
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
      const feedback = data.attempt.feedback?.[locale] ?? data.attempt.feedback?.en ?? null;
      if (data.attempt.outcome === "retry") {
        const line = data.attempt.displayLineIsComplete
          ? data.attempt.displayLine
          : [...priorProgress, ...data.attempt.displayLine];
        const start = Math.min(data.attempt.variationProgress.length, line.length);
        const shown = Math.min(priorProgress.length + 1, line.length);
        setRefutation({ playerKey, puzzleId: puzzle.id, mode, line, start, shown, feedback });
      } else {
        setRefutation(null);
        setBranchFeedback(feedback);
      }
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
    if (!puzzle || !playerKey || hintBusy || puzzle.solved || replay) return;
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
    setRefutation(null);
    setError(null);
    setHintMove(null);
    setPendingMove(null);
    setBranchFeedback(null);
  }

  function undoPuzzleMove() {
    if (!replay) {
      void submitMove(0, 0, "undo");
      return;
    }

    // The server retains the last correct decision. Remove the failed move
    // together with its refutation so the next move can use that revision.
    setRefutation(null);
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
  const lastPly = visibleLine.at(-1);
  const replayLength = replay ? replay.line.length - replay.start : 0;
  const replayEnded = !replay || replay.shown === replay.line.length;
  const replayPly = replay && replay.shown > replay.start ? lastPly : undefined;
  const replayMove = replayPly && puzzle
    ? copy.replayMove
      .replace("{color}", replayPly.color === "black" ? copy.black : copy.white)
      .replace("{move}", replayPly.move === "pass" ? copy.replayPass : goCoordinate(puzzle.boardSize, replayPly.x, replayPly.y))
    : copy.replayStart;
  const replayStatus = replay ? copy.replayProgress
    .replace("{current}", String(replay.shown - replay.start))
    .replace("{total}", String(replayLength))
    .replace("{move}", replayMove) : "";

  function stepRefutation(delta: number) {
    setRefutation((current) => current
      ? { ...current, shown: Math.max(current.start, Math.min(current.line.length, current.shown + delta)) }
      : current);
  }
  const progress = copy.problemProgress
    .replace("{current}", String(mode === "daily" ? puzzle?.collectionOrder ?? 1 : selectedProblemIndex + 1))
    .replace("{total}", String(mode === "daily" ? currentHub?.dailyCycleLength ?? DAILY_PUZZLE_CYCLE_LENGTH : puzzles.length));
  const canUndo = !puzzle?.solved && Boolean(replay || puzzle?.variationProgress.length);
  const canRetry = !puzzle?.solved && Boolean(canUndo || hintMove || branchFeedback);

  function restartPuzzle() {
    if (puzzle?.variationProgress.length) void submitMove(0, 0, "restart");
    else clearTransientState();
  }

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
        <section className={styles.workspace} aria-label={copy.title} aria-busy={busy}>
          <div className={styles.positionMeta}>
            <div>
              <div className={styles.turn}>
                <span aria-hidden="true" className={styles.colorStone} data-color={puzzle.toPlay} />
                <strong>{copy.toPlay.replace("{color}", colorLabel)}</strong>
                <span>{puzzle.rankKyu ? copy.approximateRank.replace("{rank}", String(puzzle.rankKyu)) : difficultyLabel}</span>
              </div>
            </div>
          </div>

          <div className={styles.puzzleCard}>
            <div className={styles.puzzleHeading}>
              <div className={styles.prompt}>
                <strong>{progress}</strong>
                {puzzle.goal ? <p>{puzzle.goal[locale] ?? puzzle.goal.en}</p> : null}
              </div>
              {!puzzle.solved && !replay ? (
                <button aria-label={copy.hint} className={styles.hintButton} disabled={hintBusy || busy} onClick={() => void showHint()} title={copy.hint} type="button">
                  <CircleHelp aria-hidden="true" size={20} />
                </button>
              ) : null}
            </div>

            {!puzzle.solved && replayLength <= 1 && (replay || branchFeedback) ? (
              <p className={styles.message} role="status">{replay?.feedback ?? branchFeedback ?? copy.incorrect}</p>
            ) : null}
            <div className={styles.boardColumn}>
              <GoBoard
                boardSize={puzzle.boardSize}
                boardState={displayBoard}
                disabled={busy || puzzle.solved || replay !== null}
                lastMove={pendingMove ?? (lastPly && lastPly.move !== "pass" ? { x: lastPly.x, y: lastPly.y } : null)}
                hintMove={hintMove}
                onIntersectionClick={submitMove}
                previewColor={puzzle.toPlay}
                precisionRevision={`puzzle:${puzzle.id}:${puzzle.variationRevision}:${visibleLine.length}:${replay !== null}`}
                viewportSize={viewportSize}
                targetStones={puzzle.targetStones}
              />
            </div>

            {pendingMove ? <p className={styles.message}>{copy.checkingMove}</p> : null}
            {!puzzle.solved && replayLength > 1 && replay ? (
              <div aria-label={copy.replayTitle} className={styles.replay} role="group">
                <button aria-label={copy.replayPrevious} className={styles.replayButton} disabled={busy || replay.shown === replay.start} onClick={() => stepRefutation(-1)} type="button">
                  <ChevronLeft aria-hidden="true" size={20} />
                </button>
                <div className={styles.replayStatus}>
                  <strong>{copy.replayTitle}</strong>
                  <span aria-live="polite" aria-atomic="true">{replayStatus}</span>
                </div>
                <button aria-label={copy.replayNext} className={styles.replayButton} disabled={busy || replayEnded} onClick={() => stepRefutation(1)} type="button">
                  <ChevronRight aria-hidden="true" size={20} />
                </button>
              </div>
            ) : null}
            {!puzzle.solved && replayLength > 1 ? (
              <p className={styles.message} role="status">{(replayEnded && replay?.feedback) || copy.incorrect}</p>
            ) : null}
            {puzzle.solved ? (
              <p className={styles.solution} role="status">
                <Check aria-hidden="true" size={18} /> {copy.correct}
              </p>
            ) : null}
            <div className={styles.controls}>
              {canRetry ? (
                <button className="button button--secondary" disabled={busy || hintBusy} onClick={restartPuzzle} type="button">
                  <RotateCcw aria-hidden="true" size={16} /> {copy.retry}
                </button>
              ) : null}
              {canUndo ? (
                <button className="button button--secondary" disabled={busy || hintBusy} onClick={undoPuzzleMove} type="button">
                  <Undo2 aria-hidden="true" size={16} /> {copy.undoMove}
                </button>
              ) : null}
              <button
                className="button button--primary"
                disabled={busy || hintBusy || (mode === "daily" ? authLoading : puzzles.length < 2)}
                onClick={mode === "daily" ? () => changeMode("practice") : changeProblem}
                type="button"
              >
                {copy.next} <ArrowRight aria-hidden="true" size={16} />
              </button>
            </div>
            {error ? <p className={styles.error} role="alert">{error}</p> : null}
          </div>
        </section>
      )}
    </div>
  );
}
