"use client";

import { Radio, Search, Users } from "lucide-react";
import { useState } from "react";
import type { BoardSize } from "@/lib/game/types";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";

export function MatchmakingPanel({ boardSize }: { boardSize: BoardSize }) {
  const [state, setState] = useState<"idle" | "searching" | "ready">("idle");

  async function findMatch() {
    setState("searching");
    try {
      await fetch(`/api/matchmaking?boardSize=${boardSize}`);
      setState("ready");
    } catch {
      setState("idle");
    }
  }

  return (
    <section className="matchmaking-panel">
      <div className="panel-heading">
        <div>
          <span className="panel-icon"><Radio size={18} /></span>
          <div>
            <h2>Quick match</h2>
            <p>Find a player near your level.</p>
          </div>
        </div>
        <Badge tone="green">Live soon</Badge>
      </div>

      <div className="match-settings">
        <div>
          <span>Board</span>
          <strong>{boardSize}×{boardSize}</strong>
        </div>
        <div>
          <span>Time</span>
          <strong>{boardSize === 9 ? "5 + 3×20s" : "10 + 5×30s"}</strong>
        </div>
        <div>
          <span>Rules</span>
          <strong>Japanese</strong>
        </div>
      </div>

      <Button
        className="match-button"
        disabled={state === "searching"}
        onClick={findMatch}
        size="lg"
      >
        {state === "searching" ? <Search className="spin" size={20} /> : <Users size={20} />}
        {state === "idle"
          ? "Find an opponent"
          : state === "searching"
            ? "Joining queue…"
            : "Matchmaking is ready"}
      </Button>
      <p className="panel-note">
        {state === "ready"
          ? "The API boundary is connected. Live queue persistence comes next."
          : "Guests can play instantly. Sign in later to keep your rating."}
      </p>
    </section>
  );
}
