"use client";

import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  CalendarDays,
  Gamepad2,
  LogIn,
  Minus,
  Trophy,
  UserRoundPlus,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { useI18n } from "@/components/i18n/I18nProvider";
import { RatingHistoryChart } from "@/components/profile/RatingHistoryChart";
import { readApi } from "@/lib/client/api";
import type { BoardSize } from "@/lib/game/types";
import { localizedApiError } from "@/lib/i18n/dictionary";
import type {
  ProfileStat,
  RatingHistoryEntry,
  RecentGame,
} from "@/lib/stats/statsService";

const BOARD_SIZES: BoardSize[] = [9, 13, 19];

type ProfileResponse = {
  stats?: ProfileStat[];
  history?: RatingHistoryEntry[];
  recentGames?: RecentGame[];
};

function signedRating(value: number) {
  return value > 0 ? `+${value}` : String(value);
}

function formatDate(value: string, locale: "en" | "de") {
  return new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

export function ProfileView() {
  const { user, loading } = useAuth();
  const { dictionary, href, locale } = useI18n();
  const copy = dictionary.profile;
  const [stats, setStats] = useState<ProfileStat[]>([]);
  const [history, setHistory] = useState<RatingHistoryEntry[]>([]);
  const [recentGames, setRecentGames] = useState<RecentGame[]>([]);
  const [selectedBoardSize, setSelectedBoardSize] = useState<BoardSize>(19);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) {
      const timeout = window.setTimeout(() => setLoaded(true), 0);
      return () => window.clearTimeout(timeout);
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      fetch("/api/profile", { cache: "no-store", signal: controller.signal })
        .then((response) => readApi<ProfileResponse>(response))
        .then((body) => {
          setStats(body.stats ?? []);
          setHistory(body.history ?? []);
          setRecentGames(body.recentGames ?? []);
          setError(null);
        })
        .catch((requestError: unknown) => {
          if (!controller.signal.aborted) {
            setError(localizedApiError(dictionary, requestError, copy.loadFailed));
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoaded(true);
        });
    }, 0);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [copy.loadFailed, dictionary, user]);

  const bySize = useMemo(
    () => new Map(stats.map((stat) => [stat.boardSize, stat])),
    [stats],
  );
  const selectedStat = bySize.get(selectedBoardSize);
  const selectedHistory = history.filter((entry) => entry.boardSize === selectedBoardSize);
  const selectedGames = recentGames.filter((game) => game.boardSize === selectedBoardSize);
  const recentForm = selectedGames.slice(0, 10);
  const thirtyDayChange = selectedStat?.ratingChange30Days ?? 0;
  const profileStatus = (
    <p aria-atomic="true" aria-live="polite" className="sr-only" role="status">
      {loading || !loaded ? copy.loading : copy.loadComplete}
    </p>
  );

  if (loading || !loaded) {
    return (
      <>
        {profileStatus}
        <div aria-hidden="true" className="profile-loading">{copy.loading}</div>
      </>
    );
  }

  if (!user) {
    return (
      <>
        {profileStatus}
        <section className="profile-guest">
          <span className="profile-avatar"><UserRoundPlus size={34} /></span>
          <h1>{copy.guestTitle}</h1>
          <p>{copy.guestDescription}</p>
          <div>
            <Link className="button button--primary button--lg" href={href("/register")}>{copy.createAccount}</Link>
            <Link className="button button--secondary button--lg" href={href("/login")}><LogIn size={18} /> {copy.login}</Link>
          </div>
        </section>
      </>
    );
  }

  return (
    <>
      {profileStatus}
      <header className="profile-header">
        <span className="profile-avatar">{user.displayName.slice(0, 2).toUpperCase()}</span>
        <div>
          <span className="section-kicker">{copy.playerProfile}</span>
          <h1>{user.displayName}</h1>
          <p>@{user.username}</p>
        </div>
        <Link className="button button--primary" href={href("/play")}><Gamepad2 size={18} /> {copy.play}</Link>
      </header>

      {error ? <div className="profile-error" role="alert">{error}</div> : null}

      <section aria-label={copy.ratingsLabel} className="rating-grid">
        {BOARD_SIZES.map((size) => {
          const stat = bySize.get(size);
          const selected = selectedBoardSize === size;
          return (
            <button
              aria-pressed={selected}
              className={selected ? "rating-card rating-card--selected" : "rating-card"}
              key={size}
              onClick={() => setSelectedBoardSize(size)}
              type="button"
            >
              <span>{size}×{size}</span>
              <strong>{stat?.rating ?? 1200}</strong>
              <small>{stat?.games ?? 0} {copy.games} · {stat?.wins ?? 0} {copy.wins}</small>
            </button>
          );
        })}
      </section>

      <section className="profile-statistics">
        <div className="profile-statistics__heading">
          <div>
            <span className="section-kicker">{selectedBoardSize}×{selectedBoardSize} {copy.performance}</span>
            <h2>{copy.ratingOverTime}</h2>
          </div>
          <div className="profile-period">{copy.last30Days}</div>
        </div>

        <div className="profile-metrics">
          <article>
            <Activity size={18} />
            <span>{copy.currentRating}</span>
            <strong>{selectedStat?.rating ?? 1200}</strong>
          </article>
          <article>
            <Trophy size={18} />
            <span>{copy.personalBest}</span>
            <strong>{selectedStat?.highestRating ?? 1200}</strong>
          </article>
          <article>
            {thirtyDayChange > 0
              ? <ArrowUpRight size={18} />
              : thirtyDayChange < 0
                ? <ArrowDownRight size={18} />
                : <Minus size={18} />}
            <span>{copy.ratingChange}</span>
            <strong className={thirtyDayChange > 0 ? "is-positive" : thirtyDayChange < 0 ? "is-negative" : ""}>
              {signedRating(thirtyDayChange)}
            </strong>
          </article>
          <article>
            <CalendarDays size={18} />
            <span>{copy.recentForm}</span>
            <div className="recent-form" aria-label={copy.recentFormLabel}>
              {recentForm.length > 0
                ? recentForm.map((game) => (
                    <i className={`result-dot result-dot--${game.result}`} key={game.gameId}>
                      {game.result === "win" ? copy.winShort : game.result === "loss" ? copy.lossShort : copy.drawShort}
                    </i>
                  ))
                : <strong>—</strong>}
            </div>
          </article>
        </div>

        <RatingHistoryChart
          currentRating={selectedStat?.rating ?? 1200}
          history={selectedHistory}
        />
      </section>

      <section className="profile-history" id="game-history">
        <div className="profile-history__heading">
          <div>
            <span className="section-kicker">{copy.history}</span>
            <h2>{copy.recentGames} · {selectedBoardSize}×{selectedBoardSize}</h2>
          </div>
          <span>{selectedGames.length} {copy.shown}</span>
        </div>
        {selectedGames.length > 0 ? (
          <div className="profile-history__list">
            {selectedGames.slice(0, 12).map((game) => (
              <Link
                className="history-game"
                href={href(`/game/${game.gameId}`)}
                key={game.gameId}
              >
                <span className={`history-game__result history-game__result--${game.result}`}>
                  {game.result === "win" ? copy.winShort : game.result === "loss" ? copy.lossShort : copy.drawShort}
                </span>
                <div>
                  <strong>{game.result === "win" ? copy.victory : game.result === "loss" ? copy.defeat : copy.draw} {copy.versus} {game.opponentName}</strong>
                  <span>{formatDate(game.finishedAt, locale)} · {dictionary.timeControls[game.timeControl].name} · {game.gameResult ?? copy.completed}</span>
                </div>
                <strong className={game.ratingChange && game.ratingChange > 0 ? "is-positive" : game.ratingChange && game.ratingChange < 0 ? "is-negative" : ""}>
                  {game.ratingChange === null ? copy.recorded : signedRating(game.ratingChange)}
                </strong>
              </Link>
            ))}
          </div>
        ) : (
          <div className="profile-history__empty">
            {copy.historyEmptyPrefix} {selectedBoardSize}×{selectedBoardSize} {copy.historyEmptySuffix}
          </div>
        )}
      </section>
    </>
  );
}
