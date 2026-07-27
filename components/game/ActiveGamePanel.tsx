"use client";

import { LogOut, Play, Swords } from "lucide-react";
import type { BoardSize } from "@/lib/game/types";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";

type ActiveGamePanelProps = {
  boardSize: BoardSize;
  busy: boolean;
  error: string | null;
  onLeave: () => void;
  onResume: () => void;
};

export function ActiveGamePanel({
  boardSize,
  busy,
  error,
  onLeave,
  onResume,
}: ActiveGamePanelProps) {
  return (
    <section className="active-game-panel" aria-live="polite">
      <div className="panel-heading">
        <div>
          <span className="panel-icon"><Swords size={18} /></span>
          <div>
            <h2>Game in progress</h2>
            <p>Choose whether you want to continue or leave it.</p>
          </div>
        </div>
        <Badge tone="green">Active</Badge>
      </div>

      <div className="active-game-summary">
        <span>Board</span>
        <strong>{boardSize}×{boardSize}</strong>
        <p>Leaving an active game counts as a resignation.</p>
      </div>

      <div className="active-game-actions">
        <Button disabled={busy} onClick={onResume} size="lg">
          <Play size={19} />
          Continue game
        </Button>
        <Button disabled={busy} onClick={onLeave} size="lg" variant="secondary">
          <LogOut size={19} />
          Leave game
        </Button>
      </div>
      {error ? <p className="match-error">{error}</p> : null}
    </section>
  );
}
