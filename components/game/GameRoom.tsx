"use client";

import { LogIn, LogOut, RefreshCw, ShieldCheck, Wifi, WifiOff } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { usePlayerIdentity } from "@/components/auth/PlayerIdentityProvider";
import { LanguageSwitcher } from "@/components/i18n/LanguageSwitcher";
import { useI18n } from "@/components/i18n/I18nProvider";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { ApiRequestError, readApi } from "@/lib/client/api";
import {
  connectionAfterFailure,
  connectionAfterSuccess,
  connectionAllowsChat,
  connectionAllowsGamePolling,
  connectionAllowsMutations,
  connectionAwaitingRefresh,
  connectionClockObservedAt,
  type GameConnectionState,
  INITIAL_GAME_CONNECTION,
  isTerminalConnection,
  operationAffectsConnection,
} from "@/lib/client/gameConnection";
import {
  assertResponseActor,
  createIdentityRequestAuthority,
  type IdentityRequestToken,
} from "@/lib/client/identityAuthority";
import { leaveGameAndQueue } from "@/lib/client/leaveGame";
import { latestGameMessageId, mergeGameMessages } from "@/lib/client/messages";
import { createOperationLatch } from "@/lib/client/operationLatch";
import {
  deriveGameOpponent,
  parseGameChatSnapshot,
  parsePlayerBlockState,
  parseSentGameMessage,
  type GameChatSnapshot,
} from "@/lib/client/playerBlocking";
import { EXPECTED_PLAYER_HEADER } from "@/lib/auth/playerBinding";
import {
  createPollingRequestGuard,
  nextChatPollDelay,
  nextPollDelay,
} from "@/lib/client/polling";
import type { GameMessage } from "@/lib/game/chatService";
import { describeGameChange } from "@/lib/game/gameAccessibility";
import { gamePollUrl, gameStateFromPoll } from "@/lib/game/gamePolling";
import type { GamePollResponse, GameState, Stone } from "@/lib/game/types";
import { localizedApiError } from "@/lib/i18n/dictionary";
import { ChatPanel } from "./ChatPanel";
import { GamePanel } from "./GamePanel";
import { GameResultModal } from "./GameResultModal";
import { GoBoard } from "./GoBoard";

type Confirmation = "resign" | "leave" | "block" | null;
const BLOCKED_CHAT_RECHECK_MS = 15_000;

