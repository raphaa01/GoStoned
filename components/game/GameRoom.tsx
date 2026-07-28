"use client";

import { LogOut, ShieldCheck, Wifi } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { usePlayerIdentity } from "@/components/auth/PlayerIdentityProvider";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { readApi } from "@/lib/client/api";
import { leaveGameAndQueue } from "@/lib/client/leaveGame";
import { createPollingRequestGuard, nextPollDelay } from "@/lib/client/polling";
import type { GameMessage } from "@/lib/game/chatService";
import type { GameState, Stone } from "@/lib/game/types";
import { ChatPanel } from "./ChatPanel";
import { GamePanel } from "./GamePanel";
import { GameResultModal } from "./GameResultModal";
import { GoBoard } from "./GoBoard";

type Confirmation = "resign" | "leave" | null;

export function GameRoom({ gameId }: { gameId: string }) {
  const router = useRouter();
  const {
    playerKey,
    loading,
    error: identityError,
    retry: retryIdentity,
  } = usePlayerIdentity();
  const [game, setGame] = useState<GameState | null>(null);
  const [messages, setMessages] = useState<GameMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation>(null);
  const [showResult, setShowResult] = useState(false);
  const lastMessageId = useRef(0);
  const resultShownForGame = useRef<string | null>(null);

  const acceptGameState = useCallback((nextGame: GameState) => {
    setGame({
      ...nextGame,
      clock: { ...nextGame.clock, clientReceivedAt: Date.now() },
    });
    if (
      nextGame.status === "finished" &&
      resultShownForGame.current !== nextGame.id
    ) {
      resultShownForGame.current = nextGame.id;
      setConfirmation(null);
      setShowResult(true);
    }
  }, []);

  const refreshGame = useCallback(async (signal?: AbortSignal) => {
    if (!playerKey) return;
    const response = await fetch(`/api/games/${gameId}`, { cache: "no-store", signal });
    const data = await readApi<{ game: GameState }>(response);
    if (signal?.aborted) return;
    acceptGameState(data.game);
  }, [acceptGameState, gameId, playerKey]);

  const refreshChat = useCallback(async (signal?: AbortSignal) => {
    if (!playerKey) return;
    const response = await fetch(
      `/api/games/${gameId}/chat?after=${lastMessageId.current}`,
      { cache: "no-store", signal },
    );
    const data = await readApi<{ messages: GameMessage[] }>(response);
    if (signal?.aborted) return;
    if (data.messages.length > 0) {
      lastMessageId.current = Number(data.messages[data.messages.length - 1].id);
      setMessages((current) => {
        const known = new Set(current.map((message) => message.id));
        return [...current, ...data.messages.filter((message) => !known.has(message.id))];
      });
    }
  }, [gameId, playerKey]);

  useEffect(() => {
    if (!playerKey) return;
    let cancelled = false;
    let gameLoaded = false;
    let gameTimer: number;
    let chatTimer: number;
    const gameGuard = createPollingRequestGuard();
    const chatGuard = createPollingRequestGuard();

    const pollGame = async () => {
      let requestError: unknown = null;
      const signal = gameGuard.start();
      try {
        await refreshGame(signal);
        if (!gameLoaded && gameGuard.isCurrent(signal)) setError(null);
        gameLoaded = true;
      } catch (error) {
        requestError = error;
        if (!gameLoaded && gameGuard.isCurrent(signal)) {
          setError(error instanceof Error ? error.message : "Could not load the game.");
        }
      } finally {
        if (!cancelled && gameGuard.isCurrent(signal)) {
          gameTimer = window.setTimeout(
            pollGame,
            nextPollDelay(900, requestError, document.hidden),
          );
        }
      }
    };

    const pollChat = async () => {
      let requestError: unknown = null;
      const signal = chatGuard.start();
      try {
        await refreshChat(signal);
      } catch (error) {
        requestError = error;
      } finally {
        if (!cancelled && chatGuard.isCurrent(signal)) {
          chatTimer = window.setTimeout(
            pollChat,
            nextPollDelay(800, requestError, document.hidden),
          );
        }
      }
    };

    gameTimer = window.setTimeout(pollGame, 0);
    chatTimer = window.setTimeout(pollChat, 0);
    return () => {
      cancelled = true;
      gameGuard.cancel();
      chatGuard.cancel();
      window.clearTimeout(gameTimer);
      window.clearTimeout(chatTimer);
    };
  }, [playerKey, refreshChat, refreshGame]);

  const yourColor: Stone | null =
    game && playerKey
      ? game.blackPlayerKey === playerKey ? "black" : "white"
      : null;
  const canMove =
    Boolean(game && yourColor && game.status === "active" && game.turn === yourColor) && !busy;

  async function makeMove(move: { x?: number; y?: number; isPass?: boolean }) {
    if (!game || !playerKey || busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/games/${game.id}/moves`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(move),
      });
      const data = await readApi<{ game: GameState }>(response);
      acceptGameState(data.game);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Move failed.");
      await refreshGame().catch(() => undefined);
    } finally {
      setBusy(false);
    }
  }

  async function resign() {
    if (!game || !playerKey || busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/games/${game.id}/resign`, {
        method: "POST",
      });
      const data = await readApi<{ game: GameState }>(response);
      setConfirmation(null);
      acceptGameState(data.game);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not resign.");
    } finally {
      setBusy(false);
    }
  }

  async function sendMessage(message: string) {
    if (!playerKey) return;
    const response = await fetch(`/api/games/${gameId}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
    });
    const data = await readApi<{ message: GameMessage }>(response);
    lastMessageId.current = Math.max(lastMessageId.current, Number(data.message.id));
    setMessages((current) => [...current, data.message]);
  }

  async function clearFinishedGame(destination: "/" | "/play") {
    if (playerKey) {
      await fetch("/api/matchmaking", {
        method: "DELETE",
      }).catch(() => undefined);
    }
    router.replace(destination);
  }

  async function leaveGameRoom() {
    if (!game || !playerKey || busy) return;
    if (game.status === "active" && confirmation !== "leave") {
      setConfirmation("leave");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await leaveGameAndQueue(game.id);
      setConfirmation(null);
      router.replace("/");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not leave the game.");
      setBusy(false);
    }
  }

  if (loading || (!playerKey && !identityError) || (!game && !error && !identityError)) {
    return <main className="game-loading"><span className="spin-ring" /><p>Loading game…</p></main>;
  }

  if (!playerKey || !game) {
    return (
      <main className="game-loading">
        <h1>Game unavailable</h1>
        <p>{identityError ?? error ?? "This game could not be loaded."}</p>
        <button
          className="button button--primary"
          onClick={identityError ? retryIdentity : () => router.replace("/play")}
          type="button"
        >
          {identityError ? "Retry player session" : "Return to play"}
        </button>
      </main>
    );
  }

  return (
    <div className="focused-game-shell">
      <header className="game-topbar">
        <span className="game-brand">
          <span className="brand-mark"><span /><span /></span>
          GoStone
        </span>
        <span className="game-security"><ShieldCheck size={15} /> Server verified</span>
        <span className="game-connection"><Wifi size={15} /> Live</span>
        <button className="game-exit" disabled={busy} onClick={leaveGameRoom} type="button">
          <LogOut size={15} />
          Leave game
        </button>
      </header>

      <main className="focused-game-layout">
        <section className="focused-board-panel">
          <div className="focused-board-status">
            <strong>{canMove ? "Your turn" : game.status === "finished" ? `Game over · ${game.result}` : "Opponent's turn"}</strong>
            <span>{game.boardSize}×{game.boardSize} · Move {game.moveCount}</span>
          </div>
          <div className="focused-board-wrap">
            <GoBoard
              boardSize={game.boardSize}
              boardState={game.board}
              disabled={!canMove}
              onIntersectionClick={(x, y) => makeMove({ x, y })}
            />
          </div>
          {error ? <p className="play-error" role="alert">{error}</p> : null}
        </section>

        <aside className="focused-game-side">
          <GamePanel
            busy={busy}
            game={game}
            onLeave={() => clearFinishedGame("/play")}
            onPass={() => makeMove({ isPass: true })}
            onResign={() => setConfirmation("resign")}
            playerKey={playerKey}
          />
          <ChatPanel
            disabled={false}
            messages={messages}
            onSend={sendMessage}
            playerKey={playerKey}
          />
        </aside>
      </main>
      <ConfirmModal
        busy={busy}
        confirmLabel={confirmation === "resign" ? "Resign game" : "Leave game"}
        description={
          confirmation === "resign"
            ? "Your opponent will win and this result will be saved."
            : "Leaving now counts as a resignation. Your opponent will win."
        }
        onCancel={() => setConfirmation(null)}
        onConfirm={confirmation === "resign" ? resign : leaveGameRoom}
        open={confirmation !== null}
        title={confirmation === "resign" ? "Resign this game?" : "Leave this game?"}
      />
      <GameResultModal
        game={game}
        onHome={() => clearFinishedGame("/")}
        onPlayAgain={() => clearFinishedGame("/play")}
        onViewBoard={() => setShowResult(false)}
        open={showResult}
        playerKey={playerKey}
      />
    </div>
  );
}
