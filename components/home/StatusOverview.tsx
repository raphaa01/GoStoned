"use client";

import {
  Activity,
  BookOpen,
  ChevronRight,
  Database,
  Puzzle,
  Swords,
  Trophy,
} from "lucide-react";
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
      fetch("/api/db-health").then((response) => {
        if (!response.ok) throw new Error("Database unavailable");
        return response.json();
      }),
      fetch("/api/games", { cache: "no-store" }).then(async (response) => {
        if (!response.ok) throw new Error("Game summary unavailable");
        return (await response.json()) as { summary: PlatformSummary };
      }),
    ]).then(([backendResult, databaseResult, gamesResult]) => {
      if (!active) return;
      setBackend(backendResult.status === "fulfilled" ? "online" : "offline");
      setDatabase(databaseResult.status === "fulfilled" ? "online" : "offline");
      if (gamesResult.status === "fulfilled") setSummary(gamesResult.value.summary);
    });
    return () => {
      active = false;
    };
  }, []);

  return (
    <section className="home-sections" id="stats">
      <div className="home-panel">
        <div className="home-panel-title">
          <div><Swords size={21} /><h2>Games happening now</h2></div>
          <Link href="/play">Play <ChevronRight size={16} /></Link>
        </div>
        <div className="live-games-list">
          <div><strong>9×9</strong><span>Fast games</span><b>{summary?.activeByBoard[9] ?? "–"} playing</b></div>
          <div><strong>13×13</strong><span>Standard games</span><b>{summary?.activeByBoard[13] ?? "–"} playing</b></div>
          <div><strong>19×19</strong><span>Classic games</span><b>{summary?.activeByBoard[19] ?? "–"} playing</b></div>
        </div>
      </div>

      <div className="home-panel">
        <div className="home-panel-title">
          <div><BookOpen size={21} /><h2>Learn Go</h2></div>
          <Link href="/#learn">All lessons <ChevronRight size={16} /></Link>
        </div>
        <div className="lesson-card" id="learn">
          <span className="lesson-number">01</span>
          <div>
            <strong>Your first game</strong>
            <p>Learn liberties, captures and how a game ends.</p>
            <span className="lesson-progress"><i /></span>
          </div>
          <button type="button">Start</button>
        </div>
        <div className="lesson-card">
          <span className="lesson-number"><Puzzle size={19} /></span>
          <div>
            <strong>Daily problem</strong>
            <p>Black to play. Find the best local move.</p>
          </div>
          <button type="button">Solve</button>
        </div>
      </div>

      <div className="home-panel home-panel--compact">
        <div className="home-panel-title">
          <div><Trophy size={21} /><h2>Community</h2></div>
          <Link href="/leaderboard">Leaderboard <ChevronRight size={16} /></Link>
        </div>
        <div className="community-stats">
          <div><span>Players online</span><strong>{summary?.playersOnline ?? "–"}</strong></div>
          <div><span>Live games</span><strong>{summary?.activeGames ?? "–"}</strong></div>
          <div><span>Games today</span><strong>{summary?.gamesToday ?? "–"}</strong></div>
        </div>
        <div className="service-status">
          <span><Activity size={15} /> Game service <i className={`status-dot status-dot--${backend}`} /></span>
          <span><Database size={15} /> Database <i className={`status-dot status-dot--${database}`} /></span>
        </div>
      </div>
    </section>
  );
}
