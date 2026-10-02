"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { useI18n } from "@/components/i18n/I18nProvider";
import { readApi } from "@/lib/client/api";
import { localizedApiError } from "@/lib/i18n/dictionary";
import { getRecentGameRatingPresentation } from "@/lib/stats/ratingPresentation";
import type { RecentGame } from "@/lib/stats/statsService";
import styles from "./review.module.css";

function signed(value: number) {
  const rounded = Math.round(value);
  return rounded > 0 ? `+${rounded}` : String(rounded);
}

export function ReviewGuide() {
  const { user } = useAuth();
  const { dictionary, href, locale } = useI18n();
  const copy = dictionary.analysisReview;
  const [games, setGames] = useState<RecentGame[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryRevision, setRetryRevision] = useState(0);

  useEffect(() => {
    if (!user) return;
    const controller = new AbortController();
    let active = true;
    fetch("/api/profile", { cache: "no-store", signal: controller.signal })
      .then((response) => readApi<{ recentGames?: RecentGame[] }>(response))
      .then((body) => {
        if (!active) return;
        setGames((body.recentGames ?? []).filter((game) => game.moveCount > 0));
        setError(null);
      })
      .catch((loadError: unknown) => {
        if (!active || controller.signal.aborted) return;
        setError(localizedApiError(dictionary, loadError, dictionary.apiErrors.internal_error));
      })
      .finally(() => {
        if (active) setLoaded(true);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [dictionary, retryRevision, user]);

  return (
    <div className={styles.hub}>
      <header className={styles.hero}>
        <h1 className="product-page-title">{dictionary.nav.review}</h1>
      </header>

      {user ? (
        <section className={styles.gamePicker} aria-labelledby="review-games-title">
          <div className={styles.sectionHeading}>
            <h2 id="review-games-title">{copy.recent}</h2>
            <Link href={href("/play")}>{copy.play}</Link>
          </div>
          {!loaded ? <div className={styles.loading} role="status">…</div> : error ? (
            <div className={styles.empty} role="alert">
              <p>{error}</p>
              <button className="button button--secondary" onClick={() => {
                setLoaded(false);
                setError(null);
                setRetryRevision((current) => current + 1);
              }} type="button">{copy.retry}</button>
            </div>
          ) : games.length === 0 ? (
            <p className={styles.empty}>{copy.empty}</p>
          ) : (
            <div className={styles.gameList}>
              {games.map((game) => {
                const rating = getRecentGameRatingPresentation(game);
                return (
                  <Link className={styles.gameRow} href={href(`/review/${game.gameId}`)} key={game.gameId}>
                    <span className={`${styles.result} ${styles[game.result]}`}>{game.result === "win" ? copy.winShort : game.result === "loss" ? copy.lossShort : copy.drawShort}</span>
                    <span>
                      <strong>{game.opponentName}</strong>
                      <small>{game.boardSize}×{game.boardSize} · {dictionary.timeControls[game.timeControl].name} · {new Date(game.finishedAt).toLocaleDateString(locale)}</small>
                      <small>{game.gameResult ?? copy.finished}</small>
                    </span>
                    <span className={rating.kind === "change" && rating.value > 0 ? "is-positive" : rating.kind === "change" && rating.value < 0 ? "is-negative" : styles.open}>
                      {rating.kind === "change" ? signed(rating.value) : copy.analyze}
                    </span>
                  </Link>
                );
              })}
            </div>
          )}
        </section>
      ) : null}
    </div>
  );
}
