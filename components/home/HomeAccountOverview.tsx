"use client";

import Link from "next/link";
import { useCallback } from "react";
import { useI18n } from "@/components/i18n/I18nProvider";
import type { ProfileResponse } from "@/components/profile/ProfileView";
import { RatingLabel } from "@/components/rating/RatingLabel";
import { useRouteResource } from "@/components/useRouteResource";
import { readApi } from "@/lib/client/api";
import { routeCacheKey } from "@/lib/client/routeCache";
import { getMobileCopy } from "@/lib/i18n/mobile";
import { getRecentGameRatingPresentation } from "@/lib/stats/ratingPresentation";

function signed(value: number, locale: string) {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 0, signDisplay: "exceptZero" }).format(value);
}

function changeClass(value: number) {
  return value > 0 ? "is-positive" : value < 0 ? "is-negative" : "";
}

export function HomeAccountOverview({ playerKey }: { playerKey: string }) {
  const { dictionary, href, locale } = useI18n();
  const copy = getMobileCopy(locale);
  const loadProfile = useCallback(() => fetch("/api/profile", { cache: "no-store" }).then(readApi<ProfileResponse>), []);
  const { data } = useRouteResource(routeCacheKey("profile", playerKey), loadProfile);
  if (!data) return null;
  const games = data.recentGames?.slice(0, 3) ?? [];
  const rating = data.rating;

  return (
    <>
      {rating && data.preferences ? (
        <section className="home-section">
          <h2>{copy.statistics}</h2>
          <dl className="home-stats">
            <div><dt>{copy.rating}</dt><dd><RatingLabel locale={locale} preference={data.preferences.displayPreference === "both" ? "rating-primary" : data.preferences.displayPreference} rating={rating.rating} /></dd></div>
            <div><dt>{copy.ratedGames}</dt><dd>{rating.ratedGameCount}</dd></div>
            <div><dt>{copy.lastThirtyDays}</dt><dd className={changeClass(rating.ratingChange30Days)}>{signed(rating.ratingChange30Days, locale)}</dd></div>
          </dl>
        </section>
      ) : null}
      <section className="home-section">
        <header className="home-section__heading">
          <h2>{copy.recentGames}</h2>
          <Link href={href("/profile#game-history")}>{copy.allGames}</Link>
        </header>
        {games.length ? (
          <div className="home-games">
            {games.map((game) => {
              const presented = getRecentGameRatingPresentation(game);
              const result = game.result === "win" ? copy.won : game.result === "loss" ? copy.lost : game.result === "draw" ? copy.draw : copy.noResult;
              return (
                <Link href={href(`/game/${game.gameId}`)} key={game.gameId}>
                  <span aria-hidden="true" className={`home-games__result is-${game.result}`}>{game.result === "win" || game.result === "loss" ? result[0] : "–"}</span>
                  <span><strong>{game.opponentName}</strong><small>{game.boardSize}×{game.boardSize} · {dictionary.timeControls[game.timeControl].name} · {result}</small></span>
                  {presented.kind === "change" ? <b className={changeClass(presented.value)}>{signed(presented.value, locale)}</b> : null}
                </Link>
              );
            })}
          </div>
        ) : <p className="home-games-empty">{copy.noRecentGames}</p>}
      </section>
    </>
  );
}
