"use client";

import { Radio, Search, Users, X } from "lucide-react";
import { getTimeControl } from "@/lib/game/timeControls";
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
}: MatchmakingPanelProps) {
  const waiting = status === "waiting";
  const selectedTime = getTimeControl(timeControl);

  return (
    <section className="matchmaking-panel" aria-live="polite">
      <div className="panel-heading">
        <div>
          <span className="panel-icon"><Radio size={18} /></span>
          <div>
            <h2>{waiting ? "Finding a player" : "Quick match"}</h2>
            <p>{waiting ? "Keep this page open." : `Ready as ${playerName ?? "player"}.`}</p>
          </div>
        </div>
        <Badge tone="green">{waiting ? "Searching" : "Online"}</Badge>
      </div>

      <div className="match-settings">
        <div>
          <span>Board</span>
          <strong>{boardSize}×{boardSize}</strong>
        </div>
        <div>
          <span>Clock</span>
          <strong>{selectedTime.name}</strong>
        </div>
        <div>
          <span>Rules</span>
          <strong>Chinese</strong>
        </div>
      </div>

      {waiting ? (
        <>
          <div className="queue-indicator">
            <Search className="spin" size={20} />
            <span>
              Looking for another {boardSize}×{boardSize}{" "}
              {selectedTime.name.toLowerCase()} player…
            </span>
          </div>
          <Button className="match-button" disabled={busy} onClick={onCancel} size="lg" variant="secondary">
            <X size={20} />
            Cancel search
          </Button>
        </>
      ) : (
        <Button className="match-button" disabled={busy || !ready} onClick={onFind} size="lg">
          {busy ? <Search className="spin" size={20} /> : <Users size={20} />}
          {!ready ? "Preparing guest…" : busy ? "Joining queue…" : "Find an opponent"}
        </Button>
      )}
      {error ? <p className="match-error">{error}</p> : null}
      <p className="panel-note">
        Both players must choose the same board size and time control.
      </p>
    </section>
  );
}
