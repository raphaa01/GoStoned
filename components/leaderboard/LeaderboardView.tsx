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
        <div className="leaderboard-filter" aria-label={copy.boardSize} role="group">
          {([9, 13, 19] as const).map((size) => (
            <button
              className={boardSize === size ? "is-selected" : ""}
              aria-pressed={boardSize === size}
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
          <p aria-live="polite" className="empty-state" role="status">{copy.loading}</p>
        ) : error ? (
          <div className="empty-state" role="alert">
            <p>{error}</p>
            <button className="button button--secondary" onClick={() => void load()} type="button">
              {copy.retry}
            </button>
          </div>
        ) : entries.length === 0 ? (
          <p aria-live="polite" className="empty-state" role="status">{copy.empty}</p>
        ) : (
          <div className="leaderboard-table">
            <table>
              <caption className="sr-only">
                {boardSize}×{boardSize} {copy.players}. {copy.resultCount.replace("{count}", String(entries.length))}
              </caption>
              <thead>
                <tr>
                  <th scope="col">{copy.rank}</th>
                  <th scope="col">{copy.player}</th>
                  <th scope="col">{copy.games}</th>
                  <th scope="col">{copy.wins}</th>
                  <th scope="col">{copy.rating}</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry, index) => (
                  <tr key={`${entry.player_name}-${index}`}>
                    <td>
                      <span className={`rank rank--${index + 1}`}>
                        <span className="sr-only">{index + 1}</span>
                        {index < 3 ? <Medal aria-hidden="true" size={18} /> : <span aria-hidden="true">{index + 1}</span>}
                      </span>
                    </td>
                    <th scope="row">{entry.player_name}</th>
                    <td>{entry.games}</td>
                    <td>{entry.wins}</td>
                    <td><strong>{entry.rating}</strong></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p aria-live="polite" className="sr-only" role="status">
              {copy.resultCount.replace("{count}", String(entries.length))}
            </p>
          </div>
        )}
      </section>
    </>
  );
}
