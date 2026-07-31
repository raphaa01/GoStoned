"use client";

import { Radio, RefreshCw, Search, Users, X } from "lucide-react";
import type { RefObject } from "react";
import { useI18n } from "@/components/i18n/I18nProvider";
import type { MatchmakingConnectionState } from "@/lib/client/matchmakingConnection";
import type { BoardSize, TimeControlId } from "@/lib/game/types";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import type { MatchmakingQueueState } from "@/lib/client/matchmaking";
import { RatingLabel } from "@/components/rating/RatingLabel";

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
  playerName: string | null;
  error: string | null;
  onFind: () => void;
  onCancel: () => void;
  onRecover: () => void;
  onRetry: () => void;
  primaryActionRef?: RefObject<HTMLButtonElement | null>;
  queueDetails: MatchmakingQueueState | null;
  identityKind: "account" | "guest" | null;
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
  playerName,
  error,
  onFind,
  onCancel,
  onRecover,
  onRetry,
  primaryActionRef,
  queueDetails,
  identityKind,
}: MatchmakingPanelProps) {
  const { dictionary, locale } = useI18n();
  const copy = dictionary.play;
  const waiting = status === "waiting";
  const selectedTime = dictionary.timeControls[timeControl];
  const terminal = connectionKind === "session_expired"
    || connectionKind === "identity_changed"
    || connectionKind === "unavailable";
  const identityUnavailable = !playerName && Boolean(error);
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

  return (
    <section className="matchmaking-panel">
      <div className="panel-heading">
        <div>
          <span className="panel-icon"><Radio size={18} /></span>
          <div>
            <h2>{waiting ? copy.findingPlayer : copy.quickMatch}</h2>
            <p>
              {waiting
                ? presentedConnectionDescription ?? copy.keepOpen
                : !ready
                  ? presentedConnectionDescription
                    ?? (error ? copy.secureSessionUnavailable : copy.checkingQueueDescription)
                  : `${copy.readyAs} ${playerName ?? copy.player}.`}
            </p>
          </div>
        </div>
        <Badge tone={ready ? "green" : "neutral"}>
          {presentedConnectionLabel}
        </Badge>
      </div>

      <p
        aria-atomic="true"
        aria-label={statusAnnouncement}
        aria-live="polite"
        className="match-connection-status"
        data-state={connectionKind}
        role="status"
      >
        <strong>{presentedConnectionLabel}</strong>
        {presentedConnectionDescription
          ? <span>{presentedConnectionDescription}</span>
          : null}
      </p>

      <div className="match-settings">
        <div>
          <span>{copy.board}</span>
          <strong>{boardSize}×{boardSize}</strong>
        </div>
        <div>
          <span>{copy.clock}</span>
          <strong>{selectedTime.name}</strong>
        </div>
        <div>
          <span>{copy.rules}</span>
          <strong>{copy.japanese}</strong>
        </div>
      </div>

      {waiting ? (
        <>
          <div className="queue-indicator">
            <Search className="spin" size={20} />
            <span>{waitingDescription}</span>
          </div>
          <p className="panel-note">
            {queueDetails?.pool === "registered-rated" || identityKind === "account"
              ? copy.registeredRatedPool
              : copy.guestUnratedPool}
            {queueDetails?.botMatchPreference === "calibrated-rated-after-wait"
                ? ` ${copy.calibratedBotFallbackPending}`
                : ` ${copy.noBotFallback}`}
          </p>
          {queueDetails?.pool === "registered-rated" && queueDetails.rating !== null
            && queueDetails.rating !== undefined ? (
              <div className="queue-rating">
                <span>{copy.queueRating}</span>
                <RatingLabel
                  locale={locale}
                  preference={queueDetails.displayPreference ?? "both"}
                  rating={queueDetails.rating}
                />
              </div>
            ) : null}
          {terminal ? (
            <Button className="match-button" disabled={busy} onClick={onRecover} ref={primaryActionRef} size="lg">
              <RefreshCw size={20} />
              {recoveryLabel}
            </Button>
          ) : (
            <Button className="match-button" disabled={busy || !ready} onClick={onCancel} ref={primaryActionRef} size="lg" variant="secondary">
              <X size={20} />
              {copy.cancelSearch}
            </Button>
          )}
        </>
      ) : (
        <Button
          className="match-button"
          disabled={busy || (!ready && !terminal && !identityUnavailable)}
          onClick={terminal ? onRecover : ready ? onFind : onRetry}
          ref={primaryActionRef}
          size="lg"
        >
          {busy ? (
            <Search className="spin" size={20} />
          ) : terminal || identityUnavailable || !ready ? (
            <RefreshCw
              className={!ready && !terminal && !identityUnavailable ? "spin" : undefined}
              size={20}
            />
          ) : (
            <Users size={20} />
          )}
          {terminal
            ? recoveryLabel
            : identityUnavailable
              ? copy.retrySession
              : !ready
                ? connectionLabel
            : busy ? copy.joiningQueue : copy.findOpponent}
        </Button>
      )}
      {error ? <p className="match-error" role="alert">{error}</p> : null}
      <p className="panel-note">
        {copy.matchingNote}
      </p>
    </section>
  );
}
