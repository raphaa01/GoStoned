"use client";

import { Medal, Trophy } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { BoardSize } from "@/lib/game/types";

type LeaderboardEntry = {
  player_name: string;
  board_size: BoardSize;
  games: number;
  wins: number;
  losses: number;
  draws: number;
  rating: number;
};

export function LeaderboardView() {
  const [boardSize, setBoardSize] = useState<BoardSize>(19);
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/stats?boardSize=${boardSize}`, { cache: "no-store" });
      const body = (await response.json()) as { ok: boolean; leaderboard?: LeaderboardEntry[] };
      setEntries(response.ok && body.ok ? body.leaderboard ?? [] : []);
    } finally {
      setLoading(false);
    }
  }, [boardSize]);

  useEffect(() => {
    const timeout = window.setTimeout(() => load().catch(() => setLoading(false)), 0);
    return () => window.clearTimeout(timeout);
  }, [load]);

  return (
    <>
      <header className="page-header">
        <div>
          <span className="section-kicker">Global rankings</span>
          <h1>Leaderboard</h1>
          <p>Ratings are updated when a saved game finishes.</p>
        </div>
        <div className="leaderboard-filter" aria-label="Board size">
          {([9, 13, 19] as const).map((size) => (
            <button
              className={boardSize === size ? "is-selected" : ""}
              key={size}
              onClick={() => setBoardSize(size)}
              type="button"
            >
              {size}×{size}
            </button>
          ))}
        </div>
      </header>

      <section className="leaderboard-card">
        <div className="leaderboard-title"><Trophy size={20} /><strong>{boardSize}×{boardSize} players</strong></div>
        {loading ? (
          <p className="empty-state">Loading rankings…</p>
        ) : entries.length === 0 ? (
          <p className="empty-state">No rated games on this board yet. The first completed match will appear here.</p>
        ) : (
          <div className="leaderboard-table">
            <div className="leaderboard-row leaderboard-row--head">
              <span>Rank</span><span>Player</span><span>Games</span><span>Wins</span><span>Rating</span>
            </div>
            {entries.map((entry, index) => (
              <div className="leaderboard-row" key={`${entry.player_name}-${index}`}>
                <span className={`rank rank--${index + 1}`}>{index < 3 ? <Medal size={18} /> : index + 1}</span>
                <strong>{entry.player_name}</strong>
                <span>{entry.games}</span>
                <span>{entry.wins}</span>
                <strong>{entry.rating}</strong>
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
