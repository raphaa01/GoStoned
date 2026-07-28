"use client";

import { useId, useRef, useState } from "react";
import type { Board, Position } from "@/lib/game/types";

type GoBoardProps = {
  boardSize: 9 | 13 | 19;
  boardState: Board;
  onIntersectionClick: (x: number, y: number) => void;
  disabled?: boolean;
  interactionMode?: "play" | "mark-dead";
  deadStones?: Position[];
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
  interactionMode = "play",
  deadStones = [],
}: GoBoardProps) {
  const instructionsId = useId();
  const buttonRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [focusIndex, setFocusIndex] = useState(() => {
    if (interactionMode !== "mark-dead") return 0;
    const firstStone = boardState.flat().findIndex(Boolean);
    return firstStone >= 0 ? firstStone : 0;
  });
  const intersections = Array.from({ length: boardSize * boardSize });
  const gridLines = Array.from({ length: boardSize });
  const gridPosition = (value: number) => `${(value / (boardSize - 1)) * 100}%`;
  const deadStoneKeys = new Set(deadStones.map(({ x, y }) => `${x}:${y}`));
  return (
    <div
      className="go-board"
      style={
        {
          "--board-size": boardSize,
          "--grid-step": `${100 / (boardSize - 1)}%`,
          "--intersection-size": `${86 / (boardSize - 1)}%`,
        } as React.CSSProperties
      }
      data-size={boardSize}
      data-interaction-mode={interactionMode}
    >
      <span className="sr-only" id={instructionsId}>
        Use the arrow keys to move across intersections. Press Enter or Space to
        {interactionMode === "mark-dead" ? " mark or restore a stone group." : " place a stone when available."}
      </span>
      <div className="go-board-grid" aria-hidden="true">
        {gridLines.map((_, index) => (
          <span
            className="board-line board-line--vertical"
            key={`vertical-${index}`}
            style={{ left: gridPosition(index) }}
          />
        ))}
        {gridLines.map((_, index) => (
          <span
            className="board-line board-line--horizontal"
            key={`horizontal-${index}`}
            style={{ top: gridPosition(index) }}
          />
        ))}
      </div>
      <div
        aria-colcount={boardSize}
        aria-describedby={instructionsId}
        aria-label={`${boardSize} by ${boardSize} Go board`}
        aria-rowcount={boardSize}
        className="go-board-points"
        role="grid"
      >
        {gridLines.map((_, y) => (
          <div aria-rowindex={y + 1} key={`row-${y}`} role="row">
            {gridLines.map((__, x) => {
              const index = y * boardSize + x;
              const stone = boardState[y]?.[x] ?? null;
              const markedDead = deadStoneKeys.has(`${x}:${y}`);
              const actionable =
                !disabled && (interactionMode === "play" ? !stone : Boolean(stone));
              const position = (value: number) =>
                `calc(7% + ${(value / (boardSize - 1)) * 86}%)`;
              const moveFocus = (nextIndex: number) => {
                setFocusIndex(nextIndex);
                window.requestAnimationFrame(() => buttonRefs.current[nextIndex]?.focus());
              };
              return (
                <button
                  aria-colindex={x + 1}
                  aria-disabled={!actionable}
                  aria-label={
                    interactionMode === "mark-dead" && stone
                      ? `${markedDead ? "Restore" : "Mark"} ${stone} group at column ${x + 1}, row ${y + 1} ${markedDead ? "as alive" : "as dead"}`
                      : interactionMode === "mark-dead"
                      ? `Empty intersection at column ${x + 1}, row ${y + 1}`
                      : stone
                      ? `${stone} stone at column ${x + 1}, row ${y + 1}`
                      : `Place stone at column ${x + 1}, row ${y + 1}`
                  }
                  aria-selected={interactionMode === "mark-dead" && stone ? markedDead : undefined}
                  className={`intersection ${isStarPoint(boardSize, x, y) ? "is-star" : ""} ${markedDead ? "is-dead" : ""}`}
                  key={`${x}-${y}`}
                  onClick={() => {
                    if (actionable) onIntersectionClick(x, y);
                  }}
                  onFocus={() => setFocusIndex(index)}
                  onKeyDown={(event) => {
                    let nextIndex = index;
                    if (event.key === "ArrowLeft") nextIndex = Math.max(0, index - 1);
                    else if (event.key === "ArrowRight") {
                      nextIndex = Math.min(intersections.length - 1, index + 1);
                    } else if (event.key === "ArrowUp") {
                      nextIndex = Math.max(0, index - boardSize);
                    } else if (event.key === "ArrowDown") {
                      nextIndex = Math.min(intersections.length - 1, index + boardSize);
                    } else if (event.key === "Home") nextIndex = y * boardSize;
                    else if (event.key === "End") nextIndex = y * boardSize + boardSize - 1;
                    else if ((event.key === "Enter" || event.key === " ") && !actionable) {
                      event.preventDefault();
                    }
                    if (nextIndex !== index) {
                      event.preventDefault();
                      moveFocus(nextIndex);
                    }
                  }}
                  ref={(node) => {
                    buttonRefs.current[index] = node;
                  }}
                  role="gridcell"
                  style={{ left: position(x), top: position(y) }}
                  tabIndex={focusIndex === index ? 0 : -1}
                  type="button"
                >
                  {stone && <span className={`stone stone--${stone}`} />}
                  {markedDead ? (
                    <span aria-hidden="true" className="dead-stone-mark">
                      ×
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
