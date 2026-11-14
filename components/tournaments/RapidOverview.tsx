"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { useI18n } from "@/components/i18n/I18nProvider";
import { EXPECTED_PLAYER_HEADER } from "@/lib/auth/playerBinding";
import { readApi } from "@/lib/client/api";
import { readRouteData, routeCacheKey } from "@/lib/client/routeCache";
import { getTournamentsCopy } from "@/lib/i18n/tournaments";
import type {
  Standing,
  TournamentHistoryEntry,
  TournamentLeaderboardEntry,
  TournamentLeaderboards,
} from "@/lib/tournaments/types";

export function tournamentDates(
  startsAt: string,
  endsAt: string,
  locale: string,
) {
  const date = new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
  return `${date.format(new Date(startsAt))} – ${date.format(new Date(Date.parse(endsAt) - 1))} · UTC`;
}

export function RapidCountdown({
  startsAt,
  now,
}: {
  startsAt: string;
  now: number;
}) {
  const { locale } = useI18n();
  const copy = getTournamentsCopy(locale);
  const remaining = Math.ceil((Date.parse(startsAt) - now) / 60_000);
  if (remaining <= 0) return null;
  const days = Math.floor(remaining / 1440);
  const hours = Math.floor(remaining / 60) % 24;
  return (
    <p className="tournament-countdown">
      {copy.beginsIn}{" "}
      <strong>
        {days ? `${days} ${copy.days} ` : ""}
        {hours ? `${hours} ${copy.hours} ` : ""}
        {remaining % 60} {copy.minutes}
      </strong>
    </p>
  );
}

