"use client";

import { Activity, ChevronRight, Database, Swords, Trophy, Users } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useI18n } from "@/components/i18n/I18nProvider";

type HealthState = "checking" | "online" | "offline";
type PlatformSummary = {
  activeByBoard: { 9: number; 13: number; 19: number };
  activeGames: number;
  gamesToday: number;
  playersOnline: number;
};

export function StatusOverview() {
  const { dictionary, href } = useI18n();
  const copy = dictionary.home;
  const [backend, setBackend] = useState<HealthState>("checking");
  const [database, setDatabase] = useState<HealthState>("checking");
  const [summary, setSummary] = useState<PlatformSummary | null>(null);

  useEffect(() => {
    let active = true;
    Promise.allSettled([
      fetch("/api/health").then((response) => {
        if (!response.ok) throw new Error("Backend unavailable");
        return response.json();
      }),
      fetch("/api/db-health").then(async (response) => {
        if (response.status === 429) return { limited: true };
        if (!response.ok) throw new Error("Database unavailable");
        await response.json();
        return { limited: false };
      }),
      fetch("/api/games", { cache: "no-store" }).then(async (response) => {
        if (!response.ok) throw new Error("Game summary unavailable");
        return (await response.json()) as { summary: PlatformSummary };
      }),
    ]).then(([backendResult, databaseResult, gamesResult]) => {
      if (!active) return;
      setBackend(backendResult.status === "fulfilled" ? "online" : "offline");
      setDatabase(
        databaseResult.status === "fulfilled"
          ? databaseResult.value.limited ? "checking" : "online"
          : "offline",
      );
      if (gamesResult.status === "fulfilled") setSummary(gamesResult.value.summary);
    });
    return () => {
      active = false;
    };
  }, []);

  return (
    <section className="platform-status">
      <div className="platform-status-heading">
        <div>
          <span className="section-kicker">{copy.platformKicker}</span>
          <h2>{copy.platformTitle}</h2>
        </div>
        <Link href={href("/leaderboard")}>{copy.leaderboard} <ChevronRight size={17} /></Link>
      </div>

      <div className="platform-metrics">
        <article><Users size={20} /><span>{copy.playersOnline}</span><strong>{summary?.playersOnline ?? "–"}</strong></article>
        <article><Swords size={20} /><span>{copy.liveGames}</span><strong>{summary?.activeGames ?? "–"}</strong></article>
        <article><Trophy size={20} /><span>{copy.gamesToday}</span><strong>{summary?.gamesToday ?? "–"}</strong></article>
      </div>

      <div className="board-activity">
        {([9, 13, 19] as const).map((size) => (
          <Link href={href(`/play?size=${size}`)} key={size}>
            <span>{size}×{size}</span>
            <strong>{summary?.activeByBoard[size] ?? "–"} {copy.active}</strong>
          </Link>
        ))}
      </div>

      <div className="service-status">
        <span><Activity size={15} /> {copy.gameService} <i className={`status-dot status-dot--${backend}`} /></span>
        <span><Database size={15} /> {copy.database} <i className={`status-dot status-dot--${database}`} /></span>
      </div>
    </section>
  );
}
