"use client";

import { ShieldCheck, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { usePlayerIdentity } from "@/components/auth/PlayerIdentityProvider";
import { useI18n } from "@/components/i18n/I18nProvider";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { readApi } from "@/lib/client/api";
import { EXPECTED_PLAYER_HEADER } from "@/lib/auth/playerBinding";
import {
  assertResponseActor,
  createIdentityRequestAuthority,
  type IdentityRequestToken,
} from "@/lib/client/identityAuthority";
import { leaveGameAndQueue } from "@/lib/client/leaveGame";
import {
  applyMatchmakingQueueState,
  type MatchmakingQueueState,
} from "@/lib/client/matchmaking";
import {
  INITIAL_MATCHMAKING_CONNECTION,
  isTerminalMatchmakingConnection,
  matchmakingConnectionAfterFailure,
  matchmakingConnectionAfterSuccess,
  matchmakingConnectionAllowsActions,
  matchmakingConnectionAllowsSync,
  matchmakingOperationNeedsReconciliation,
  type MatchmakingConnectionState,
} from "@/lib/client/matchmakingConnection";
import { createPollingRequestGuard, nextPollDelay } from "@/lib/client/polling";
import type { BoardSize, TimeControlId } from "@/lib/game/types";
import { localizedApiError } from "@/lib/i18n/dictionary";
import { ActiveGamePanel } from "./ActiveGamePanel";
import { BoardSizeSelector } from "./BoardSizeSelector";
import { MatchmakingPanel } from "./MatchmakingPanel";
import { TimeControlSelector } from "./TimeControlSelector";

type MatchmakingApiResponse = {
  actor: string;
  matchmaking: MatchmakingQueueState;
};

export function PlayWorkspace({ initialSize = 9 }: { initialSize?: BoardSize }) {
  const router = useRouter();
  const { dictionary, href, locale } = useI18n();
  const copy = dictionary.play;
  const {
    playerKey,
    playerName,
    identityKind,
    loading,
    error: identityError,
    refreshIdentity,
    restartGuest,
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
  const [connectionState, setConnectionState] = useState<MatchmakingConnectionState>(
    INITIAL_MATCHMAKING_CONNECTION,
  );
  const [syncAttempt, setSyncAttempt] = useState(0);
  const matchmakingAction = useRef<HTMLButtonElement>(null);
  const queueKnown = useRef(false);
  const enterMatchedOnSync = useRef(false);
  const connectionStateRef = useRef<MatchmakingConnectionState>(
    INITIAL_MATCHMAKING_CONNECTION,
  );
  const identityKey = `${identityKind ?? "none"}:${playerKey ?? "none"}:${locale}`;
  const requestAuthority = useRef(createIdentityRequestAuthority(identityKey));
  const cancelQueueReads = useRef<() => void>(() => undefined);
  const activeOperationController = useRef<AbortController | null>(null);

  const transitionConnection = useCallback((next: MatchmakingConnectionState) => {
    connectionStateRef.current = next;
    setConnectionState(next);
    if (isTerminalMatchmakingConnection(next)) {
      setBusy(false);
      setConfirmLeave(false);
    }
  }, []);

  const clearQueueBoundState = useCallback(() => {
    queueKnown.current = false;
    enterMatchedOnSync.current = false;
    setQueueStatus("idle");
    setActiveGame(null);
    setConfirmLeave(false);
  }, []);

  useLayoutEffect(() => {
    if (!requestAuthority.current.updateIdentity(identityKey)) return;
    cancelQueueReads.current();
    activeOperationController.current?.abort();
    activeOperationController.current = null;
    clearQueueBoundState();
    connectionStateRef.current = INITIAL_MATCHMAKING_CONNECTION;
    setConnectionState(INITIAL_MATCHMAKING_CONNECTION);
    setBusy(false);
    setError(null);
  }, [clearQueueBoundState, identityKey]);

  useLayoutEffect(() => () => {
    cancelQueueReads.current();
    activeOperationController.current?.abort();
    activeOperationController.current = null;
    requestAuthority.current.invalidate();
  }, []);

  const applyConnectionFailure = useCallback((
    requestError: unknown,
    retryDelayMs: number,
  ) => {
    const previous = connectionStateRef.current;
    const next = matchmakingConnectionAfterFailure(
      previous,
      requestError,
      Date.now(),
      retryDelayMs,
    );
    if (
      previous.kind !== next.kind
      && isTerminalMatchmakingConnection(next)
    ) {
      const actionHadFocus = document.activeElement === matchmakingAction.current;
      activeOperationController.current?.abort();
      requestAuthority.current.invalidate();
      clearQueueBoundState();
      if (actionHadFocus) {
        window.requestAnimationFrame(() => matchmakingAction.current?.focus());
      }
    }
    transitionConnection(next);
    return next;
  }, [clearQueueBoundState, transitionConnection]);

  const handleQueueState = useCallback((
    queue: MatchmakingQueueState,
    enterMatchedGame: boolean,
  ) => {
    applyMatchmakingQueueState(queue, enterMatchedGame, {
      enterGame: (gameId) => router.replace(href(`/game/${gameId}`)),
      selectBoardSize: setBoardSize,
      selectTimeControl: setTimeControl,
      setActiveGame,
      setQueueStatus: (status) => {
        setQueueStatus(status);
      },
    });
  }, [href, router]);

  const acceptQueueResponse = useCallback((
    data: MatchmakingApiResponse,
    requestIdentity: IdentityRequestToken,
    enterMatchedGame: boolean,
  ) => {
    if (
      !playerKey
      || !requestAuthority.current.isCurrent(requestIdentity)
      || isTerminalMatchmakingConnection(connectionStateRef.current)
    ) {
      return false;
    }
    assertResponseActor(data.actor, playerKey);
    handleQueueState(data.matchmaking, enterMatchedGame);
    queueKnown.current = true;
    enterMatchedOnSync.current = data.matchmaking.status === "waiting";
    transitionConnection(matchmakingConnectionAfterSuccess(Date.now()));
    setError(null);
    return true;
  }, [handleQueueState, playerKey, transitionConnection]);

  useEffect(() => {
    if (
      !playerKey
      || busy
      || activeGame
      || !matchmakingConnectionAllowsSync(connectionStateRef.current)
    ) {
      return;
    }
    const requestIdentity = requestAuthority.current.capture();
    let cancelled = false;
    let timer: number | undefined;
    const guard = createPollingRequestGuard();

    const poll = async () => {
      if (
        !requestAuthority.current.isCurrent(requestIdentity)
        || !matchmakingConnectionAllowsSync(connectionStateRef.current)
      ) {
        return;
      }
      let requestError: unknown = null;
      let shouldContinue = false;
      const guardSignal = guard.start();
      const signal = AbortSignal.any([guardSignal, AbortSignal.timeout(10_000)]);
      try {
        const response = await fetch("/api/matchmaking", {
          cache: "no-store",
          headers: { [EXPECTED_PLAYER_HEADER]: playerKey },
          signal,
        });
        const data = await readApi<MatchmakingApiResponse>(response);
        if (
          !guard.isCurrent(guardSignal)
          || !requestAuthority.current.isCurrent(requestIdentity)
        ) {
          return;
        }
        const accepted = acceptQueueResponse(
          data,
          requestIdentity,
          enterMatchedOnSync.current,
        );
        shouldContinue = accepted && data.matchmaking.status === "waiting";
      } catch (caughtError) {
        requestError = caughtError;
        if (
          guard.isCurrent(guardSignal)
          && requestAuthority.current.isCurrent(requestIdentity)
        ) {
          const delay = nextPollDelay(1_000, requestError, document.hidden);
          const next = applyConnectionFailure(requestError, delay);
          setError(localizedApiError(dictionary, requestError, copy.matchmakingFailed));
          shouldContinue = matchmakingConnectionAllowsSync(next);
        }
      } finally {
        if (
          !cancelled
          && guard.isCurrent(guardSignal)
          && requestAuthority.current.isCurrent(requestIdentity)
          && shouldContinue
        ) {
          timer = window.setTimeout(
            poll,
            nextPollDelay(1_000, requestError, document.hidden),
          );
        }
      }
    };

    const cancel = () => {
      cancelled = true;
      guard.cancel();
      if (timer !== undefined) window.clearTimeout(timer);
    };
    cancelQueueReads.current = cancel;
    const currentConnection = connectionStateRef.current;
    const initialDelay = currentConnection.kind === "reconnecting"
      ? Math.max(0, currentConnection.retryAt - Date.now())
      : queueKnown.current ? 1_000 : 0;
    timer = window.setTimeout(poll, initialDelay);
    return () => {
      cancel();
      if (cancelQueueReads.current === cancel) {
        cancelQueueReads.current = () => undefined;
      }
    };
  }, [
    acceptQueueResponse,
    activeGame,
    applyConnectionFailure,
    busy,
    copy.matchmakingFailed,
    dictionary,
    identityKey,
    playerKey,
    syncAttempt,
  ]);

  function beginQueueOperation() {
    cancelQueueReads.current();
    activeOperationController.current?.abort();
    const controller = new AbortController();
    activeOperationController.current = controller;
    requestAuthority.current.invalidate();
    const requestIdentity = requestAuthority.current.capture();
    setBusy(true);
    setError(null);
    return {
      controller,
      requestIdentity,
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]),
    };
  }

  function reconcileOperationFailure(
    requestError: unknown,
    requestIdentity: IdentityRequestToken,
    fallback: string,
  ) {
    if (!requestAuthority.current.isCurrent(requestIdentity)) return;
    setError(localizedApiError(dictionary, requestError, fallback));
    if (!matchmakingOperationNeedsReconciliation(requestError)) return;
    const delay = nextPollDelay(1_000, requestError, document.hidden);
    const next = applyConnectionFailure(requestError, delay);
    if (matchmakingConnectionAllowsSync(next)) {
      enterMatchedOnSync.current = true;
      setSyncAttempt((current) => current + 1);
    }
  }

  function restoreQueueActionFocus() {
    window.requestAnimationFrame(() => matchmakingAction.current?.focus());
  }

  async function findMatch() {
    if (
      !playerKey
      || busy
      || !matchmakingConnectionAllowsActions(connectionStateRef.current)
    ) {
      return;
    }
    const { controller, requestIdentity, signal } = beginQueueOperation();
    enterMatchedOnSync.current = true;
    try {
      const response = await fetch("/api/matchmaking", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          [EXPECTED_PLAYER_HEADER]: playerKey,
        },
        body: JSON.stringify({ boardSize, timeControl }),
        signal,
      });
      const data = await readApi<MatchmakingApiResponse>(response);
      if (!acceptQueueResponse(data, requestIdentity, true)) return;
      if (data.matchmaking.status !== "matched") restoreQueueActionFocus();
    } catch (requestError) {
      reconcileOperationFailure(requestError, requestIdentity, copy.joinFailed);
    } finally {
      if (activeOperationController.current === controller) {
        activeOperationController.current = null;
      }
      if (requestAuthority.current.isCurrent(requestIdentity)) {
        setBusy(false);
      }
    }
  }

  async function cancelSearch() {
    if (
      !playerKey
      || busy
      || !matchmakingConnectionAllowsActions(connectionStateRef.current)
    ) {
      return;
    }
    const { controller, requestIdentity, signal } = beginQueueOperation();
    enterMatchedOnSync.current = true;
    try {
      const data = await readApi<MatchmakingApiResponse>(
        await fetch("/api/matchmaking", {
          method: "DELETE",
          headers: { [EXPECTED_PLAYER_HEADER]: playerKey },
          signal,
        }),
      );
      if (!acceptQueueResponse(data, requestIdentity, true)) return;
      if (data.matchmaking.status !== "matched") restoreQueueActionFocus();
    } catch (requestError) {
      reconcileOperationFailure(requestError, requestIdentity, copy.cancelFailed);
    } finally {
      if (activeOperationController.current === controller) {
        activeOperationController.current = null;
      }
      if (requestAuthority.current.isCurrent(requestIdentity)) {
        setBusy(false);
      }
    }
  }

  async function leaveActiveGame() {
    if (
      !playerKey
      || !activeGame
      || busy
      || !matchmakingConnectionAllowsActions(connectionStateRef.current)
    ) {
      return;
    }
    const { controller, requestIdentity, signal } = beginQueueOperation();
    enterMatchedOnSync.current = true;
    try {
      const result = await leaveGameAndQueue(activeGame.gameId, playerKey, signal);
      if (!requestAuthority.current.isCurrent(requestIdentity)) return;
      queueKnown.current = true;
      enterMatchedOnSync.current = false;
      if (result.kind === "active") {
        setBoardSize(result.boardSize);
        setTimeControl(result.timeControl);
        setActiveGame(result);
        setQueueStatus("idle");
        transitionConnection(matchmakingConnectionAfterSuccess(Date.now()));
        setError(copy.leaveFailed);
        return;
      }
      setActiveGame(null);
      setQueueStatus("idle");
      setConfirmLeave(false);
      transitionConnection(matchmakingConnectionAfterSuccess(Date.now()));
      setError(null);
      restoreQueueActionFocus();
    } catch (requestError) {
      reconcileOperationFailure(requestError, requestIdentity, copy.leaveFailed);
    } finally {
      if (activeOperationController.current === controller) {
        activeOperationController.current = null;
      }
      if (requestAuthority.current.isCurrent(requestIdentity)) {
        setBusy(false);
      }
    }
  }

  function retryQueueSync() {
    cancelQueueReads.current();
    activeOperationController.current?.abort();
    activeOperationController.current = null;
    requestAuthority.current.invalidate();
    clearQueueBoundState();
    transitionConnection(INITIAL_MATCHMAKING_CONNECTION);
    setError(null);
    setSyncAttempt((current) => current + 1);
  }

  function recoverExpiredSession() {
    if (identityKind === "account") {
      router.push(
        `${href("/login")}?reauthenticate=1&returnTo=${encodeURIComponent("/play")}`,
      );
      return;
    }
    if (identityKind === "guest") {
      restartGuest();
      return;
    }
    retryIdentity();
  }

  function recoverChangedIdentity() {
    refreshIdentity().catch(() => undefined);
  }

  useEffect(() => {
    if (!playerKey) return;
    const markOffline = () => {
      if (isTerminalMatchmakingConnection(connectionStateRef.current)) return;
      applyConnectionFailure(new Error("offline"), 0);
      setError(null);
    };
    const reconcileOnline = () => {
      const current = connectionStateRef.current;
      if (current.kind !== "reconnecting" || current.reason !== "offline") return;
      setSyncAttempt((attempt) => attempt + 1);
    };
    window.addEventListener("offline", markOffline);
    window.addEventListener("online", reconcileOnline);
    return () => {
      window.removeEventListener("offline", markOffline);
      window.removeEventListener("online", reconcileOnline);
    };
  }, [applyConnectionFailure, playerKey]);

  const actionReady = Boolean(playerKey)
    && !loading
    && matchmakingConnectionAllowsActions(connectionState);
  const connectionLabel = connectionState.kind === "live"
    ? queueStatus === "waiting" ? copy.searching : copy.ready
    : connectionState.kind === "checking"
      ? copy.checkingQueue
      : connectionState.kind === "reconnecting"
        ? connectionState.reason === "rate_limited"
          ? copy.syncDelayed
          : connectionState.reason === "offline" ? copy.offline : copy.reconnecting
        : connectionState.kind === "session_expired"
          ? copy.sessionExpired
          : connectionState.kind === "identity_changed"
            ? copy.identityChanged
          : copy.unavailable;
  const connectionDescription = connectionState.kind === "checking"
    ? copy.checkingQueueDescription
    : connectionState.kind === "reconnecting"
      ? connectionState.reason === "rate_limited"
        ? copy.syncDelayedDescription
        : connectionState.reason === "offline"
          ? copy.offlineDescription
          : copy.reconnectingDescription
      : connectionState.kind === "session_expired"
        ? identityKind === "account"
          ? copy.sessionExpiredAccountDescription
          : copy.sessionExpiredGuestDescription
        : connectionState.kind === "identity_changed"
          ? copy.identityChangedDescription
        : connectionState.kind === "unavailable"
          ? copy.queueUnavailableDescription
          : null;
  const panelError = error ?? identityError;

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
            busy={busy || !actionReady}
            error={error}
            onLeave={() => {
              setError(null);
              setConfirmLeave(true);
            }}
            onResume={() => router.push(href(`/game/${activeGame.gameId}`))}
          />
        ) : (
          <>
            <div className="lobby-options">
              <div>
                <span>{copy.boardSize}</span>
                <BoardSizeSelector
                  disabled={busy || queueStatus === "waiting" || !actionReady}
                  onChange={setBoardSize}
                  value={boardSize}
                />
              </div>
              <div>
                <span>{copy.timeControl}</span>
                <TimeControlSelector
                  disabled={busy || queueStatus === "waiting" || !actionReady}
                  onChange={setTimeControl}
                  value={timeControl}
                />
              </div>
            </div>
            <MatchmakingPanel
              boardSize={boardSize}
              busy={busy}
              connectionDescription={connectionDescription}
              connectionKind={connectionState.kind}
              connectionLabel={connectionLabel}
              error={panelError}
              onCancel={cancelSearch}
              onFind={findMatch}
              onRecover={connectionState.kind === "session_expired"
                ? recoverExpiredSession
                : connectionState.kind === "identity_changed"
                  ? recoverChangedIdentity
                  : retryQueueSync}
              onRetry={retryIdentity}
              primaryActionRef={matchmakingAction}
              playerName={playerName}
              ready={actionReady}
              recoveryLabel={connectionState.kind === "session_expired"
                ? identityKind === "account" ? copy.signInAgain : copy.startNewSession
                : connectionState.kind === "identity_changed"
                  ? copy.refreshSession
                  : copy.retryQueue}
              status={queueStatus}
              timeControl={timeControl}
            />
          </>
        )}
      </section>
      <ConfirmModal
        busy={busy || !actionReady}
        confirmLabel={copy.leaveGame}
        description={copy.leaveDescription}
        error={error}
        finalFocusRef={matchmakingAction}
        onCancel={() => setConfirmLeave(false)}
        onConfirm={leaveActiveGame}
        open={confirmLeave}
        title={copy.leaveTitle}
      />
    </div>
  );
}
