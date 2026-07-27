import type { Metadata } from "next";
import { BarChart3, CircleUserRound, Gamepad2, LockKeyhole } from "lucide-react";
import Link from "next/link";
import { AppShell } from "@/components/layout/AppShell";

export const metadata: Metadata = {
  title: "Profile",
};

export default function ProfilePage() {
  return (
    <AppShell>
      <header className="page-header">
        <div>
          <span className="section-kicker">Your space</span>
          <h1>Player profile</h1>
          <p>Your games, ratings and progress will live here.</p>
        </div>
      </header>

      <section className="profile-grid">
        <div className="profile-card profile-intro">
          <div className="profile-avatar"><CircleUserRound size={42} /></div>
          <h2>Guest player</h2>
          <p>Create a free account to keep your games, build a rating and meet players at your level.</p>
          <button className="button button--primary button--lg" type="button">
            Create free account
          </button>
          <span><LockKeyhole size={14} /> Your game data stays private.</span>
        </div>
        <div className="profile-card profile-stats">
          <div className="empty-feature">
            <span><BarChart3 size={24} /></span>
            <div><h3>Build your rating</h3><p>Separate ratings for 9×9, 13×13 and 19×19.</p></div>
          </div>
          <div className="empty-feature">
            <span><Gamepad2 size={24} /></span>
            <div><h3>Keep every game</h3><p>Return to your move history and review key moments.</p></div>
          </div>
          <Link className="text-link" href="/play">Play your first game →</Link>
        </div>
      </section>
    </AppShell>
  );
}
