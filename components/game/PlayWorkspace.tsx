"use client";

import { ShieldCheck, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { usePlayerIdentity } from "@/components/auth/PlayerIdentityProvider";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { readApi } from "@/lib/client/api";
import { leaveGameAndQueue } from "@/lib/client/leaveGame";
import type { BoardSize, TimeControlId } from "@/lib/game/types";
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
  const { playerKey, playerName, loading } = usePlayerIdentity();
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
        router.replace(`/game/${queue.gameId}`);
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
  }, [router]);

  const refreshQueue = useCallback(async (enterMatchedGame = false) => {
    if (!playerKey) return;
    const response = await fetch(
      `/api/matchmaking?playerKey=${encodeURIComponent(playerKey)}`,
      { cache: "no-store" },
    );
    const data = await readApi<{ matchmaking: QueueState }>(response);
    handleQueueState(data.matchmaking, enterMatchedGame);
  }, [handleQueueState, playerKey]);

  useEffect(() => {
    if (!playerKey) return;
    const timeout = window.setTimeout(() => {
      refreshQueue(false).catch(() => undefined);
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [playerKey, refreshQueue]);

  useEffect(() => {
    if (queueStatus !== "waiting") return;
    const interval = window.setInterval(() => {
      refreshQueue(true).catch((requestError: unknown) => {
        setError(requestError instanceof Error ? requestError.message : "Matchmaking failed.");
      });
    }, 1_000);
    return () => window.clearInterval(interval);
  }, [queueStatus, refreshQueue]);

  async function findMatch() {
    if (!playerKey) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/matchmaking", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playerKey, boardSize, timeControl }),
      });
      const data = await readApi<{ matchmaking: QueueState }>(response);
      handleQueueState(data.matchmaking, true);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not join the queue.");
    } finally {
      setBusy(false);
    }
  }

  async function cancelSearch() {
    if (!playerKey) return;
    setBusy(true);
    try {
      await readApi(
        await fetch(`/api/matchmaking?playerKey=${encodeURIComponent(playerKey)}`, {
          method: "DELETE",
        }),
      );
      setQueueStatus("idle");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not cancel.");
    } finally {
      setBusy(false);
    }
  }

  async function leaveActiveGame() {
    if (!playerKey || !activeGame || busy) return;
    setBusy(true);
    setError(null);
    try {
      await leaveGameAndQueue(activeGame.gameId, playerKey);
      setActiveGame(null);
      setQueueStatus("idle");
      setConfirmLeave(false);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not leave the game.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="match-lobby">
      <section className="match-lobby-copy">
        <span className="section-kicker"><Sparkles size={14} /> Live matchmaking</span>
        <h1>Choose your board.</h1>
        <p>
          You enter a distraction-free game room as soon as another player joins.
          Every move and message is saved on the server.
        </p>
        <div className="lobby-trust">
          <span><ShieldCheck size={17} /> Server-validated rules</span>
          <span>{loading ? "Preparing your player…" : `Playing as ${playerName}`}</span>
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
            onResume={() => router.push(`/game/${activeGame.gameId}`)}
          />
        ) : (
          <>
            <div className="lobby-options">
              <div>
                <span>Board size</span>
                <BoardSizeSelector
                  disabled={queueStatus === "waiting"}
                  onChange={setBoardSize}
                  value={boardSize}
                />
              </div>
              <div>
                <span>Time control</span>
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
              error={error}
              onCancel={cancelSearch}
              onFind={findMatch}
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
        confirmLabel="Leave game"
        description="Your opponent will win and the result will be saved as a resignation."
        onCancel={() => setConfirmLeave(false)}
        onConfirm={leaveActiveGame}
        open={confirmLeave}
        title="Leave this game?"
      />
    </div>
  );
}
