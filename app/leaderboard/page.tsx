import type { Metadata } from "next";
import { Crown, Medal, TrendingUp } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { Badge } from "@/components/ui/Badge";

export const metadata: Metadata = {
  title: "Leaderboard",
};

const players = [
  { name: "Shusaku_Stone", country: "JP", rating: 2418, games: 382, trend: "+18" },
  { name: "QuietDragon", country: "KR", rating: 2386, games: 291, trend: "+7" },
  { name: "CloudAtlas", country: "DE", rating: 2354, games: 447, trend: "+23" },
  { name: "Moku", country: "US", rating: 2311, games: 196, trend: "+5" },
  { name: "SenteFirst", country: "FR", rating: 2298, games: 329, trend: "+11" },
];

export default function LeaderboardPage() {
  return (
    <AppShell>
      <header className="page-header">
        <div>
          <span className="section-kicker">Global rankings</span>
          <h1>Leaderboard</h1>
          <p>The strongest players, one board at a time.</p>
        </div>
        <div className="leaderboard-filter">
          <button type="button">9×9</button>
          <button type="button">13×13</button>
          <button className="is-selected" type="button">19×19</button>
        </div>
      </header>

      <section className="leaderboard-card">
        <div className="leaderboard-title">
          <div><Crown size={20} /><strong>Top players</strong></div>
          <Badge tone="green">Season 01</Badge>
        </div>
        <div className="leaderboard-table">
          <div className="leaderboard-row leaderboard-row--head">
            <span>Rank</span><span>Player</span><span>Games</span><span>Rating</span><span>7d</span>
          </div>
          {players.map((player, index) => (
            <div className="leaderboard-row" key={player.name}>
              <span className={`rank rank--${index + 1}`}>
                {index < 3 ? <Medal size={19} /> : index + 1}
              </span>
              <span className="leader-player">
                <i>{player.name.slice(0, 2).toUpperCase()}</i>
                <span><strong>{player.name}</strong><small>{player.country}</small></span>
              </span>
              <span>{player.games}</span>
              <strong>{player.rating.toLocaleString("en")}</strong>
              <span className="trend"><TrendingUp size={14} />{player.trend}</span>
            </div>
          ))}
        </div>
      </section>
    </AppShell>
  );
}
