"use client";

import { ArrowRight, RefreshCw, Search, X } from "lucide-react";
import type { RefObject } from "react";
import { useI18n } from "@/components/i18n/I18nProvider";
import { Button } from "@/components/ui/Button";
import type { MatchmakingConnectionState } from "@/lib/client/matchmakingConnection";
import type { BoardSize, TimeControlId } from "@/lib/game/types";

type MatchmakingPanelProps = {
  boardSize: BoardSize;
  timeControl: TimeControlId;
  status: "idle" | "waiting";
  busy: boolean;
  ready: boolean;
  connectionKind: MatchmakingConnectionState["kind"];
  connectionLabel: string;
  connectionDescription: string | null;
  recoveryLabel: string;
  identityUnavailable: boolean;
  error: string | null;
  onFind: () => void;
  onCancel: () => void;
  onRecover: () => void;
  onRetry: () => void;
  primaryActionRef?: RefObject<HTMLButtonElement | null>;
};

export function MatchmakingPanel({
  boardSize,
  timeControl,
  status,
  busy,
  ready,
  connectionKind,
  connectionLabel,
  connectionDescription,
  recoveryLabel,
  identityUnavailable,
  error,
  onFind,
  onCancel,
  onRecover,
  onRetry,
  primaryActionRef,
}: MatchmakingPanelProps) {
  const { dictionary } = useI18n();
  const copy = dictionary.play;
  const waiting = status === "waiting";
  const selectedTime = dictionary.timeControls[timeControl];
  const terminal = connectionKind === "session_expired"
    || connectionKind === "identity_changed"
    || connectionKind === "unavailable";
  const presentedConnectionLabel = identityUnavailable ? copy.unavailable : connectionLabel;
  const presentedConnectionDescription = identityUnavailable
    ? copy.secureSessionUnavailable
    : connectionDescription;
  const statusAnnouncement = presentedConnectionDescription
    ? `${presentedConnectionLabel}. ${presentedConnectionDescription}`
    : presentedConnectionLabel;
  const waitingDescription = copy.lookingForPlayer
    .replace("{board}", `${boardSize}×${boardSize}`)
    .replace("{time}", selectedTime.name);
  const showConnectionState = !ready || waiting || Boolean(error);

  return (
    <section className="play-matchmaking">
      <p
        aria-atomic="true"
        aria-label={statusAnnouncement}
        aria-live="polite"
        className={showConnectionState ? "play-match-status" : "sr-only"}
        data-state={connectionKind}
        role="status"
      >
        {waiting ? (
          <><Search aria-hidden="true" className="spin" size={18} /> <span>{waitingDescription}</span></>
        ) : (
          <>
            <strong>{presentedConnectionLabel}</strong>
            {presentedConnectionDescription ? <span>{presentedConnectionDescription}</span> : null}
          </>
        )}
      </p>

      {waiting ? (
        terminal ? (
          <Button
            className="play-match-action"
            disabled={busy}
            onClick={onRecover}
            ref={primaryActionRef}
            size="lg"
          >
            <span>{recoveryLabel}</span>
            <RefreshCw aria-hidden="true" size={20} />
          </Button>
        ) : (
          <Button
            className="play-match-action"
            disabled={busy || !ready}
            onClick={onCancel}
            ref={primaryActionRef}
            size="lg"
            variant="secondary"
          >
            <span>{copy.cancelSearch}</span>
            <X aria-hidden="true" size={20} />
          </Button>
        )
      ) : (
        <Button
          className="play-match-action"
          disabled={busy || (!ready && !terminal && !identityUnavailable)}
          onClick={terminal ? onRecover : ready ? onFind : onRetry}
          ref={primaryActionRef}
          size="lg"
        >
          <span>
            {terminal
              ? recoveryLabel
              : identityUnavailable
                ? copy.retrySession
                : !ready
                  ? connectionLabel
                  : busy ? copy.joiningQueue : copy.findOpponent}
          </span>
          {busy ? (
            <Search aria-hidden="true" className="spin" size={20} />
          ) : terminal || identityUnavailable || !ready ? (
            <RefreshCw
              aria-hidden="true"
              className={!ready && !terminal && !identityUnavailable ? "spin" : undefined}
              size={20}
            />
          ) : (
            <ArrowRight aria-hidden="true" size={21} />
          )}
        </Button>
      )}

      {error ? <p className="match-error" role="alert">{error}</p> : null}
    </section>
  );
}