export function RapidActivity({ month }: { month: string }) {
  const { user } = useAuth();
  const { locale } = useI18n();
  const playerKey = user?.playerKey;
  const [snapshot, setSnapshot] = useState<{
    playerKey: string;
    month: string;
    count: number | null;
  }>();
  useEffect(() => {
    if (!playerKey) return;
    let stopped = false;
    let timer: number | undefined;
    const refresh = () => {
      window.clearTimeout(timer);
      if (document.hidden) return;
      void readRouteData(
        routeCacheKey(`rapid-activity:${month}`, playerKey),
        () =>
          fetch("/api/tournaments?view=activity", {
            cache: "no-store",
            headers: { [EXPECTED_PLAYER_HEADER]: playerKey },
            signal: AbortSignal.timeout(20_000),
          }).then(readApi<{ activePlayers: number | null }>),
        600_000,
      )
        .then((result) => {
          if (!stopped)
            setSnapshot({ playerKey, month, count: result.activePlayers });
        })
        .catch(() => undefined)
        .finally(() => {
          if (!stopped) timer = window.setTimeout(refresh, 600_000);
        });
    };
    refresh();
    document.addEventListener("visibilitychange", refresh);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [month, playerKey]);
  if (
    !snapshot ||
    snapshot.playerKey !== playerKey ||
    snapshot.month !== month ||
    snapshot.count === null
  )
    return null;
  return (
    <p className="tournament-activity">
      <strong>{snapshot.count}</strong>{" "}
      {getTournamentsCopy(locale).activePlayers.toLocaleLowerCase(locale)}
    </p>
  );
}

export function RapidStandings({
  rows,
  userId,
}: {
  rows: Standing[];
  userId: string;
}) {
  const { locale } = useI18n();
  const copy = getTournamentsCopy(locale);
  const [expanded, setExpanded] = useState(false);
  const own = rows.findIndex((row) => row.userId === userId);
  const compact = rows.filter(
    (_, i) => i < 5 || (own >= 0 && Math.abs(own - i) <= 1),
  );
  const visible = expanded ? rows : compact;
  const number = new Intl.NumberFormat(locale, { signDisplay: "exceptZero" });
  return (
    <section className="tournament-standings">
      <h2>
        {copy.group} · {copy.standings}
      </h2>
      <table className="rapid-standings">
        <thead>
          <tr>
            <th scope="col">#</th>
            <th scope="col">{copy.player}</th>
            <th scope="col">{copy.wins}</th>
            <th scope="col">{copy.scoreDifference}</th>
          </tr>
        </thead>
        <tbody>
          {visible.map((row) => (
            <tr key={row.userId} data-self={row.userId === userId}>
              <td>{row.place}</td>
              <th scope="row">{row.name}</th>
              <td>{row.wins}</td>
              <td>{number.format(row.margin ?? 0)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > compact.length ? (
        <button
          type="button"
          className="tournament-text-button"
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? copy.hideGroup : copy.showGroup}
        </button>
      ) : null}
    </section>
  );
}

export function RapidLeaderboards({
  countdown,
}: {
  countdown?: React.ReactNode;
}) {
  const { user } = useAuth();
  const { locale } = useI18n();
  const copy = getTournamentsCopy(locale);
  const [boards, setBoards] = useState<TournamentLeaderboards>();
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const identity = user?.playerKey;
  useEffect(() => {
    if (!identity) return;
    const controller = new AbortController();
    void fetch("/api/tournaments?view=leaderboards", {
      cache: "no-store",
      headers: { [EXPECTED_PLAYER_HEADER]: identity },
      signal: controller.signal,
    })
      .then(readApi<{ leaderboards: TournamentLeaderboards }>)
      .then((result) => {
        if (!controller.signal.aborted) {
          setBoards(result.leaderboards);
          setError(false);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      });
    return () => controller.abort();
  }, [identity, retry]);
  function ranking(title: string, rows: TournamentLeaderboardEntry[]) {
    return (
      <section className="tournament-standings">
        <h2>{title}</h2>
        {rows.length ? (
          <table className="rapid-standings">
            <thead>
              <tr>
                <th scope="col">#</th>
                <th scope="col">{copy.player}</th>
                <th scope="col">{copy.tournamentPoints}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.userId} data-self={row.userId === user?.id}>
                  <td>{row.place}</td>
                  <th scope="row">{row.name}</th>
                  <td>{row.points}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="tournament-empty">{copy.noPlayers}</p>
        )}
      </section>
    );
  }
  return (
    <>
      {error ? (
        <p role="alert">
          {copy.error}{" "}
          <button type="button" onClick={() => setRetry((v) => v + 1)}>
            {copy.retry}
          </button>
        </p>
      ) : null}
      {boards ? ranking(copy.worldwide, boards.worldwide) : null}
      {countdown}
      {boards ? ranking(copy.friendRanking, boards.friends) : null}
    </>
  );
}

export function TournamentHistory({ mobile }: { mobile: boolean }) {
  const { user } = useAuth();
  const { locale, href } = useI18n();
  const copy = getTournamentsCopy(locale);
  const [opened, setOpened] = useState(false);
  const [history, setHistory] = useState<TournamentHistoryEntry[]>();
  const [error, setError] = useState(false);
  const identity = user?.playerKey;
  useEffect(() => {
    if (!opened || !identity) return;
    const controller = new AbortController();
    void fetch(
      `/api/tournaments?view=history${mobile ? "&client=mobile" : ""}`,
      {
        cache: "no-store",
        headers: { [EXPECTED_PLAYER_HEADER]: identity },
        signal: controller.signal,
      },
    )
      .then(readApi<{ history: TournamentHistoryEntry[] }>)
      .then((result) => {
        if (!controller.signal.aborted) {
          setHistory(result.history);
          setError(false);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      });
    return () => controller.abort();
  }, [opened, identity, mobile]);
  return (
    <details
      className="tournament-history"
      onToggle={(event) => setOpened(event.currentTarget.open)}
    >
      <summary>{copy.history}</summary>
      {error ? (
        <p role="alert">{copy.error}</p>
      ) : !history ? (
        <p>{copy.loading}</p>
      ) : history.length ? (
        history.map(({ tournament, standing, group }) => (
          <Link
            key={tournament.id}
            href={href(`/tournaments/${tournament.id}`)}
            className="tournament-row"
          >
            <span>
              <strong>{tournament.name}</strong>
              <small>
                {tournament.kind === "monthly"
                  ? `${copy.group} ${group} · `
                  : ""}
                {standing.wins} {copy.wins} · {standing.played} {copy.games}
              </small>
            </span>
            <strong>#{standing.place}</strong>
          </Link>
        ))
      ) : (
        <p className="tournament-empty">{copy.noHistory}</p>
      )}
    </details>
  );
}