export function GameRoom({ gameId }: { gameId: string }) {
  const router = useRouter();
  const { dictionary, href } = useI18n();
  const copy = dictionary.game;
  const {
    playerKey,
    identityKind,
    loading,
    error: identityError,
    refreshIdentity,
    retry: retryIdentity,
  } = usePlayerIdentity();
  const [game, setGame] = useState<GameState | null>(null);
  const [messages, setMessages] = useState<GameMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation>(null);
  const [showResult, setShowResult] = useState(false);
  const [identityChanged, setIdentityChanged] = useState(false);
  const [gameAnnouncement, setGameAnnouncement] = useState("");
  const [connectionAnnouncement, setConnectionAnnouncement] = useState("");
  const [connectionState, setConnectionState] = useState<GameConnectionState>(
    INITIAL_GAME_CONNECTION,
  );
  const [chatAvailable, setChatAvailable] = useState(false);
  const [chatPolicyUnavailable, setChatPolicyUnavailable] = useState(false);
  const [blockedByYou, setBlockedByYou] = useState<boolean | null>(null);
  const [blockBusy, setBlockBusy] = useState(false);
  const [blockReconciling, setBlockReconciling] = useState(false);
  const [blockError, setBlockError] = useState<string | null>(null);
  const [blockAnnouncement, setBlockAnnouncement] = useState("");
  const [blockReadNonce, setBlockReadNonce] = useState(0);
  const [moveOperationLatch] = useState(createOperationLatch);
  const lastMessageId = useRef(0);
  const chatTerminal = useRef(false);
  const chatPolicyUnavailableRef = useRef(false);
  const chatAccessGeneration = useRef(0);
  const resultShownForGame = useRef<string | null>(null);
  const latestGameVersion = useRef(-1);
  const lastFullGameResponseAt = useRef(0);
  const gameStatus = useRef<GameState["status"] | null>(null);
  const acceptedGame = useRef<GameState | null>(null);
  const connectionStateRef = useRef<GameConnectionState>(INITIAL_GAME_CONNECTION);
  const identityKey = `${identityKind ?? "none"}:${playerKey ?? "none"}:${gameId}`;
  const identityAuthority = useRef(createIdentityRequestAuthority(identityKey));
  const immediateGameSync = useRef<((markReconnecting?: boolean) => void) | null>(null);
  const immediateChatSync = useRef<(() => void) | null>(null);
  const blockReconciliationPending = useRef(false);
  const blockReadGeneration = useRef(0);
  const boardStatus = useRef<HTMLDivElement>(null);
  const recoveryAction = useRef<HTMLButtonElement>(null);
  const blockActionRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (identityChanged) recoveryAction.current?.focus();
  }, [identityChanged]);

  const connectionAnnouncementText = useCallback((state: GameConnectionState) => {
    if (state.kind === "live") return copy.live;
    if (state.kind === "final") return copy.resultVerified;
    if (state.kind === "session_expired") return copy.sessionExpired;
    if (state.kind === "unavailable") return copy.unavailable;
    if (state.kind === "reconnecting") {
      return state.reason === "rate_limited" ? copy.syncDelayed : copy.reconnecting;
    }
    return copy.connecting;
  }, [copy]);

  const transitionConnection = useCallback((
    next: GameConnectionState,
    announce = true,
  ) => {
    const previous = connectionStateRef.current;
    const presentationChanged = previous.kind !== next.kind
      || (previous.kind === "reconnecting"
        && next.kind === "reconnecting"
        && previous.reason !== next.reason);
    connectionStateRef.current = next;
    setConnectionState(next);
    if (next.kind === "session_expired" || next.kind === "unavailable") {
      setConfirmation(null);
      setShowResult(false);
      setBusy(false);
    }
    if (presentationChanged) {
      setConnectionAnnouncement(announce ? connectionAnnouncementText(next) : "");
    }
  }, [connectionAnnouncementText]);

  const clearGameBoundState = useCallback(() => {
    moveOperationLatch.invalidate();
    acceptedGame.current = null;
    gameStatus.current = null;
    latestGameVersion.current = -1;
    lastFullGameResponseAt.current = 0;
    lastMessageId.current = 0;
    chatTerminal.current = false;
    chatPolicyUnavailableRef.current = false;
    chatAccessGeneration.current += 1;
    blockReconciliationPending.current = false;
    blockReadGeneration.current += 1;
    resultShownForGame.current = null;
    setGame(null);
    setMessages([]);
    setChatAvailable(false);
    setChatPolicyUnavailable(false);
    setBlockedByYou(null);
    setBlockBusy(false);
    setBlockReconciling(false);
    setBlockError(null);
    setBlockAnnouncement("");
    setConfirmation(null);
    setShowResult(false);
    setGameAnnouncement("");
  }, [moveOperationLatch]);

  const recoverChangedIdentity = useCallback(() => {
    identityAuthority.current.invalidate();
    clearGameBoundState();
    transitionConnection({ kind: "unavailable" });
    setIdentityChanged(true);
    setError(localizedApiError(
      dictionary,
      new ApiRequestError("The player session changed.", {
        status: 409,
        code: "identity_changed",
      }),
      copy.unavailable,
    ));
  }, [clearGameBoundState, copy.unavailable, dictionary, transitionConnection]);

  useLayoutEffect(() => {
    if (!identityAuthority.current.updateIdentity(identityKey)) return;
    clearGameBoundState();
    connectionStateRef.current = INITIAL_GAME_CONNECTION;
    setConnectionState(INITIAL_GAME_CONNECTION);
    setConnectionAnnouncement("");
    setError(null);
    setIdentityChanged(false);
    setBusy(false);
  }, [clearGameBoundState, identityKey]);

  const applyConnectionFailure = useCallback((
    requestError: unknown,
    retryDelayMs: number,
  ) => {
    const previous = connectionStateRef.current;
    const next = connectionAfterFailure(
      previous,
      requestError,
      Date.now(),
      retryDelayMs,
    );
    if (
      previous.kind !== next.kind
      && (next.kind === "session_expired" || next.kind === "unavailable")
    ) {
      identityAuthority.current.invalidate();
    }
    transitionConnection(next);
    if (next.kind === "unavailable") clearGameBoundState();
    return next;
  }, [clearGameBoundState, transitionConnection]);

  const acceptGameResponse = useCallback((
    response: GamePollResponse,
    receivedAt: number,
    requestIdentity: IdentityRequestToken,
  ): boolean => {
    if (
      !identityAuthority.current.isCurrent(requestIdentity)
      || !playerKey
      || isTerminalConnection(connectionStateRef.current)
    ) {
      return false;
    }
    const nextGame = gameStateFromPoll(acceptedGame.current, response, receivedAt);
    if (!nextGame) return false;
    if (!deriveGameOpponent(nextGame, playerKey)) {
      identityAuthority.current.invalidate();
      transitionConnection({ kind: "unavailable" });
      clearGameBoundState();
      return false;
    }
    latestGameVersion.current = nextGame.version;
    gameStatus.current = nextGame.status;
    const announcement = describeGameChange(acceptedGame.current, nextGame, copy);
    acceptedGame.current = nextGame;
    if (announcement) setGameAnnouncement(announcement);
    setGame(nextGame);
    transitionConnection(
      connectionAfterSuccess(receivedAt, nextGame.status),
      !announcement,
    );
    if (
      nextGame.status === "finished" &&
      resultShownForGame.current !== nextGame.id
    ) {
      resultShownForGame.current = nextGame.id;
      setConfirmation(null);
      setShowResult(true);
    }
    return true;
  }, [clearGameBoundState, copy, playerKey, transitionConnection]);

  const refreshGame = useCallback(async (
    signal: AbortSignal,
    requestIdentity: IdentityRequestToken,
    expectedPlayerKey: string,
  ): Promise<boolean> => {
    const requestStartedAt = Date.now();
    const hasCurrentGameCache = acceptedGame.current?.id === gameId;
    const response = await fetch(
      gamePollUrl(
        gameId,
        hasCurrentGameCache ? latestGameVersion.current : -1,
        hasCurrentGameCache ? lastFullGameResponseAt.current : 0,
        requestStartedAt,
      ),
      {
        cache: "no-store",
        headers: { [EXPECTED_PLAYER_HEADER]: expectedPlayerKey },
        signal,
      },
    );
    const data = await readApi<GamePollResponse>(response);
    const receivedAt = Date.now();
    if (signal.aborted || !identityAuthority.current.isCurrent(requestIdentity)) return false;
    const accepted = acceptGameResponse(data, receivedAt, requestIdentity);
    if (accepted && "game" in data) lastFullGameResponseAt.current = receivedAt;
    return accepted;
  }, [acceptGameResponse, gameId]);

  const refreshChat = useCallback(async (
    signal: AbortSignal,
    requestIdentity: IdentityRequestToken,
    accessGeneration: number,
  ): Promise<GameChatSnapshot | null> => {
    if (!playerKey) return null;
    const response = await fetch(
      `/api/games/${gameId}/chat?after=${lastMessageId.current}`,
      {
        cache: "no-store",
        headers: { [EXPECTED_PLAYER_HEADER]: playerKey },
        signal,
      },
    );
    const data = await readApi<unknown>(response);
    if (
      signal.aborted
      || !identityAuthority.current.isCurrent(requestIdentity)
      || chatAccessGeneration.current !== accessGeneration
    ) {
      return null;
    }
    return parseGameChatSnapshot(data);
  }, [gameId, playerKey]);

  const applyChatMessages = useCallback((
    incoming: readonly GameMessage[],
    requestIdentity: IdentityRequestToken,
    accessGeneration: number,
  ) => {
    if (
      !identityAuthority.current.isCurrent(requestIdentity)
      || chatAccessGeneration.current !== accessGeneration
      || isTerminalConnection(connectionStateRef.current)
      || chatTerminal.current
    ) {
      return false;
    }
    lastMessageId.current = Math.max(
      lastMessageId.current,
      latestGameMessageId(incoming),
    );
    if (incoming.length > 0) {
      setMessages((current) => mergeGameMessages(current, incoming));
    }
    return true;
  }, []);

  const closeChatForPolicy = useCallback(() => {
    chatAccessGeneration.current += 1;
    chatPolicyUnavailableRef.current = true;
    lastMessageId.current = 0;
    setMessages([]);
    setChatAvailable(false);
    setChatPolicyUnavailable(true);
  }, []);

  useEffect(() => {
    if (!playerKey) return;
    const expectedPlayerKey = playerKey;
    const requestIdentity = identityAuthority.current.capture();
    let cancelled = false;
    let gameLoaded = acceptedGame.current !== null;
    let gameTimer: number | undefined;
    let chatTimer: number | undefined;
    const gameGuard = createPollingRequestGuard();
    const chatGuard = createPollingRequestGuard();

    const pollGame = async () => {
      if (
        !identityAuthority.current.isCurrent(requestIdentity)
        || !connectionAllowsGamePolling(connectionStateRef.current, gameStatus.current)
      ) {
        return;
      }
      let requestError: unknown = null;
      const guardSignal = gameGuard.start();
      const signal = AbortSignal.any([guardSignal, AbortSignal.timeout(10_000)]);
      try {
        const accepted = await refreshGame(signal, requestIdentity, expectedPlayerKey);
        if (accepted && gameGuard.isCurrent(guardSignal)) {
          gameLoaded = true;
          setError(null);
        }
      } catch (caughtError) {
        requestError = caughtError;
        if (
          gameGuard.isCurrent(guardSignal)
          && identityAuthority.current.isCurrent(requestIdentity)
        ) {
          if (
            caughtError instanceof ApiRequestError
            && caughtError.code === "identity_changed"
          ) {
            recoverChangedIdentity();
            return;
          }
          const delay = nextPollDelay(900, requestError, document.hidden);
          const next = applyConnectionFailure(requestError, delay);
          if (!gameLoaded && isTerminalConnection(next)) {
            setError(localizedApiError(dictionary, requestError, copy.loadFailed));
          }
        }
      } finally {
        if (
          !cancelled
          && gameGuard.isCurrent(guardSignal)
          && identityAuthority.current.isCurrent(requestIdentity)
          && connectionAllowsGamePolling(connectionStateRef.current, gameStatus.current)
        ) {
          gameTimer = window.setTimeout(
            pollGame,
            nextPollDelay(900, requestError, document.hidden),
          );
        }
      }
    };

    const pollChat = async () => {
      if (
        !identityAuthority.current.isCurrent(requestIdentity)
        || isTerminalConnection(connectionStateRef.current)
        || chatTerminal.current
      ) {
        return;
      }
      let requestError: unknown = null;
      const accessGeneration = chatAccessGeneration.current;
      const guardSignal = chatGuard.start();
      const signal = AbortSignal.any([guardSignal, AbortSignal.timeout(10_000)]);
      try {
        const snapshot = await refreshChat(
          signal,
          requestIdentity,
          accessGeneration,
        );
        if (
          snapshot
          && chatGuard.isCurrent(guardSignal)
          && chatAccessGeneration.current === accessGeneration
        ) {
          if (!snapshot.available) {
            closeChatForPolicy();
          } else if (
            applyChatMessages(
              snapshot.messages,
              requestIdentity,
              accessGeneration,
            )
          ) {
            chatPolicyUnavailableRef.current = false;
            setChatPolicyUnavailable(false);
            setChatAvailable(true);
          }
        }
      } catch (caughtError) {
        requestError = caughtError;
        if (
          chatGuard.isCurrent(guardSignal)
          && identityAuthority.current.isCurrent(requestIdentity)
          && chatAccessGeneration.current === accessGeneration
        ) {
          setChatAvailable(false);
          if (
            caughtError instanceof ApiRequestError
            && [401, 403, 404].includes(caughtError.status)
          ) {
            chatTerminal.current = true;
            applyConnectionFailure(
              caughtError,
              nextChatPollDelay(gameStatus.current, caughtError, document.hidden),
            );
          }
        }
      } finally {
        if (
          !cancelled
          && chatGuard.isCurrent(guardSignal)
          && identityAuthority.current.isCurrent(requestIdentity)
          && !isTerminalConnection(connectionStateRef.current)
          && !chatTerminal.current
        ) {
          chatTimer = window.setTimeout(
            pollChat,
            chatPolicyUnavailableRef.current
              ? BLOCKED_CHAT_RECHECK_MS
              : nextChatPollDelay(gameStatus.current, requestError, document.hidden),
          );
        }
      }
    };

    const requestImmediateChatSync = () => {
      if (
        !identityAuthority.current.isCurrent(requestIdentity)
        || isTerminalConnection(connectionStateRef.current)
      ) {
        return;
      }
      chatTerminal.current = false;
      if (chatTimer !== undefined) window.clearTimeout(chatTimer);
      chatGuard.cancel();
      void pollChat();
    };
    immediateChatSync.current = requestImmediateChatSync;

    const requestImmediateSync = (markReconnecting = true) => {
      if (
        !identityAuthority.current.isCurrent(requestIdentity)
        || !connectionAllowsGamePolling(connectionStateRef.current, gameStatus.current)
      ) {
        return;
      }
      if (markReconnecting && acceptedGame.current) {
        transitionConnection(connectionAwaitingRefresh(
          connectionStateRef.current,
          "network",
          Date.now(),
        ));
      }
      if (gameTimer !== undefined) window.clearTimeout(gameTimer);
      void pollGame();
    };
    immediateGameSync.current = requestImmediateSync;

    const handleVisibilityChange = () => {
      if (!document.hidden) requestImmediateSync(true);
    };
    const handleOnline = () => requestImmediateSync(true);
    const handleOffline = () => {
      if (
        !identityAuthority.current.isCurrent(requestIdentity)
        || !acceptedGame.current
      ) {
        return;
      }
      setChatAvailable(false);
      transitionConnection(connectionAwaitingRefresh(
        connectionStateRef.current,
        "offline",
        Date.now(),
      ));
    };

    gameTimer = window.setTimeout(pollGame, 0);
    chatTimer = window.setTimeout(pollChat, 0);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      cancelled = true;
      if (immediateGameSync.current === requestImmediateSync) {
        immediateGameSync.current = null;
      }
      if (immediateChatSync.current === requestImmediateChatSync) {
        immediateChatSync.current = null;
      }
      gameGuard.cancel();
      chatGuard.cancel();
      if (gameTimer !== undefined) window.clearTimeout(gameTimer);
      if (chatTimer !== undefined) window.clearTimeout(chatTimer);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [
    applyChatMessages,
    applyConnectionFailure,
    closeChatForPolicy,
    copy.loadFailed,
    dictionary,
    identityKey,
    playerKey,
    recoverChangedIdentity,
    refreshChat,
    refreshGame,
    transitionConnection,
  ]);

  useEffect(() => {
    if (!playerKey) return;
    const requestIdentity = identityAuthority.current.capture();
    const readGeneration = blockReadGeneration.current + 1;
    blockReadGeneration.current = readGeneration;
    const controller = new AbortController();

    void (async () => {
      try {
        const response = await fetch(`/api/games/${gameId}/block`, {
          cache: "no-store",
          headers: { [EXPECTED_PLAYER_HEADER]: playerKey },
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(10_000),
          ]),
        });
        const data = await readApi<unknown>(response);
        if (
          controller.signal.aborted
          || !identityAuthority.current.isCurrent(requestIdentity)
          || blockReadGeneration.current !== readGeneration
        ) {
          return;
        }
        const state = parsePlayerBlockState(data, playerKey);
        const reconciledMutation = blockReconciliationPending.current;
        blockReconciliationPending.current = false;
        setBlockedByYou(state);
        setBlockReconciling(false);
        setBlockError(null);
        if (reconciledMutation) {
          setBlockAnnouncement(
            state
              ? copy.blockStateRefreshedBlocked
              : copy.blockStateRefreshedUnblocked,
          );
        }
      } catch (requestError) {
        if (
          controller.signal.aborted
          || !identityAuthority.current.isCurrent(requestIdentity)
          || blockReadGeneration.current !== readGeneration
        ) {
          return;
        }
        setBlockedByYou(null);
        setBlockReconciling(false);
        setBlockError(localizedApiError(
          dictionary,
          requestError,
          copy.blockStateFailed,
        ));
      }
    })();

    return () => controller.abort();
  }, [
    blockReadNonce,
    copy.blockStateFailed,
    copy.blockStateRefreshedBlocked,
    copy.blockStateRefreshedUnblocked,
    dictionary,
    gameId,
    identityKey,
    playerKey,
  ]);

  const yourColor: Stone | null =
    game && playerKey
      ? game.blackPlayerKey === playerKey
        ? "black"
        : game.whitePlayerKey === playerKey
          ? "white"
          : null
      : null;
  const opponent = game && playerKey
    ? deriveGameOpponent(game, playerKey)
    : null;
  const gameInteractionAllowed = connectionAllowsMutations(connectionState)
    && Boolean(yourColor);
  const canMove =
    Boolean(
      game
      && yourColor
      && game.status === "active"
      && game.phase === "play"
      && game.turn === yourColor,
    ) && gameInteractionAllowed && !busy;
  const canMarkDead = Boolean(
    game
    && yourColor
    && game.status === "active"
    && game.phase === "scoring"
    && game.scoring,
  ) && gameInteractionAllowed && !busy;

  function reconcileAfterOperation(requestError: unknown) {
    if (
      requestError instanceof ApiRequestError
      && requestError.code === "identity_changed"
    ) {
      recoverChangedIdentity();
      return;
    }
    const affectsConnection = operationAffectsConnection(requestError);
    if (affectsConnection) {
      applyConnectionFailure(
        requestError,
        nextPollDelay(900, requestError, document.hidden),
      );
    }
    immediateGameSync.current?.(affectsConnection);
  }

  function refreshChangedIdentity() {
    void refreshIdentity()
      .catch(() => undefined)
      .finally(() => router.replace(href("/play")));
  }

  async function makeMove(
    move: { x?: number; y?: number; isPass?: boolean },
    expectedVersion: number,
  ) {
    if (!game || !playerKey || !gameInteractionAllowed || busy) return;
    const requestIdentity = identityAuthority.current.capture();
    const operationToken = moveOperationLatch.acquire();
    if (!operationToken) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/games/${game.id}/moves`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          [EXPECTED_PLAYER_HEADER]: playerKey,
        },
        body: JSON.stringify({ ...move, expectedVersion }),
      });
      const data = await readApi<{ actor: string; game: GameState }>(response);
      if (!identityAuthority.current.isCurrent(requestIdentity)) return;
      assertResponseActor(data.actor, playerKey);
      acceptGameResponse({ game: data.game }, Date.now(), requestIdentity);
    } catch (requestError) {
      if (
        !identityAuthority.current.isCurrent(requestIdentity)
        || isTerminalConnection(connectionStateRef.current)
      ) {
        return;
      }
      setError(localizedApiError(dictionary, requestError, copy.moveFailed));
      reconcileAfterOperation(requestError);
    } finally {
      if (
        moveOperationLatch.release(operationToken)
        && identityAuthority.current.isCurrent(requestIdentity)
      ) {
        setBusy(false);
      }
    }
  }

  async function resign() {
    if (!game || !playerKey || !gameInteractionAllowed || busy) return;
    const requestIdentity = identityAuthority.current.capture();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/games/${game.id}/resign`, {
        method: "POST",
        headers: { [EXPECTED_PLAYER_HEADER]: playerKey },
      });
      const data = await readApi<{ actor: string; game: GameState }>(response);
      if (!identityAuthority.current.isCurrent(requestIdentity)) return;
      assertResponseActor(data.actor, playerKey);
      setConfirmation(null);
      acceptGameResponse({ game: data.game }, Date.now(), requestIdentity);
    } catch (requestError) {
      if (
        !identityAuthority.current.isCurrent(requestIdentity)
        || isTerminalConnection(connectionStateRef.current)
      ) {
        return;
      }
      setError(localizedApiError(dictionary, requestError, copy.resignFailed));
      reconcileAfterOperation(requestError);
    } finally {
      if (identityAuthority.current.isCurrent(requestIdentity)) setBusy(false);
    }
  }

  async function scoringAction(
    action: "dead-stones" | "confirm" | "resume",
    body: Record<string, unknown>,
  ) {
    if (!game || !game.scoring || !playerKey || !gameInteractionAllowed || busy) return;
    const requestIdentity = identityAuthority.current.capture();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/games/${game.id}/scoring/${action}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          [EXPECTED_PLAYER_HEADER]: playerKey,
        },
        body: JSON.stringify({
          ...body,
          expectedRevision: game.scoring.revision,
        }),
      });
      const data = await readApi<{ actor: string; game: GameState }>(response);
      if (!identityAuthority.current.isCurrent(requestIdentity)) return;
      assertResponseActor(data.actor, playerKey);
      acceptGameResponse({ game: data.game }, Date.now(), requestIdentity);
    } catch (requestError) {
      if (
        !identityAuthority.current.isCurrent(requestIdentity)
        || isTerminalConnection(connectionStateRef.current)
      ) {
        return;
      }
      setError(localizedApiError(dictionary, requestError, copy.scoringFailed));
      reconcileAfterOperation(requestError);
    } finally {
      if (identityAuthority.current.isCurrent(requestIdentity)) setBusy(false);
    }
  }

  async function sendMessage(message: string) {
    if (
      !playerKey
      || !yourColor
      || !chatAvailable
      || chatTerminal.current
      || !connectionAllowsChat(connectionState)
    ) {
      return;
    }
    const requestIdentity = identityAuthority.current.capture();
    const accessGeneration = chatAccessGeneration.current;
    try {
      const response = await fetch(`/api/games/${gameId}/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          [EXPECTED_PLAYER_HEADER]: playerKey,
        },
        body: JSON.stringify({ message }),
      });
      const data = await readApi<unknown>(response);
      if (!identityAuthority.current.isCurrent(requestIdentity)) {
        if (identityAuthority.current.capture().identityKey === requestIdentity.identityKey) {
          throw new ApiRequestError("Message response lost request authority.", {
            status: 409,
            code: "session_expired",
          });
        }
        return;
      }
      if (chatAccessGeneration.current !== accessGeneration) return;
      const sentMessage = parseSentGameMessage(data, playerKey);
      applyChatMessages([sentMessage], requestIdentity, accessGeneration);
    } catch (requestError) {
      if (!identityAuthority.current.isCurrent(requestIdentity)) {
        if (identityAuthority.current.capture().identityKey === requestIdentity.identityKey) {
          throw requestError;
        }
        return;
      }
      if (
        requestError instanceof ApiRequestError
        && requestError.code === "identity_changed"
      ) {
        recoverChangedIdentity();
        throw requestError;
      }
      if (
        requestError instanceof ApiRequestError
        && [401, 403, 404].includes(requestError.status)
      ) {
        setChatAvailable(false);
        chatTerminal.current = true;
        applyConnectionFailure(
          requestError,
          nextChatPollDelay(gameStatus.current, requestError, document.hidden),
        );
        throw requestError;
      }
      if (chatAccessGeneration.current !== accessGeneration) throw requestError;
      if (
        requestError instanceof ApiRequestError
        && requestError.code === "chat_unavailable"
      ) {
        closeChatForPolicy();
        throw requestError;
      }
      setChatAvailable(false);
      throw requestError;
    }
  }

  async function updateOpponentBlock(blocked: boolean) {
    if (
      !playerKey
      || !opponent
      || blockBusy
      || blockedByYou === null
      || blockedByYou === blocked
    ) {
      return;
    }
    const requestIdentity = identityAuthority.current.capture();
    const previousState = blockedByYou;
    blockReadGeneration.current += 1;
    setBlockBusy(true);
    setBlockReconciling(false);
    setBlockError(null);
    try {
      const response = await fetch(`/api/games/${gameId}/block`, {
        method: blocked ? "POST" : "DELETE",
        headers: { [EXPECTED_PLAYER_HEADER]: playerKey },
        signal: AbortSignal.timeout(10_000),
      });
      const data = await readApi<unknown>(response);
      if (!identityAuthority.current.isCurrent(requestIdentity)) return;
      const authoritativeState = parsePlayerBlockState(data, playerKey);
      if (authoritativeState !== blocked) {
        throw new ApiRequestError("The block response did not confirm the requested state.", {
          status: 502,
          code: "invalid_response",
        });
      }
      setBlockedByYou(authoritativeState);
      setConfirmation(null);
      if (authoritativeState) {
        closeChatForPolicy();
        setBlockAnnouncement(
          copy.blockedSuccess.replace("{name}", opponent.playerName),
        );
      } else {
        chatAccessGeneration.current += 1;
        chatTerminal.current = false;
        chatPolicyUnavailableRef.current = true;
        lastMessageId.current = 0;
        setMessages([]);
        setChatAvailable(false);
        setChatPolicyUnavailable(true);
        setBlockAnnouncement(
          copy.unblockedSuccess.replace("{name}", opponent.playerName),
        );
        immediateChatSync.current?.();
      }
    } catch (requestError) {
      if (!identityAuthority.current.isCurrent(requestIdentity)) return;
      if (
        requestError instanceof ApiRequestError
        && requestError.code === "identity_changed"
      ) {
        recoverChangedIdentity();
        return;
      }
      const outcomeIsAuthoritative = requestError instanceof ApiRequestError
        && requestError.status >= 400
        && requestError.status < 500
        && requestError.status !== 408;
      if (outcomeIsAuthoritative) {
        setBlockedByYou(previousState);
        setBlockError(localizedApiError(
          dictionary,
          requestError,
          blocked ? copy.blockFailed : copy.unblockFailed,
        ));
      } else {
        blockReconciliationPending.current = true;
        setConfirmation(null);
        setBlockedByYou(null);
        setBlockReconciling(true);
        setBlockError(null);
        setBlockAnnouncement(copy.blockOutcomeUncertain);
        setBlockReadNonce((value) => value + 1);
      }
    } finally {
      if (identityAuthority.current.isCurrent(requestIdentity)) setBlockBusy(false);
    }
  }

  async function clearFinishedGame(destination: "/" | "/play") {
    if (connectionStateRef.current.kind === "session_expired") {
      recoverExpiredSession();
      return;
    }
    const requestIdentity = identityAuthority.current.capture();
    if (playerKey) {
      try {
        const cancellation = await readApi<{ actor: string }>(
          await fetch("/api/matchmaking", {
            method: "DELETE",
            headers: { [EXPECTED_PLAYER_HEADER]: playerKey },
            signal: AbortSignal.timeout(5_000),
          }),
        );
        if (!identityAuthority.current.isCurrent(requestIdentity)) return;
        assertResponseActor(cancellation.actor, playerKey);
      } catch (requestError) {
        if (!identityAuthority.current.isCurrent(requestIdentity)) return;
        if (
          requestError instanceof ApiRequestError
          && requestError.code === "identity_changed"
        ) {
          recoverChangedIdentity();
          return;
        }
        if (requestError instanceof ApiRequestError && requestError.status === 401) {
          applyConnectionFailure(requestError, 0);
          recoverExpiredSession();
          return;
        }
      }
    }
    if (!identityAuthority.current.isCurrent(requestIdentity)) return;
    router.replace(href(destination));
  }

  async function leaveGameRoom() {
    if (!game || !playerKey || !yourColor) return;
    if (isTerminalConnection(connectionStateRef.current)) {
      router.replace(href("/"));
      return;
    }
    if (busy) return;
    if (game.status === "active" && !gameInteractionAllowed) {
      router.replace(href("/"));
      return;
    }
    if (game.status === "active" && confirmation !== "leave") {
      setError(null);
      setConfirmation("leave");
      return;
    }
    const requestIdentity = identityAuthority.current.capture();
    setBusy(true);
    setError(null);
    try {
      const result = await leaveGameAndQueue(game.id, playerKey);
      if (!identityAuthority.current.isCurrent(requestIdentity)) return;
      setConfirmation(null);
      if (result.kind === "active") {
        setError(copy.leaveFailed);
        if (result.gameId !== game.id) {
          router.replace(href(`/game/${result.gameId}`));
        }
        return;
      }
      router.replace(href("/"));
    } catch (requestError) {
      if (!identityAuthority.current.isCurrent(requestIdentity)) return;
      setError(localizedApiError(dictionary, requestError, copy.leaveFailed));
      reconcileAfterOperation(requestError);
    } finally {
      if (identityAuthority.current.isCurrent(requestIdentity)) setBusy(false);
    }
  }

  function recoverExpiredSession() {
    if (identityKind === "account") {
      const returnTo = `/game/${encodeURIComponent(gameId)}`;
      router.push(
        `${href("/login")}?reauthenticate=1&returnTo=${encodeURIComponent(returnTo)}`,
      );
      return;
    }
    router.replace(href("/play"));
  }

  const connectionLabel = connectionState.kind === "live"
    ? copy.live
    : connectionState.kind === "final"
      ? copy.resultVerified
      : connectionState.kind === "session_expired"
        ? copy.sessionExpired
        : connectionState.kind === "reconnecting"
          ? connectionState.reason === "rate_limited"
            ? copy.syncDelayed
            : copy.reconnecting
          : connectionState.kind === "unavailable"
            ? copy.unavailable
            : copy.connecting;
  const connectionDescription = connectionState.kind === "session_expired"
    ? identityKind === "account"
      ? copy.sessionExpiredAccountDescription
      : copy.sessionExpiredGuestDescription
    : connectionState.kind === "reconnecting"
      ? connectionState.reason === "rate_limited"
        ? copy.syncDelayedDescription
        : copy.reconnectingDescription
      : null;
  const connectionDataState = connectionState.kind === "reconnecting"
    && connectionState.reason === "rate_limited"
    ? "delayed"
    : connectionState.kind;
  const ClockStatusIcon = connectionState.kind === "live"
    ? Wifi
    : connectionState.kind === "final"
      ? ShieldCheck
      : connectionState.kind === "reconnecting"
        ? RefreshCw
        : WifiOff;
  const clockObservedAt = connectionClockObservedAt(connectionState);

  if (
    loading
    || (!playerKey && !identityError)
    || (!game
      && !identityError
      && (connectionState.kind === "connecting" || connectionState.kind === "reconnecting"))
  ) {
    return (
      <main aria-busy="true" className="game-loading">
        <span className="spin-ring" />
        <p aria-atomic="true" aria-live="polite" role="status">
          {connectionState.kind === "reconnecting" ? connectionLabel : copy.loading}
        </p>
        {connectionDescription ? <small>{connectionDescription}</small> : null}
      </main>
    );
  }

  if (!playerKey || !game) {
    const sessionExpired = connectionState.kind === "session_expired";
    return (
      <main className="game-loading">
        <h1>{sessionExpired ? copy.sessionExpired : copy.unavailable}</h1>
        <p role="alert">
          {identityError
            ?? (sessionExpired ? connectionDescription : null)
            ?? error
            ?? copy.unavailableDescription}
        </p>
        <button
          className="button button--primary"
          onClick={identityError
            ? retryIdentity
            : identityChanged
              ? refreshChangedIdentity
            : sessionExpired
              ? recoverExpiredSession
              : () => router.replace(href("/play"))}
          ref={recoveryAction}
          type="button"
        >
          {identityError
            ? copy.retrySession
            : identityChanged
              ? dictionary.play.refreshSession
            : sessionExpired
              ? identityKind === "account" ? copy.signInAgain : copy.startNewSession
              : copy.returnToPlay}
        </button>
      </main>
    );
  }

  return (
    <div className="focused-game-shell">
      <p aria-atomic="true" aria-live="polite" className="sr-only" role="status">
        {gameAnnouncement}
      </p>
      <p aria-atomic="true" aria-live="polite" className="sr-only" role="status">
        {connectionAnnouncement}
      </p>
      <p aria-atomic="true" aria-live="polite" className="sr-only" role="status">
        {blockAnnouncement}
      </p>
      <header className="game-topbar">
        <span className="game-brand">
          <span className="brand-mark"><span /><span /></span>
          GoStone
        </span>
        <span className="game-security">
          <ShieldCheck size={15} />
          {connectionState.kind === "live" || connectionState.kind === "final"
            ? copy.serverVerified
            : copy.lastVerifiedState}
        </span>
        <span className="game-connection" data-state={connectionDataState}>
          <ClockStatusIcon
            aria-hidden="true"
            className={connectionState.kind === "reconnecting" ? "spin" : undefined}
            size={15}
          />
          {connectionLabel}
        </span>
        <LanguageSwitcher compact />
        <button
          className="game-exit"
          disabled={busy && gameInteractionAllowed}
          onClick={leaveGameRoom}
          type="button"
        >
          <LogOut size={15} />
          {game.status === "active" && !gameInteractionAllowed
            ? copy.leaveView
            : copy.leaveGame}
        </button>
      </header>

      <main className="focused-game-layout">
        {connectionDescription ? (
          <section className="game-connection-notice" data-state={connectionDataState}>
            <ClockStatusIcon aria-hidden="true" size={18} />
            <p>
              <strong>{connectionLabel}</strong>
              <span>{connectionDescription}</span>
            </p>
            {connectionState.kind === "session_expired" ? (
              <button className="button button--primary" onClick={recoverExpiredSession} type="button">
                <LogIn size={17} />
                {identityKind === "account" ? copy.signInAgain : copy.startNewSession}
              </button>
            ) : null}
          </section>
        ) : null}
        <section className="focused-board-panel">
          <div className="focused-board-status" ref={boardStatus} tabIndex={-1}>
            <strong>
              {game.status === "active" && !gameInteractionAllowed
                ? copy.controlsPaused
                : canMove
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
                  void makeMove({ x, y }, game.version);
                }
              }}
              precisionRevision={JSON.stringify([
                game.version,
                game.status,
                game.phase,
                game.turn ?? "none",
                identityKey,
                connectionState.kind,
                busy ? "busy" : "idle",
              ])}
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
            clockObservedAt={clockObservedAt}
            game={game}
            interactionDisabled={!gameInteractionAllowed}
            onLeave={() => clearFinishedGame("/play")}
            onPass={() => makeMove({ isPass: true }, game.version)}
            onConfirmScore={() => scoringAction("confirm", {})}
            onResign={() => {
              if (!gameInteractionAllowed) return;
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
            blockActionRef={blockActionRef}
            blockedByYou={opponent ? blockedByYou : null}
            blockBusy={blockBusy}
            blockError={confirmation === "block" ? null : blockError}
            blockReconciling={blockReconciling}
            chatPolicyUnavailable={chatPolicyUnavailable}
            disabled={
              !chatAvailable
              || !connectionAllowsChat(connectionState)
            }
            key={identityKey}
            messages={messages}
            onBlock={() => {
              if (!opponent || blockedByYou !== false) return;
              setBlockError(null);
              setConfirmation("block");
            }}
            onReloadBlock={() => {
              setBlockedByYou(null);
              setBlockReconciling(true);
              setBlockError(null);
              setBlockReadNonce((value) => value + 1);
            }}
            onSend={sendMessage}
            onUnblock={() => void updateOpponentBlock(false)}
            opponentName={opponent?.playerName ?? copy.opponent}
            playerKey={playerKey}
          />
        </aside>
      </main>
      <ConfirmModal
        busy={confirmation === "block" ? blockBusy : busy}
        confirmLabel={
          confirmation === "block"
            ? copy.confirmBlock
            : confirmation === "resign" ? copy.resignGame : copy.leaveGame
        }
        description={
          confirmation === "block"
            ? copy.blockDescription
            : confirmation === "resign"
            ? copy.resignDescription
            : copy.leaveDescription
        }
        error={confirmation === "block" ? blockError : error}
        finalFocusRef={confirmation === "block" ? blockActionRef : undefined}
        onCancel={() => {
          setConfirmation(null);
          if (confirmation === "block") setBlockError(null);
        }}
        onConfirm={
          confirmation === "block"
            ? () => void updateOpponentBlock(true)
            : confirmation === "resign" ? resign : leaveGameRoom
        }
        open={
          confirmation === "block"
            ? Boolean(opponent && blockedByYou === false)
            : confirmation !== null && gameInteractionAllowed
        }
        title={
          confirmation === "block"
            ? copy.blockTitle.replace("{name}", opponent?.playerName ?? copy.opponent)
            : confirmation === "resign" ? copy.resignTitle : copy.leaveTitle
        }
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
