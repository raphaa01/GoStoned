"use client";

import { RotateCcw } from "lucide-react";
import { useState } from "react";
import { createEmptyBoard } from "@/lib/game/goEngine";
import type { Board, BoardSize, Stone } from "@/lib/game/types";
import { BoardSizeSelector } from "./BoardSizeSelector";
import { GamePanel } from "./GamePanel";
import { GoBoard } from "./GoBoard";
import { MatchmakingPanel } from "./MatchmakingPanel";

export function PlayWorkspace({ initialSize = 9 }: { initialSize?: BoardSize }) {
  const [boardSize, setBoardSize] = useState<BoardSize>(initialSize);
  const [board, setBoard] = useState<Board>(() => createEmptyBoard(initialSize));
  const [turn, setTurn] = useState<Stone>("black");
  const [moveCount, setMoveCount] = useState(0);

  function changeSize(size: BoardSize) {
    setBoardSize(size);
    setBoard(createEmptyBoard(size));
    setTurn("black");
    setMoveCount(0);
  }

  function previewIntersection(x: number, y: number) {
    if (board[y][x]) return;
    setBoard((current) => {
      const next: Board = current.map((row) => [...row]);
      next[y][x] = turn;
      return next;
    });
    setTurn((current) => (current === "black" ? "white" : "black"));
    setMoveCount((count) => count + 1);
  }

  function resetPreview() {
    setBoard(createEmptyBoard(boardSize));
    setTurn("black");
    setMoveCount(0);
  }

  return (
    <>
      <header className="play-header">
        <div>
          <span className="section-kicker">Play online</span>
          <h1>Enter the board.</h1>
          <p>Choose your pace. We’ll find the right opponent.</p>
        </div>
        <BoardSizeSelector onChange={changeSize} value={boardSize} />
      </header>

      <div className="play-layout">
        <section className="board-stage">
          <div className="board-stage-top">
            <div>
              <span className="live-dot" />
              Interactive preview
            </div>
            <button onClick={resetPreview} type="button">
              <RotateCcw size={16} />
              Reset
            </button>
          </div>
          <div className="board-wrap">
            <GoBoard
              boardSize={boardSize}
              boardState={board}
              onIntersectionClick={previewIntersection}
            />
          </div>
        </section>
        <div className="play-side">
          <GamePanel boardSize={boardSize} moveCount={moveCount} turn={turn} />
          <MatchmakingPanel boardSize={boardSize} />
        </div>
      </div>
    </>
  );
}
