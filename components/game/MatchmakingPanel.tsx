"use client";

import { Radio, Search, Users, X } from "lucide-react";
import type { BoardSize } from "@/lib/game/types";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";

type MatchmakingPanelProps = {
  boardSize: BoardSize;
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
  status,
  busy,
  ready,
  playerName,
  error,
  onFind,
  onCancel,
}: MatchmakingPanelProps) {
  const waiting = status === "waiting";

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
          <span>Mode</span>
          <strong>Live</strong>
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
            <span>Looking for another {boardSize}×{boardSize} player…</span>
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
        Open this page in a second browser or an incognito window and choose the same board size.
      </p>
    </section>
  );
}
