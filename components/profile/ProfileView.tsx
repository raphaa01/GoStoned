"use client";

import { BarChart3, Gamepad2, LogIn, UserRoundPlus } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import type { BoardSize } from "@/lib/game/types";

type ProfileStat = {
  board_size: BoardSize;
  games: number;
  wins: number;
  losses: number;
  draws: number;
  rating: number;
  highest_rating: number;
};

export function ProfileView() {
  const { user, loading } = useAuth();
  const [stats, setStats] = useState<ProfileStat[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!user) {
      const timeout = window.setTimeout(() => setLoaded(true), 0);
      return () => window.clearTimeout(timeout);
    }
    const timeout = window.setTimeout(() => {
      fetch("/api/profile", { cache: "no-store" })
        .then((response) => response.json())
        .then((body: { ok: boolean; stats?: ProfileStat[] }) => {
          setStats(body.ok ? body.stats ?? [] : []);
        })
        .finally(() => setLoaded(true));
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [user]);

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

  const bySize = new Map(stats.map((stat) => [stat.board_size, stat]));
  return (
    <>
      <header className="profile-header">
        <span className="profile-avatar">{user.displayName.slice(0, 2).toUpperCase()}</span>
        <div><span className="section-kicker">Player profile</span><h1>{user.displayName}</h1><p>@{user.username}</p></div>
        <Link className="button button--primary" href="/play"><Gamepad2 size={18} /> Play</Link>
      </header>
      <section className="rating-grid">
        {([9, 13, 19] as const).map((size) => {
          const stat = bySize.get(size);
          return (
            <article key={size}>
              <span>{size}×{size}</span>
              <strong>{stat?.rating ?? 1200}</strong>
              <small>{stat?.games ?? 0} games · {stat?.wins ?? 0} wins</small>
            </article>
          );
        })}
      </section>
      <section className="profile-summary">
        <BarChart3 size={22} />
        <div>
          <strong>{stats.reduce((total, stat) => total + stat.games, 0)} completed games</strong>
          <span>Separate ratings are tracked for every board size.</span>
        </div>
      </section>
    </>
  );
}
