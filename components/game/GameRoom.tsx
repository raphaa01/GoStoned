"use client";

import { LogOut, ShieldCheck, Wifi } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { usePlayerIdentity } from "@/components/auth/PlayerIdentityProvider";
import { readApi } from "@/lib/client/api";
import { leaveGameAndQueue } from "@/lib/client/leaveGame";
import type { GameMessage } from "@/lib/game/chatService";
import type { GameState, Stone } from "@/lib/game/types";
import { ChatPanel } from "./ChatPanel";
import { GamePanel } from "./GamePanel";
import { GoBoard } from "./GoBoard";

export function GameRoom({ gameId }: { gameId: string }) {
  const router = useRouter();
  const { playerKey, loading } = usePlayerIdentity();
  const [game, setGame] = useState<GameState | null>(null);
  const [messages, setMessages] = useState<GameMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastMessageId = useRef(0);

  const refreshGame = useCallback(async () => {
    if (!playerKey) return;
    const response = await fetch(
      `/api/games/${gameId}?playerKey=${encodeURIComponent(playerKey)}`,
      { cache: "no-store" },
    );
    const data = await readApi<{ game: GameState }>(response);
    setGame(data.game);
  }, [gameId, playerKey]);

  const refreshChat = useCallback(async () => {
    if (!playerKey) return;
    const response = await fetch(
      `/api/games/${gameId}/chat?playerKey=${encodeURIComponent(playerKey)}&after=${lastMessageId.current}`,
      { cache: "no-store" },
    );
    const data = await readApi<{ messages: GameMessage[] }>(response);
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
    const initial = window.setTimeout(() => {
      Promise.all([refreshGame(), refreshChat()]).catch((requestError: unknown) => {
        setError(requestError instanceof Error ? requestError.message : "Could not load the game.");
      });
    }, 0);
    const gameInterval = window.setInterval(() => refreshGame().catch(() => undefined), 900);
    const chatInterval = window.setInterval(() => refreshChat().catch(() => undefined), 800);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(gameInterval);
      window.clearInterval(chatInterval);
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

  async function sendMessage(message: string) {
    if (!playerKey) return;
    const response = await fetch(`/api/games/${gameId}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playerKey, message }),
    });
    const data = await readApi<{ message: GameMessage }>(response);
    lastMessageId.current = Math.max(lastMessageId.current, Number(data.message.id));
    setMessages((current) => [...current, data.message]);
  }

  async function leaveFinishedGame() {
    if (playerKey) {
      await fetch(`/api/matchmaking?playerKey=${encodeURIComponent(playerKey)}`, {
        method: "DELETE",
      }).catch(() => undefined);
    }
    router.replace("/play");
  }

  async function leaveGameRoom() {
    if (!game || !playerKey || busy) return;
    if (
      game.status === "active" &&
      !window.confirm("Leave this game? This counts as a resignation.")
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await leaveGameAndQueue(game.id, playerKey);
      router.replace("/");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not leave the game.");
      setBusy(false);
    }
  }

  if (loading || !playerKey || (!game && !error)) {
    return <main className="game-loading"><span className="spin-ring" /><p>Loading game…</p></main>;
  }

  if (!game) {
    return (
      <main className="game-loading">
        <h1>Game unavailable</h1>
        <p>{error ?? "This game could not be loaded."}</p>
        <button className="button button--primary" onClick={() => router.replace("/play")} type="button">
          Return to play
        </button>
      </main>
    );
  }

  return (
    <div className="focused-game-shell">
      <header className="game-topbar">
        <span className="game-brand">
          <span className="brand-mark"><span /><span /></span>
          GoStoned
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
            onLeave={leaveFinishedGame}
            onPass={() => makeMove({ isPass: true })}
            onResign={resign}
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
    </div>
  );
}
