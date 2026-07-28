"use client";

import { ShieldCheck, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { usePlayerIdentity } from "@/components/auth/PlayerIdentityProvider";
import { useI18n } from "@/components/i18n/I18nProvider";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { readApi } from "@/lib/client/api";
import { leaveGameAndQueue } from "@/lib/client/leaveGame";
import { createPollingRequestGuard, nextPollDelay } from "@/lib/client/polling";
import type { BoardSize, TimeControlId } from "@/lib/game/types";
import { localizedApiError } from "@/lib/i18n/dictionary";
import { ActiveGamePanel } from "./ActiveGamePanel";
import { BoardSizeSelector } from "./BoardSizeSelector";
import { MatchmakingPanel } from "./MatchmakingPanel";
import { TimeControlSelector } from "./TimeControlSelector";

type QueueState = {
  status: "idle" | "waiting" | "matched";
  gameId: string | null;
  boardSize: BoardSize | null;
  timeControl: TimeControlId | null;
};

export function PlayWorkspace({ initialSize = 9 }: { initialSize?: BoardSize }) {
  const router = useRouter();
  const { dictionary, href } = useI18n();
  const copy = dictionary.play;
  const {
    playerKey,
    playerName,
    loading,
    error: identityError,
    retry: retryIdentity,
  } = usePlayerIdentity();
  const [boardSize, setBoardSize] = useState<BoardSize>(initialSize);
  const [timeControl, setTimeControl] = useState<TimeControlId>("rapid");
  const [queueStatus, setQueueStatus] = useState<"idle" | "waiting">("idle");
  const [activeGame, setActiveGame] = useState<{
    gameId: string;
    boardSize: BoardSize;
    timeControl: TimeControlId;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);

  const handleQueueState = useCallback((queue: QueueState, enterMatchedGame: boolean) => {
    if (queue.boardSize) setBoardSize(queue.boardSize);
    if (queue.timeControl) setTimeControl(queue.timeControl);
    if (
      queue.status === "matched" &&
      queue.gameId &&
      queue.boardSize &&
      queue.timeControl
    ) {
      if (enterMatchedGame) {
        router.replace(href(`/game/${queue.gameId}`));
      } else {
        setActiveGame({
          gameId: queue.gameId,
          boardSize: queue.boardSize,
          timeControl: queue.timeControl,
        });
        setQueueStatus("idle");
      }
      return;
    }
    setActiveGame(null);
    setQueueStatus(queue.status === "waiting" ? "waiting" : "idle");
  }, [href, router]);

  const refreshQueue = useCallback(async (
    enterMatchedGame = false,
    signal?: AbortSignal,
  ) => {
    if (!playerKey) return;
    const response = await fetch("/api/matchmaking", { cache: "no-store", signal });
    const data = await readApi<{ matchmaking: QueueState }>(response);
    if (signal?.aborted) return;
    handleQueueState(data.matchmaking, enterMatchedGame);
  }, [handleQueueState, playerKey]);

  useEffect(() => {
    if (!playerKey) return;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      refreshQueue(false, controller.signal).catch(() => undefined);
    }, 0);
    return () => {
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [playerKey, refreshQueue]);

  useEffect(() => {
    if (queueStatus !== "waiting") return;
    let cancelled = false;
    let timer: number;
    const guard = createPollingRequestGuard();

    const poll = async () => {
      let requestError: unknown = null;
      const signal = guard.start();
      try {
        await refreshQueue(true, signal);
        if (guard.isCurrent(signal)) setError(null);
      } catch (error) {
        requestError = error;
        if (guard.isCurrent(signal)) {
          setError(localizedApiError(dictionary, error, copy.matchmakingFailed));
        }
      } finally {
        if (!cancelled && guard.isCurrent(signal)) {
          timer = window.setTimeout(
            poll,
            nextPollDelay(1_000, requestError, document.hidden),
          );
        }
      }
    };

    timer = window.setTimeout(poll, 1_000);
    return () => {
      cancelled = true;
      guard.cancel();
      window.clearTimeout(timer);
    };
  }, [copy.matchmakingFailed, dictionary, queueStatus, refreshQueue]);

  async function findMatch() {
    if (!playerKey) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/matchmaking", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ boardSize, timeControl }),
      });
      const data = await readApi<{ matchmaking: QueueState }>(response);
      handleQueueState(data.matchmaking, true);
    } catch (requestError) {
      setError(localizedApiError(dictionary, requestError, copy.joinFailed));
    } finally {
      setBusy(false);
    }
  }

  async function cancelSearch() {
    if (!playerKey) return;
    setBusy(true);
    try {
      await readApi(
        await fetch("/api/matchmaking", {
          method: "DELETE",
        }),
      );
      setQueueStatus("idle");
    } catch (requestError) {
      setError(localizedApiError(dictionary, requestError, copy.cancelFailed));
    } finally {
      setBusy(false);
    }
  }

  async function leaveActiveGame() {
    if (!playerKey || !activeGame || busy) return;
    setBusy(true);
    setError(null);
    try {
      await leaveGameAndQueue(activeGame.gameId);
      setActiveGame(null);
      setQueueStatus("idle");
      setConfirmLeave(false);
    } catch (requestError) {
      setError(localizedApiError(dictionary, requestError, copy.leaveFailed));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="match-lobby">
      <section className="match-lobby-copy">
        <span className="section-kicker"><Sparkles size={14} /> {copy.kicker}</span>
        <h1>{copy.title}</h1>
        <p>{copy.description}</p>
        <div className="lobby-trust">
          <span><ShieldCheck size={17} /> {copy.serverValidated}</span>
          <span>
            {loading
              ? copy.preparingPlayer
              : identityError
                ? copy.sessionUnavailable
                : `${copy.playingAs} ${playerName}`}
          </span>
        </div>
      </section>

      <section className="match-lobby-card">
        {activeGame ? (
          <ActiveGamePanel
            boardSize={activeGame.boardSize}
            timeControl={activeGame.timeControl}
            busy={busy}
            error={error}
            onLeave={() => setConfirmLeave(true)}
            onResume={() => router.push(href(`/game/${activeGame.gameId}`))}
          />
        ) : (
          <>
            <div className="lobby-options">
              <div>
                <span>{copy.boardSize}</span>
                <BoardSizeSelector
                  disabled={queueStatus === "waiting"}
                  onChange={setBoardSize}
                  value={boardSize}
                />
              </div>
              <div>
                <span>{copy.timeControl}</span>
                <TimeControlSelector
                  disabled={queueStatus === "waiting"}
                  onChange={setTimeControl}
                  value={timeControl}
                />
              </div>
            </div>
            <MatchmakingPanel
              boardSize={boardSize}
              busy={busy}
              error={error ?? identityError}
              onCancel={cancelSearch}
              onFind={findMatch}
              onRetry={retryIdentity}
              playerName={playerName}
              ready={Boolean(playerKey) && !loading}
              status={queueStatus}
              timeControl={timeControl}
            />
          </>
        )}
      </section>
      <ConfirmModal
        busy={busy}
        confirmLabel={copy.leaveGame}
        description={copy.leaveDescription}
        onCancel={() => setConfirmLeave(false)}
        onConfirm={leaveActiveGame}
        open={confirmLeave}
        title={copy.leaveTitle}
      />
    </div>
  );
}
