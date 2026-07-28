"use client";

import { LogOut, ShieldCheck, Wifi } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { usePlayerIdentity } from "@/components/auth/PlayerIdentityProvider";
import { LanguageSwitcher } from "@/components/i18n/LanguageSwitcher";
import { useI18n } from "@/components/i18n/I18nProvider";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { readApi } from "@/lib/client/api";
import { leaveGameAndQueue } from "@/lib/client/leaveGame";
import {
  createPollingRequestGuard,
  nextChatPollDelay,
  nextPollDelay,
  shouldPollGame,
} from "@/lib/client/polling";
import type { GameMessage } from "@/lib/game/chatService";
import { describeGameChange } from "@/lib/game/gameAccessibility";
import type { GameState, Stone } from "@/lib/game/types";
import { localizedApiError } from "@/lib/i18n/dictionary";
import { ChatPanel } from "./ChatPanel";
import { GamePanel } from "./GamePanel";
import { GameResultModal } from "./GameResultModal";
import { GoBoard } from "./GoBoard";

type Confirmation = "resign" | "leave" | null;

export function GameRoom({ gameId }: { gameId: string }) {
  const router = useRouter();
  const { dictionary, href } = useI18n();
  const copy = dictionary.game;
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
  const [gameAnnouncement, setGameAnnouncement] = useState("");
  const lastMessageId = useRef(0);
  const resultShownForGame = useRef<string | null>(null);
  const latestGameVersion = useRef(-1);
  const latestGameId = useRef<string | null>(null);
  const gameStatus = useRef<GameState["status"] | null>(null);
  const acceptedGame = useRef<GameState | null>(null);
  const boardStatus = useRef<HTMLDivElement>(null);

  const acceptGameState = useCallback((nextGame: GameState) => {
    if (nextGame.id !== gameId) return;
    if (latestGameId.current !== gameId) {
      latestGameId.current = gameId;
      latestGameVersion.current = -1;
    }
    if (nextGame.version < latestGameVersion.current) return;
    latestGameVersion.current = nextGame.version;
    gameStatus.current = nextGame.status;
    const announcement = describeGameChange(acceptedGame.current, nextGame, copy);
    acceptedGame.current = nextGame;
    if (announcement) setGameAnnouncement(announcement);
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
  }, [copy, gameId]);

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
    gameStatus.current = null;
    let cancelled = false;
    let gameLoaded = false;
    let gameTimer: number;
    let chatTimer: number;
    const gameGuard = createPollingRequestGuard();
    const chatGuard = createPollingRequestGuard();

    const pollGame = async () => {
      if (!shouldPollGame(gameStatus.current)) return;
      let requestError: unknown = null;
      const signal = gameGuard.start();
      try {
        await refreshGame(signal);
        if (!gameLoaded && gameGuard.isCurrent(signal)) setError(null);
        gameLoaded = true;
      } catch (error) {
        requestError = error;
        if (!gameLoaded && gameGuard.isCurrent(signal)) {
          setError(localizedApiError(dictionary, error, copy.loadFailed));
        }
      } finally {
        if (
          !cancelled
          && gameGuard.isCurrent(signal)
          && shouldPollGame(gameStatus.current)
        ) {
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
            nextChatPollDelay(gameStatus.current, requestError, document.hidden),
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
  }, [copy.loadFailed, dictionary, playerKey, refreshChat, refreshGame]);

  const yourColor: Stone | null =
    game && playerKey
      ? game.blackPlayerKey === playerKey ? "black" : "white"
      : null;
  const canMove =
    Boolean(
      game
      && yourColor
      && game.status === "active"
      && game.phase === "play"
      && game.turn === yourColor,
    ) && !busy;
  const canMarkDead = Boolean(
    game && game.status === "active" && game.phase === "scoring" && game.scoring,
  ) && !busy;

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
      setError(localizedApiError(dictionary, requestError, copy.moveFailed));
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
      setError(localizedApiError(dictionary, requestError, copy.resignFailed));
    } finally {
      setBusy(false);
    }
  }

  async function scoringAction(
    action: "dead-stones" | "confirm" | "resume",
    body: Record<string, unknown>,
  ) {
    if (!game || !game.scoring || !playerKey || busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/games/${game.id}/scoring/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...body,
          expectedRevision: game.scoring.revision,
        }),
      });
      const data = await readApi<{ game: GameState }>(response);
      acceptGameState(data.game);
    } catch (requestError) {
      setError(localizedApiError(dictionary, requestError, copy.scoringFailed));
      await refreshGame().catch(() => undefined);
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
        signal: AbortSignal.timeout(5_000),
      }).catch(() => undefined);
    }
    router.replace(href(destination));
  }

  async function leaveGameRoom() {
    if (!game || !playerKey || busy) return;
    if (game.status === "active" && confirmation !== "leave") {
      setError(null);
      setConfirmation("leave");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await leaveGameAndQueue(game.id);
      setConfirmation(null);
      router.replace(href("/"));
    } catch (requestError) {
      setError(localizedApiError(dictionary, requestError, copy.leaveFailed));
      setBusy(false);
    }
  }

  if (loading || (!playerKey && !identityError) || (!game && !error && !identityError)) {
    return <main className="game-loading"><span className="spin-ring" /><p>{copy.loading}</p></main>;
  }

  if (!playerKey || !game) {
    return (
      <main className="game-loading">
        <h1>{copy.unavailable}</h1>
        <p>{identityError ?? error ?? copy.unavailableDescription}</p>
        <button
          className="button button--primary"
          onClick={identityError ? retryIdentity : () => router.replace(href("/play"))}
          type="button"
        >
          {identityError ? copy.retrySession : copy.returnToPlay}
        </button>
      </main>
    );
  }

  return (
    <div className="focused-game-shell">
      <p aria-atomic="true" aria-live="polite" className="sr-only" role="status">
        {gameAnnouncement}
      </p>
      <header className="game-topbar">
        <span className="game-brand">
          <span className="brand-mark"><span /><span /></span>
          GoStone
        </span>
        <span className="game-security"><ShieldCheck size={15} /> {copy.serverVerified}</span>
        <span className="game-connection"><Wifi size={15} /> {copy.live}</span>
        <LanguageSwitcher compact />
        <button className="game-exit" disabled={busy} onClick={leaveGameRoom} type="button">
          <LogOut size={15} />
          {copy.leaveGame}
        </button>
      </header>

      <main className="focused-game-layout">
        <section className="focused-board-panel">
          <div className="focused-board-status" ref={boardStatus} tabIndex={-1}>
            <strong>
              {canMove
                ? copy.yourTurn
                : game.status === "finished"
                  ? `${copy.gameOver} · ${game.result}`
                  : game.phase === "scoring"
                    ? copy.confirmFinalPosition
                    : copy.opponentTurn}
            </strong>
            <span>{game.boardSize}×{game.boardSize} · {copy.move} {game.moveCount}</span>
          </div>
          <div className="focused-board-wrap">
            <GoBoard
              boardSize={game.boardSize}
              boardState={game.board}
              deadStones={game.scoring?.deadStones}
              disabled={!canMove && !canMarkDead}
              interactionMode={game.phase === "scoring" ? "mark-dead" : "play"}
              lastMove={(() => {
                const move = game.moves.at(-1);
                return move && !move.isPass && move.x !== null && move.y !== null
                  ? { x: move.x, y: move.y }
                  : null;
              })()}
              onIntersectionClick={(x, y) => {
                if (game.phase === "scoring" && game.scoring) {
                  const dead = !game.scoring.deadStones.some(
                    (stone) => stone.x === x && stone.y === y,
                  );
                  void scoringAction("dead-stones", { x, y, dead });
                } else {
                  void makeMove({ x, y });
                }
              }}
            />
          </div>
          {game.phase === "scoring" || game.boardSize > 9 ? (
            <p className="scoring-board-hint">
              {game.phase === "scoring"
                ? copy.scoringBoardHint
                : copy.boardHint}
            </p>
          ) : null}
          {error ? <p className="play-error" role="alert">{error}</p> : null}
        </section>

        <aside className="focused-game-side">
          <GamePanel
            busy={busy}
            game={game}
            onLeave={() => clearFinishedGame("/play")}
            onPass={() => makeMove({ isPass: true })}
            onConfirmScore={() => scoringAction("confirm", {})}
            onResign={() => {
              setError(null);
              setConfirmation("resign");
            }}
            onResumePlay={(claim, disputedStone) => {
              void scoringAction("resume", {
                claim,
                x: disputedStone.x,
                y: disputedStone.y,
              });
            }}
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
        confirmLabel={confirmation === "resign" ? copy.resignGame : copy.leaveGame}
        description={
          confirmation === "resign"
            ? copy.resignDescription
            : copy.leaveDescription
        }
        error={error}
        onCancel={() => setConfirmation(null)}
        onConfirm={confirmation === "resign" ? resign : leaveGameRoom}
        open={confirmation !== null}
        title={confirmation === "resign" ? copy.resignTitle : copy.leaveTitle}
      />
      <GameResultModal
        finalFocusRef={boardStatus}
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
