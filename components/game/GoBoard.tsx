"use client";

import type { Board } from "@/lib/game/types";

type GoBoardProps = {
  boardSize: 9 | 13 | 19;
  boardState: Board;
  onIntersectionClick: (x: number, y: number) => void;
  disabled?: boolean;
};

function isStarPoint(size: number, x: number, y: number) {
  const points =
    size === 9
      ? [2, 4, 6]
      : size === 13
        ? [3, 6, 9]
        : [3, 9, 15];
  return points.includes(x) && points.includes(y);
}

export function GoBoard({
  boardSize,
  boardState,
  onIntersectionClick,
  disabled = false,
}: GoBoardProps) {
  const intersections = Array.from({ length: boardSize * boardSize });
  return (
    <div
      className="go-board"
      style={
        {
          "--board-size": boardSize,
          "--grid-step": `${100 / (boardSize - 1)}%`,
        } as React.CSSProperties
      }
      data-size={boardSize}
    >
      <div className="go-board-grid" aria-hidden="true" />
      <div className="go-board-points" role="grid" aria-label={`${boardSize} by ${boardSize} Go board`}>
        {intersections.map((_, index) => {
          const x = index % boardSize;
          const y = Math.floor(index / boardSize);
          const stone = boardState[y]?.[x] ?? null;
          const position = (value: number) =>
            `calc(7% + ${(value / (boardSize - 1)) * 86}%)`;
          return (
            <button
              aria-label={
                stone
                  ? `${stone} stone at column ${x + 1}, row ${y + 1}`
                  : `Place stone at column ${x + 1}, row ${y + 1}`
              }
              className={`intersection ${isStarPoint(boardSize, x, y) ? "is-star" : ""}`}
              disabled={disabled || Boolean(stone)}
              key={`${x}-${y}`}
              onClick={() => onIntersectionClick(x, y)}
              role="gridcell"
              style={{ left: position(x), top: position(y) }}
              type="button"
            >
              {stone && <span className={`stone stone--${stone}`} />}
            </button>
          );
        })}
      </div>
    </div>
  );
}
