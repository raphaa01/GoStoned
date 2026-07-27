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
import { RatingHistoryChart } from "@/components/profile/RatingHistoryChart";
import type { BoardSize } from "@/lib/game/types";
import type {
  ProfileStat,
  RatingHistoryEntry,
  RecentGame,
} from "@/lib/stats/statsService";

const BOARD_SIZES: BoardSize[] = [9, 13, 19];

type ProfileResponse = {
  ok: boolean;
  stats?: ProfileStat[];
  history?: RatingHistoryEntry[];
  recentGames?: RecentGame[];
  error?: string;
};

function signedRating(value: number) {
  return value > 0 ? `+${value}` : String(value);
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

export function ProfileView() {
  const { user, loading } = useAuth();
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
        .then(async (response) => {
          const body = (await response.json()) as ProfileResponse;
          if (!response.ok || !body.ok) {
            throw new Error(body.error ?? "Could not load your statistics.");
          }
          setStats(body.stats ?? []);
          setHistory(body.history ?? []);
          setRecentGames(body.recentGames ?? []);
          setError(null);
        })
        .catch((requestError: unknown) => {
          if (!controller.signal.aborted) {
            setError(
              requestError instanceof Error
                ? requestError.message
                : "Could not load your statistics.",
            );
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
  }, [user]);

  const bySize = useMemo(
    () => new Map(stats.map((stat) => [stat.boardSize, stat])),
    [stats],
  );
  const selectedStat = bySize.get(selectedBoardSize);
  const selectedHistory = history.filter((entry) => entry.boardSize === selectedBoardSize);
  const selectedGames = recentGames.filter((game) => game.boardSize === selectedBoardSize);
  const recentForm = selectedGames.slice(0, 10);
  const thirtyDayChange = selectedStat?.ratingChange30Days ?? 0;

  if (loading || !loaded) return <div className="profile-loading">Loading profile…</div>;

  if (!user) {
    return (
      <section className="profile-guest">
        <span className="profile-avatar"><UserRoundPlus size={34} /></span>
        <h1>Save your Go progress.</h1>
        <p>Create an account to keep ratings and completed games under one username.</p>
        <div>
          <Link className="button button--primary button--lg" href="/register">Create account</Link>
          <Link className="button button--secondary button--lg" href="/login"><LogIn size={18} /> Log in</Link>
        </div>
      </section>
    );
  }

  return (
    <>
      <header className="profile-header">
        <span className="profile-avatar">{user.displayName.slice(0, 2).toUpperCase()}</span>
        <div>
          <span className="section-kicker">Player profile</span>
          <h1>{user.displayName}</h1>
          <p>@{user.username}</p>
        </div>
        <Link className="button button--primary" href="/play"><Gamepad2 size={18} /> Play</Link>
      </header>

      {error ? <div className="profile-error" role="alert">{error}</div> : null}

      <section aria-label="Ratings by board size" className="rating-grid">
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
              <small>{stat?.games ?? 0} games · {stat?.wins ?? 0} wins</small>
            </button>
          );
        })}
      </section>

      <section className="profile-statistics">
        <div className="profile-statistics__heading">
          <div>
            <span className="section-kicker">{selectedBoardSize}×{selectedBoardSize} performance</span>
            <h2>Rating over time</h2>
          </div>
          <div className="profile-period">Last 30 days</div>
        </div>

        <div className="profile-metrics">
          <article>
            <Activity size={18} />
            <span>Current rating</span>
            <strong>{selectedStat?.rating ?? 1200}</strong>
          </article>
          <article>
            <Trophy size={18} />
            <span>Personal best</span>
            <strong>{selectedStat?.highestRating ?? 1200}</strong>
          </article>
          <article>
            {thirtyDayChange > 0
              ? <ArrowUpRight size={18} />
              : thirtyDayChange < 0
                ? <ArrowDownRight size={18} />
                : <Minus size={18} />}
            <span>Rating change</span>
            <strong className={thirtyDayChange > 0 ? "is-positive" : thirtyDayChange < 0 ? "is-negative" : ""}>
              {signedRating(thirtyDayChange)}
            </strong>
          </article>
          <article>
            <CalendarDays size={18} />
            <span>Recent form</span>
            <div className="recent-form" aria-label="Results of the last ten games">
              {recentForm.length > 0
                ? recentForm.map((game) => (
                    <i className={`result-dot result-dot--${game.result}`} key={game.gameId}>
                      {game.result === "win" ? "W" : game.result === "loss" ? "L" : "D"}
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

      <section className="profile-history">
        <div className="profile-history__heading">
          <div>
            <span className="section-kicker">Game history</span>
            <h2>Recent {selectedBoardSize}×{selectedBoardSize} games</h2>
          </div>
          <span>{selectedGames.length} shown</span>
        </div>
        {selectedGames.length > 0 ? (
          <div className="profile-history__list">
            {selectedGames.slice(0, 12).map((game) => (
              <article className="history-game" key={game.gameId}>
                <span className={`history-game__result history-game__result--${game.result}`}>
                  {game.result === "win" ? "W" : game.result === "loss" ? "L" : "D"}
                </span>
                <div>
                  <strong>{game.result === "win" ? "Victory" : game.result === "loss" ? "Defeat" : "Draw"} vs {game.opponentName}</strong>
                  <span>{formatDate(game.finishedAt)} · {game.timeControl} · {game.gameResult ?? "Completed"}</span>
                </div>
                <strong className={game.ratingChange && game.ratingChange > 0 ? "is-positive" : game.ratingChange && game.ratingChange < 0 ? "is-negative" : ""}>
                  {game.ratingChange === null ? "Recorded" : signedRating(game.ratingChange)}
                </strong>
              </article>
            ))}
          </div>
        ) : (
          <div className="profile-history__empty">
            Finish a {selectedBoardSize}×{selectedBoardSize} game to start this history.
          </div>
        )}
      </section>
    </>
  );
}
