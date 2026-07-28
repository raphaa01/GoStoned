"use client";

import { LogOut, Play, Swords } from "lucide-react";
import { useI18n } from "@/components/i18n/I18nProvider";
import type { BoardSize, TimeControlId } from "@/lib/game/types";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";

type ActiveGamePanelProps = {
  boardSize: BoardSize;
  timeControl: TimeControlId;
  busy: boolean;
  error: string | null;
  onLeave: () => void;
  onResume: () => void;
};

export function ActiveGamePanel({
  boardSize,
  timeControl,
  busy,
  error,
  onLeave,
  onResume,
}: ActiveGamePanelProps) {
  const { dictionary } = useI18n();
  const copy = dictionary.play;
  return (
    <section className="active-game-panel" aria-live="polite">
      <div className="panel-heading">
        <div>
          <span className="panel-icon"><Swords size={18} /></span>
          <div>
            <h2>{copy.activeTitle}</h2>
            <p>{copy.activeDescription}</p>
          </div>
        </div>
        <Badge tone="green">{copy.active}</Badge>
      </div>

      <div className="active-game-summary">
        <span>{copy.board}</span>
        <strong>{boardSize}×{boardSize} · {dictionary.timeControls[timeControl].name}</strong>
        <p>{copy.leavingResigns}</p>
      </div>

      <div className="active-game-actions">
        <Button disabled={busy} onClick={onResume} size="lg">
          <Play size={19} />
          {copy.continueGame}
        </Button>
        <Button disabled={busy} onClick={onLeave} size="lg" variant="secondary">
          <LogOut size={19} />
          {copy.leaveGame}
        </Button>
      </div>
      {error ? <p className="match-error">{error}</p> : null}
    </section>
  );
}
