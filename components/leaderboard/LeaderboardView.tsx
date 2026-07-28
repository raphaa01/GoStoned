"use client";

import { Medal, Trophy } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/components/i18n/I18nProvider";
import { readApi } from "@/lib/client/api";
import type { BoardSize } from "@/lib/game/types";
import { localizedApiError } from "@/lib/i18n/dictionary";
import {
  parsePublicLeaderboardSnapshot,
  type LeaderboardEntry,
} from "@/lib/stats/leaderboardContract";

export function LeaderboardView() {
  const { dictionary, locale } = useI18n();
  const copy = dictionary.leaderboard;
  const [boardSize, setBoardSize] = useState<BoardSize>(19);
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [observedAt, setObservedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [requestKey, setRequestKey] = useState(0);
  const resultStatusRef = useRef<HTMLParagraphElement>(null);
  const focusRetryStatus = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    void (async () => {
      try {
        const response = await fetch(`/api/stats?boardSize=${boardSize}`, {
          signal: controller.signal,
        });
        const body = await readApi<unknown>(response);
        if (!active) return;
        const snapshot = parsePublicLeaderboardSnapshot(body, boardSize);
        setEntries(snapshot.leaderboard);
        setObservedAt(snapshot.observedAt);
        setError(null);
      } catch (requestError) {
        if (!active || controller.signal.aborted) return;
        setEntries([]);
        setObservedAt(null);
        setError(localizedApiError(dictionary, requestError, copy.loadFailed));
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
      controller.abort();
    };
  }, [boardSize, copy.loadFailed, dictionary, requestKey]);

  useEffect(() => {
    if (!focusRetryStatus.current) return;
    resultStatusRef.current?.focus();
    if (!loading) focusRetryStatus.current = false;
  }, [error, loading, observedAt]);

  const snapshotSummary = observedAt
    ? copy.snapshotSummary
      .replace("{size}", String(boardSize))
      .replace("{count}", String(entries.length))
      .replace(
        "{time}",
        new Intl.DateTimeFormat(locale, {
          dateStyle: "medium",
          timeStyle: "short",
        }).format(new Date(observedAt)),
      )
    : null;
  const tableLabel = copy.tableScrollLabel.replace("{size}", String(boardSize));
  const selectBoardSize = (size: BoardSize) => {
    if (size === boardSize) return;
    setLoading(true);
    setError(null);
    setEntries([]);
    setObservedAt(null);
    setBoardSize(size);
  };
  const retry = () => {
    focusRetryStatus.current = true;
    setLoading(true);
    setError(null);
    setEntries([]);
    setObservedAt(null);
    setRequestKey((value) => value + 1);
  };

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
              onClick={() => selectBoardSize(size)}
              type="button"
            >
              {size}×{size}
            </button>
          ))}
        </div>
      </header>

      <section className="leaderboard-card">
        <div className="leaderboard-title"><Trophy aria-hidden="true" size={20} /><strong>{boardSize}×{boardSize} {copy.players}</strong></div>
        <p className="leaderboard-method">{copy.ratingMethod}</p>
        {loading ? (
          <p
            aria-live="polite"
            className="empty-state"
            ref={resultStatusRef}
            role="status"
            tabIndex={-1}
          >
            {copy.loading}
          </p>
        ) : error ? (
          <div className="empty-state" role="alert">
            <p ref={resultStatusRef} tabIndex={-1}>{error}</p>
            <button className="button button--secondary" onClick={retry} type="button">
              {copy.retry}
            </button>
          </div>
        ) : (
          <>
            {entries.length === 0 ? (
              <p className="empty-state">{copy.empty}</p>
            ) : (
              <div
                aria-label={tableLabel}
                className="leaderboard-table"
                role="region"
                tabIndex={0}
              >
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
                    {entries.map((entry) => (
                      <tr key={entry.position}>
                        <td>
                          <span className={`rank rank--${entry.position}`}>
                            <span className="sr-only">{entry.position}</span>
                            {entry.position <= 3
                              ? <Medal aria-hidden="true" size={18} />
                              : <span aria-hidden="true">{entry.position}</span>}
                          </span>
                        </td>
                        <th scope="row">{entry.playerName}</th>
                        <td>{entry.games}</td>
                        <td>{entry.wins}</td>
                        <td><strong>{entry.rating}</strong></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {snapshotSummary ? (
              <p
                aria-atomic="true"
                aria-live="polite"
                className="leaderboard-snapshot"
                ref={resultStatusRef}
                role="status"
                tabIndex={-1}
              >
                {snapshotSummary}
              </p>
            ) : null}
          </>
        )}
      </section>
    </>
  );
}
