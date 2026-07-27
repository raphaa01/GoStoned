"use client";

import { RotateCcw, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { getOrCreateGuestPlayerKey } from "@/lib/client/guestIdentity";
import { createEmptyBoard } from "@/lib/game/goEngine";
import type { BoardSize, GameState, Stone } from "@/lib/game/types";
import { BoardSizeSelector } from "./BoardSizeSelector";
import { GamePanel } from "./GamePanel";
import { GoBoard } from "./GoBoard";
import { MatchmakingPanel } from "./MatchmakingPanel";

type ApiResponse<T> = { ok: true } & T | { ok: false; error: string };
type QueueState = {
  status: "idle" | "waiting" | "matched";
  gameId: string | null;
  boardSize: BoardSize | null;
};

async function readApi<T>(response: Response): Promise<T> {
  const body = (await response.json()) as ApiResponse<T>;
  if (!response.ok || !body.ok) {
    throw new Error("error" in body ? body.error : "Request failed.");
  }
  return body;
}

export function PlayWorkspace({ initialSize = 9 }: { initialSize?: BoardSize }) {
  const [boardSize, setBoardSize] = useState<BoardSize>(initialSize);
  const [playerKey, setPlayerKey] = useState<string | null>(null);
  const [queueStatus, setQueueStatus] = useState<"idle" | "waiting">("idle");
  const [gameId, setGameId] = useState<string | null>(null);
  const [game, setGame] = useState<GameState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setPlayerKey(getOrCreateGuestPlayerKey());
    }, 0);
    return () => window.clearTimeout(timeout);
  }, []);

  const handleQueueState = useCallback((queue: QueueState) => {
    if (queue.boardSize) setBoardSize(queue.boardSize);
    if (queue.status === "matched" && queue.gameId) {
      setGameId(queue.gameId);
      setQueueStatus("idle");
    } else {
      setQueueStatus(queue.status === "waiting" ? "waiting" : "idle");
    }
  }, []);

  const refreshQueue = useCallback(async () => {
    if (!playerKey) return;
    const response = await fetch(
      `/api/matchmaking?playerKey=${encodeURIComponent(playerKey)}`,
      { cache: "no-store" },
    );
    const data = await readApi<{ matchmaking: QueueState }>(response);
    handleQueueState(data.matchmaking);
  }, [handleQueueState, playerKey]);

  const refreshGame = useCallback(async () => {
    if (!gameId || !playerKey) return;
    const response = await fetch(
      `/api/games/${gameId}?playerKey=${encodeURIComponent(playerKey)}`,
      { cache: "no-store" },
    );
    const data = await readApi<{ game: GameState }>(response);
    setGame(data.game);
    setBoardSize(data.game.boardSize);
  }, [gameId, playerKey]);

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

  useEffect(() => {
    if (!gameId) return;
    const initialTimeout = window.setTimeout(() => {
      refreshGame().catch((requestError: unknown) => {
        setError(requestError instanceof Error ? requestError.message : "Could not load the game.");
      });
    }, 0);
    const interval = window.setInterval(() => {
      refreshGame().catch(() => undefined);
    }, 900);
    return () => {
      window.clearTimeout(initialTimeout);
      window.clearInterval(interval);
    };
  }, [gameId, refreshGame]);

  const yourColor = useMemo<Stone | null>(() => {
    if (!game || !playerKey) return null;
    return game.blackPlayerKey === playerKey ? "black" : "white";
  }, [game, playerKey]);
  const canMove =
    Boolean(game && yourColor && game.status === "active" && game.turn === yourColor) && !busy;

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

  async function makeMove(move: { x?: number; y?: number; isPass?: boolean }) {
    if (!game || !playerKey || busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/games/${game.id}/moves`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playerKey, ...move }),
      });
      const data = await readApi<{ game: GameState }>(response);
      setGame(data.game);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Move failed.");
      await refreshGame().catch(() => undefined);
    } finally {
      setBusy(false);
    }
  }

  async function resign() {
    if (!game || !playerKey || busy) return;
    if (!window.confirm("Resign this game? Your opponent will win.")) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/games/${game.id}/resign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playerKey }),
      });
      const data = await readApi<{ game: GameState }>(response);
      setGame(data.game);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not resign.");
    } finally {
      setBusy(false);
    }
  }

  async function startAnotherGame() {
    if (playerKey) {
      await fetch(`/api/matchmaking?playerKey=${encodeURIComponent(playerKey)}`, {
        method: "DELETE",
      }).catch(() => undefined);
    }
    setGame(null);
    setGameId(null);
    setQueueStatus("idle");
    setError(null);
  }

  const board = game?.board ?? createEmptyBoard(boardSize);
  const activeSession = queueStatus === "waiting" || Boolean(gameId);

  return (
    <>
      <header className="play-header">
        <div>
          <span className="section-kicker">Online Go</span>
          <h1>{game ? "Live game" : "Play"}</h1>
          <p>
            {game
              ? "Your game is saved after every move."
              : "Choose a board size and find another player."}
          </p>
        </div>
        <BoardSizeSelector
          disabled={activeSession}
          onChange={setBoardSize}
          value={boardSize}
        />
      </header>

      <div className="play-layout">
        <section className="board-stage">
          <div className="board-stage-top">
            <div>
              <span className={game?.status === "active" ? "live-dot" : "status-dot"} />
              {game?.status === "active"
                ? canMove
                  ? "Your turn"
                  : "Opponent's turn"
                : game?.status === "finished"
                  ? `Game over · ${game.result}`
                  : "Waiting room"}
            </div>
            {game?.status === "finished" ? (
              <button onClick={startAnotherGame} type="button">
                <RotateCcw size={16} /> Play again
              </button>
            ) : (
              <span className="server-verified"><ShieldCheck size={15} /> Server verified</span>
            )}
          </div>
          <div className="board-wrap">
            <GoBoard
              boardSize={boardSize}
              boardState={board}
              disabled={!canMove}
              onIntersectionClick={(x, y) => makeMove({ x, y })}
            />
          </div>
        </section>
        <div className="play-side">
          {game && playerKey ? (
            <>
              <GamePanel
                busy={busy}
                game={game}
                onPass={() => makeMove({ isPass: true })}
                onResign={resign}
                playerKey={playerKey}
              />
              {error ? <p className="play-error">{error}</p> : null}
            </>
          ) : (
            <MatchmakingPanel
              boardSize={boardSize}
              busy={busy}
              error={error}
              onCancel={cancelSearch}
              onFind={findMatch}
              ready={Boolean(playerKey)}
              status={queueStatus}
            />
          )}
        </div>
      </div>
    </>
  );
}
