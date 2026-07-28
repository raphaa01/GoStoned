"use client";

import { Radio, RefreshCw, Search, Users, X } from "lucide-react";
import { useI18n } from "@/components/i18n/I18nProvider";
import type { BoardSize, TimeControlId } from "@/lib/game/types";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";

type MatchmakingPanelProps = {
  boardSize: BoardSize;
  timeControl: TimeControlId;
  status: "idle" | "waiting";
  busy: boolean;
  ready: boolean;
  playerName: string | null;
  error: string | null;
  onFind: () => void;
  onCancel: () => void;
  onRetry: () => void;
};

export function MatchmakingPanel({
  boardSize,
  timeControl,
  status,
  busy,
  ready,
  playerName,
  error,
  onFind,
  onCancel,
  onRetry,
}: MatchmakingPanelProps) {
  const { dictionary } = useI18n();
  const copy = dictionary.play;
  const waiting = status === "waiting";
  const selectedTime = dictionary.timeControls[timeControl];

  return (
    <section className="matchmaking-panel" aria-live="polite">
      <div className="panel-heading">
        <div>
          <span className="panel-icon"><Radio size={18} /></span>
          <div>
            <h2>{waiting ? copy.findingPlayer : copy.quickMatch}</h2>
            <p>
              {waiting
                ? copy.keepOpen
                : !ready && error
                  ? copy.secureSessionUnavailable
                  : `${copy.readyAs} ${playerName ?? copy.player}.`}
            </p>
          </div>
        </div>
        <Badge tone={ready ? "green" : "neutral"}>
          {waiting ? copy.searching : ready ? copy.online : error ? copy.unavailable : copy.preparing}
        </Badge>
      </div>

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
          <strong>{copy.chinese}</strong>
        </div>
      </div>

      {waiting ? (
        <>
          <div className="queue-indicator">
            <Search className="spin" size={20} />
            <span>
              {copy.lookingFor} {boardSize}×{boardSize}{" "}
              {selectedTime.name.toLocaleLowerCase()} {copy.playerSuffix}
            </span>
          </div>
          <Button className="match-button" disabled={busy} onClick={onCancel} size="lg" variant="secondary">
            <X size={20} />
            {copy.cancelSearch}
          </Button>
        </>
      ) : (
        <Button
          className="match-button"
          disabled={busy || (!ready && !error)}
          onClick={ready ? onFind : onRetry}
          size="lg"
        >
          {busy ? (
            <Search className="spin" size={20} />
          ) : !ready && error ? (
            <RefreshCw size={20} />
          ) : (
            <Users size={20} />
          )}
          {!ready
            ? error ? copy.retrySession : copy.preparingGuest
            : busy ? copy.joiningQueue : copy.findOpponent}
        </Button>
      )}
      {error ? <p className="match-error">{error}</p> : null}
      <p className="panel-note">
        {copy.matchingNote}
      </p>
    </section>
  );
}
