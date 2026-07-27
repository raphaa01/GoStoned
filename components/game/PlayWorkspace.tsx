"use client";

import { ShieldCheck, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { usePlayerIdentity } from "@/components/auth/PlayerIdentityProvider";
import { readApi } from "@/lib/client/api";
import type { BoardSize } from "@/lib/game/types";
import { BoardSizeSelector } from "./BoardSizeSelector";
import { MatchmakingPanel } from "./MatchmakingPanel";

type QueueState = {
  status: "idle" | "waiting" | "matched";
  gameId: string | null;
  boardSize: BoardSize | null;
};

export function PlayWorkspace({ initialSize = 9 }: { initialSize?: BoardSize }) {
  const router = useRouter();
  const { playerKey, playerName, loading } = usePlayerIdentity();
  const [boardSize, setBoardSize] = useState<BoardSize>(initialSize);
  const [queueStatus, setQueueStatus] = useState<"idle" | "waiting">("idle");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleQueueState = useCallback((queue: QueueState) => {
    if (queue.boardSize) setBoardSize(queue.boardSize);
    if (queue.status === "matched" && queue.gameId) {
      router.replace(`/game/${queue.gameId}`);
      return;
    }
    setQueueStatus(queue.status === "waiting" ? "waiting" : "idle");
  }, [router]);

  const refreshQueue = useCallback(async () => {
    if (!playerKey) return;
    const response = await fetch(
      `/api/matchmaking?playerKey=${encodeURIComponent(playerKey)}`,
      { cache: "no-store" },
    );
    const data = await readApi<{ matchmaking: QueueState }>(response);
    handleQueueState(data.matchmaking);
  }, [handleQueueState, playerKey]);

  useEffect(() => {
    if (!playerKey) return;
    const timeout = window.setTimeout(() => {
      refreshQueue().catch(() => undefined);
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [playerKey, refreshQueue]);

  useEffect(() => {
    if (queueStatus !== "waiting") return;
    const interval = window.setInterval(() => {
      refreshQueue().catch((requestError: unknown) => {
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
        body: JSON.stringify({ playerKey, boardSize }),
      });
      const data = await readApi<{ matchmaking: QueueState }>(response);
      handleQueueState(data.matchmaking);
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
        <div>
          <span>Board size</span>
          <BoardSizeSelector
            disabled={queueStatus === "waiting"}
            onChange={setBoardSize}
            value={boardSize}
          />
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
        />
      </section>
    </div>
  );
}
