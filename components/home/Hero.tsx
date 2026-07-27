"use client";

import { ArrowRight, BookOpen, Radio, Sparkles } from "lucide-react";
import Link from "next/link";
import { GoBoard } from "@/components/game/GoBoard";
import { createEmptyBoard } from "@/lib/game/goEngine";
import type { Board } from "@/lib/game/types";

function createPreviewBoard(): Board {
  const board = createEmptyBoard(9);
  const stones: Array<[number, number, "black" | "white"]> = [
    [2, 2, "black"],
    [6, 2, "white"],
    [2, 6, "white"],
    [6, 6, "black"],
    [4, 3, "black"],
    [5, 3, "white"],
    [3, 4, "white"],
    [4, 4, "black"],
    [5, 4, "white"],
    [3, 5, "black"],
    [4, 5, "black"],
    [5, 5, "white"],
  ];

  for (const [x, y, color] of stones) {
    board[y][x] = color;
  }
  return board;
}

const previewBoard = createPreviewBoard();

export function Hero() {
  return (
    <section className="hero">
      <div className="hero-copy">
        <div className="eyebrow">
          <span className="live-dot" />
          1,284 players online
        </div>
        <h1>
          The quiet game,
          <br />
          <span>played together.</span>
        </h1>
        <p>
          Find your next match, sharpen your reading, and discover a game that
          has been unfolding for thousands of years.
        </p>

        <div className="hero-actions">
          <Link className="button button--primary button--lg" href="/play">
            <Radio size={20} />
            Play online
            <ArrowRight size={19} />
          </Link>
          <Link className="button button--secondary button--lg" href="/#learn">
            <BookOpen size={19} />
            Learn Go
          </Link>
        </div>

        <div className="quick-sizes">
          <span>Quick match</span>
          {([9, 13, 19] as const).map((size) => (
            <Link href={`/play?size=${size}`} key={size}>
              <strong>{size}×{size}</strong>
              <small>{size === 9 ? "~10 min" : size === 13 ? "~25 min" : "~45 min"}</small>
            </Link>
          ))}
        </div>
      </div>

      <div className="hero-visual" aria-label="Example 9 by 9 Go position">
        <div className="board-glow" />
        <div className="match-card">
          <div className="match-card-top">
            <div>
              <span className="player-stone player-stone--black" />
              <div>
                <strong>KuroSora</strong>
                <small>1,642</small>
              </div>
            </div>
            <span className="turn-pill">Your turn</span>
            <div>
              <div>
                <strong>Mori_9</strong>
                <small>1,611</small>
              </div>
              <span className="player-stone player-stone--white" />
            </div>
          </div>
          <GoBoard boardSize={9} boardState={previewBoard} onIntersectionClick={() => undefined} />
          <div className="match-card-footer">
            <span>9×9 · Japanese rules</span>
            <strong>04:38</strong>
          </div>
        </div>
        <div className="floating-note">
          <Sparkles size={17} />
          <span>
            <strong>Beautiful shape</strong>
            Your position is alive.
          </span>
        </div>
      </div>
    </section>
  );
}
