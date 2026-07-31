"use client";

import { Medal, Trophy } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/components/i18n/I18nProvider";
import { useAuth } from "@/components/auth/AuthProvider";
import { readApi } from "@/lib/client/api";
import { localizedApiError } from "@/lib/i18n/dictionary";
import { presentRating } from "@/lib/rating/rankPolicy";
import type { RatingDisplayPreference } from "@/lib/rating/rankPolicy";
import {
  parsePublicLeaderboardSnapshot,
  type LeaderboardEntry,
} from "@/lib/stats/leaderboardContract";

export function LeaderboardView() {
  const { user } = useAuth();
  const { dictionary, locale } = useI18n();
  const copy = dictionary.leaderboard;
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [observedAt, setObservedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [requestKey, setRequestKey] = useState(0);
  const [viewerPreference, setViewerPreference] = useState<{
    displayPreference: RatingDisplayPreference;
    playerKey: string;
  } | null>(null);
  const resultStatusRef = useRef<HTMLParagraphElement>(null);
  const focusRetryStatus = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    void (async () => {
      try {
        const response = await fetch("/api/stats", {
          signal: controller.signal,
        });
        const body = await readApi<unknown>(response);
        if (!active) return;
        const snapshot = parsePublicLeaderboardSnapshot(body);
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
  }, [copy.loadFailed, dictionary, requestKey]);

  useEffect(() => {
    if (!user) return;
    const controller = new AbortController();
    void fetch("/api/profile/preferences", { signal: controller.signal })
      .then((response) => readApi<{ preferences: { displayPreference: RatingDisplayPreference } }>(response))
      .then((body) => setViewerPreference({
        displayPreference: body.preferences.displayPreference,
        playerKey: user.playerKey,
      }))
      .catch(() => undefined);
    return () => controller.abort();
  }, [user]);

  useEffect(() => {
    if (!focusRetryStatus.current) return;
    resultStatusRef.current?.focus();
    if (!loading) focusRetryStatus.current = false;
  }, [error, loading, observedAt]);

  const snapshotSummary = observedAt
    ? copy.snapshotSummary
      .replace("{size}", copy.globalScope)
      .replace("{count}", String(entries.length))
      .replace(
        "{time}",
        new Intl.DateTimeFormat(locale, {
          dateStyle: "medium",
          timeStyle: "short",
        }).format(new Date(observedAt)),
      )
    : null;
  const tableLabel = copy.tableScrollLabel.replace("{size}", copy.globalScope);
  const displayPreference = viewerPreference && viewerPreference.playerKey === user?.playerKey
    ? viewerPreference.displayPreference
    : "both";
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
      </header>

      <section className="leaderboard-card">
        <div className="leaderboard-title"><Trophy aria-hidden="true" size={20} /><strong>{copy.globalScope} · {copy.players}</strong></div>
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
                    {copy.globalScope} · {copy.players}. {copy.resultCount.replace("{count}", String(entries.length))}
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
                        <td>
                          <strong>{presentRating(
                            entry.rating,
                            displayPreference,
                            locale === "de" ? "de" : "en",
                          ).primaryLabel}</strong>
                          <small className="leaderboard-rating-detail">±{Math.round(entry.ratingDeviation)}</small>
                        </td>
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
