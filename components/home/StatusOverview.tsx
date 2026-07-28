"use client";

import { Activity, ChevronRight, Database, Swords, Trophy, Users } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

type HealthState = "checking" | "online" | "offline";
type PlatformSummary = {
  activeByBoard: { 9: number; 13: number; 19: number };
  activeGames: number;
  gamesToday: number;
  playersOnline: number;
};

export function StatusOverview() {
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
          <span className="section-kicker">Live platform</span>
          <h2>Live platform activity.</h2>
        </div>
        <Link href="/leaderboard">Leaderboard <ChevronRight size={17} /></Link>
      </div>

      <div className="platform-metrics">
        <article><Users size={20} /><span>Players online</span><strong>{summary?.playersOnline ?? "–"}</strong></article>
        <article><Swords size={20} /><span>Live games</span><strong>{summary?.activeGames ?? "–"}</strong></article>
        <article><Trophy size={20} /><span>Games today</span><strong>{summary?.gamesToday ?? "–"}</strong></article>
      </div>

      <div className="board-activity">
        {([9, 13, 19] as const).map((size) => (
          <Link href={`/play?size=${size}`} key={size}>
            <span>{size}×{size}</span>
            <strong>{summary?.activeByBoard[size] ?? "–"} active</strong>
          </Link>
        ))}
      </div>

      <div className="service-status">
        <span><Activity size={15} /> Game service <i className={`status-dot status-dot--${backend}`} /></span>
        <span><Database size={15} /> Database <i className={`status-dot status-dot--${database}`} /></span>
      </div>
    </section>
  );
}
