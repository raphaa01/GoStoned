"use client";

import { ArrowRight, Grid3X3, ShieldCheck, UserRoundPlus } from "lucide-react";
import Link from "next/link";
import { useAuth } from "@/components/auth/AuthProvider";

export function Hero() {
  const { user } = useAuth();

  return (
    <section className="home-hero">
      <div className="home-hero-copy">
        <span className="section-kicker">Go · Baduk · Weiqi</span>
        <h1>Your next Go game starts here.</h1>
        <p>
          Find a real opponent, play on a focused board, and keep every result.
          Guests start instantly; accounts save ratings across all board sizes.
        </p>
        <div className="hero-actions">
          <Link className="button button--primary button--lg" href="/play">
            Play online <ArrowRight size={19} />
          </Link>
          <Link className="button button--secondary button--lg" href={user ? "/profile" : "/register"}>
            {user ? "View profile" : <><UserRoundPlus size={19} /> Create account</>}
          </Link>
        </div>
        <div className="hero-trust">
          <span><ShieldCheck size={16} /> Server-checked moves</span>
          <span><ShieldCheck size={16} /> Saved games and ratings</span>
        </div>
      </div>

      <div className="hero-board-choice">
        <header>
          <span><Grid3X3 size={18} /></span>
          <div><strong>Choose a board</strong><small>Matchmaking starts after your selection.</small></div>
        </header>
        <div className="hero-board-options">
          {([
            { size: 9, label: "Quick" },
            { size: 13, label: "Balanced" },
            { size: 19, label: "Classic" },
          ] as const).map((option) => (
            <Link href={`/play?size=${option.size}`} key={option.size}>
              <strong>{option.size}×{option.size}</strong>
              <span>{option.label}</span>
              <ArrowRight size={18} />
            </Link>
          ))}
        </div>
        <ol className="hero-steps">
          <li><span>1</span><div><strong>Choose</strong><small>Select your board size.</small></div></li>
          <li><span>2</span><div><strong>Match</strong><small>We find another waiting player.</small></div></li>
          <li><span>3</span><div><strong>Play</strong><small>Enter a focused game room with chat.</small></div></li>
        </ol>
      </div>
    </section>
  );
}
