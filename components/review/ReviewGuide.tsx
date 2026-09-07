"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { useI18n } from "@/components/i18n/I18nProvider";
import { readApi } from "@/lib/client/api";
import type { RecentGame } from "@/lib/stats/statsService";
import styles from "./review.module.css";

export function ReviewGuide() {
  const { user } = useAuth();
  const { dictionary, href, locale } = useI18n();
  const copy = dictionary.analysisReview;
  const [games, setGames] = useState<RecentGame[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!user) return;
    const controller = new AbortController();
    let active = true;
    fetch("/api/profile", { cache: "no-store", signal: controller.signal })
      .then((response) => readApi<{ recentGames?: RecentGame[] }>(response))
      .then((body) => {
        if (active) setGames((body.recentGames ?? []).filter((game) => game.moveCount > 0));
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setLoaded(true);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [user]);

  return (
    <div className={styles.hub}>
      <header className={styles.hero}>
        <h1>{dictionary.nav.review}</h1>
      </header>

      {user ? (
        <section className={styles.gamePicker} aria-labelledby="review-games-title">
          <div className={styles.sectionHeading}>
            <h2 id="review-games-title">{copy.recent}</h2>
            <Link href={href("/play")}>{copy.play}</Link>
          </div>
          {!loaded ? <div className={styles.loading} role="status">…</div> : games.length === 0 ? (
            <p className={styles.empty}>{copy.empty}</p>
          ) : (
            <div className={styles.gameList}>
              {games.map((game) => (
                <Link className={styles.gameRow} href={href(`/review/${game.gameId}`)} key={game.gameId}>
                  <span className={`${styles.result} ${styles[game.result]}`}>{game.result === "win" ? copy.winShort : game.result === "loss" ? copy.lossShort : copy.drawShort}</span>
                  <span><strong>{game.boardSize}×{game.boardSize} {copy.versus} {game.opponentName}</strong><small>{new Date(game.finishedAt).toLocaleDateString(locale)} · {game.gameResult ?? copy.finished}</small></span>
                  <span className={styles.open}>{copy.analyze}</span>
                </Link>
              ))}
            </div>
          )}
        </section>
      ) : null}
    </div>
  );
}
