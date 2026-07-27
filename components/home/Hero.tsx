"use client";

import { Bot, ChevronRight, Clock3, Radio, UserRound } from "lucide-react";
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
    [4, 2, "black"],
    [5, 2, "white"],
    [3, 3, "white"],
    [4, 3, "black"],
    [5, 3, "white"],
    [3, 4, "black"],
    [4, 4, "black"],
    [5, 4, "white"],
    [6, 4, "white"],
    [2, 5, "black"],
    [3, 5, "black"],
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
    <section className="home-dashboard">
      <div className="home-board">
        <div className="home-board-player">
          <span className="player-avatar">MS</span>
          <div>
            <strong>MoriStone</strong>
            <span>1,611</span>
          </div>
          <time>04:38</time>
        </div>
        <GoBoard
          boardSize={9}
          boardState={previewBoard}
          onIntersectionClick={() => undefined}
        />
        <div className="home-board-player">
          <span className="player-avatar player-avatar--you">G</span>
          <div>
            <strong>Guest</strong>
            <span>Playing black</span>
          </div>
          <time>05:00</time>
        </div>
      </div>

      <div className="home-start">
        <div className="online-count">
          <span className="live-dot" />
          1,284 players online
        </div>
        <h1>Play Go online</h1>
        <p>
          Find a game in seconds. Play on 9×9, 13×13 or the classic 19×19 board.
        </p>

        <div className="home-actions">
          <Link className="home-action home-action--primary" href="/play">
            <span className="home-action-icon"><Radio size={28} /></span>
            <span>
              <strong>Play Online</strong>
              <small>Find an opponent at your level</small>
            </span>
            <ChevronRight size={24} />
          </Link>
          <Link className="home-action" href="/play">
            <span className="home-action-icon"><UserRound size={26} /></span>
            <span>
              <strong>Play a Friend</strong>
              <small>Create a private game</small>
            </span>
            <ChevronRight size={22} />
          </Link>
          <Link className="home-action" href="/play">
            <span className="home-action-icon"><Bot size={27} /></span>
            <span>
              <strong>Practice Game</strong>
              <small>Play without a rating</small>
            </span>
            <ChevronRight size={22} />
          </Link>
        </div>

        <div className="board-size-box">
          <div>
            <strong>Quick game</strong>
            <span><Clock3 size={14} /> Choose a board</span>
          </div>
          <div className="board-size-links">
            {([9, 13, 19] as const).map((size) => (
              <Link href={`/play?size=${size}`} key={size}>
                <strong>{size}×{size}</strong>
                <small>{size === 9 ? "Quick" : size === 13 ? "Standard" : "Classic"}</small>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
