"use client";

import { Medal, Trophy } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useI18n } from "@/components/i18n/I18nProvider";
import { readApi } from "@/lib/client/api";
import type { BoardSize } from "@/lib/game/types";
import { localizedApiError } from "@/lib/i18n/dictionary";

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
  const { dictionary } = useI18n();
  const copy = dictionary.leaderboard;
  const [boardSize, setBoardSize] = useState<BoardSize>(19);
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/stats?boardSize=${boardSize}`, { cache: "no-store" });
      const body = await readApi<{ leaderboard: LeaderboardEntry[] }>(response);
      setEntries(body.leaderboard);
    } catch (requestError) {
      setEntries([]);
      setError(localizedApiError(dictionary, requestError, copy.loadFailed));
    } finally {
      setLoading(false);
    }
  }, [boardSize, copy.loadFailed, dictionary]);

  useEffect(() => {
    const timeout = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timeout);
  }, [load]);

  return (
    <>
      <header className="page-header">
        <div>
          <span className="section-kicker">{copy.kicker}</span>
          <h1>{copy.title}</h1>
          <p>{copy.description}</p>
        </div>
        <div className="leaderboard-filter" aria-label={copy.boardSize}>
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
        <div className="leaderboard-title"><Trophy size={20} /><strong>{boardSize}×{boardSize} {copy.players}</strong></div>
        {loading ? (
          <p className="empty-state">{copy.loading}</p>
        ) : error ? (
          <div className="empty-state" role="alert">
            <p>{error}</p>
            <button className="button button--secondary" onClick={() => void load()} type="button">
              {copy.retry}
            </button>
          </div>
        ) : entries.length === 0 ? (
          <p className="empty-state">{copy.empty}</p>
        ) : (
          <div className="leaderboard-table">
            <div className="leaderboard-row leaderboard-row--head">
              <span>{copy.rank}</span><span>{copy.player}</span><span>{copy.games}</span><span>{copy.wins}</span><span>{copy.rating}</span>
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
