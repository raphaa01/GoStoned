"use client";

import { useId, useRef, useState } from "react";
import { useI18n } from "@/components/i18n/I18nProvider";
import {
  formatBoardLabel,
  goColumnLabel,
  goCoordinate,
  isBoardNavigationKey,
  joinBoardLabels,
  moveBoardFocus,
} from "@/lib/game/boardAccessibility";
import type { Board, Position } from "@/lib/game/types";

type GoBoardProps = {
  boardSize: 9 | 13 | 19;
  boardState: Board;
  onIntersectionClick: (x: number, y: number) => void;
  disabled?: boolean;
  interactionMode?: "play" | "mark-dead";
  deadStones?: Position[];
  lastMove?: Position | null;
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
  lastMove = null,
}: GoBoardProps) {
  const { dictionary } = useI18n();
  const copy = dictionary.game;
  const instructionsId = useId();
  const buttonRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [focusIndex, setFocusIndex] = useState(() => {
    if (interactionMode !== "mark-dead") return 0;
    const firstStone = boardState.flat().findIndex(Boolean);
    return firstStone >= 0 ? firstStone : 0;
  });
  const gridLines = Array.from({ length: boardSize });
  const gridPosition = (value: number) => `${(value / (boardSize - 1)) * 100}%`;
  const intersectionPosition = (value: number) =>
    `calc(7% + ${(value / (boardSize - 1)) * 86}%)`;
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
        {copy.boardInstructions}{" "}
        {interactionMode === "mark-dead" ? copy.markInstruction : copy.playInstruction}
        {" "}{copy.coordinateInstructions}
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
      <div aria-hidden="true" className="board-coordinate-labels">
        {gridLines.map((_, x) => (
          <span
            className="board-coordinate board-coordinate--column"
            key={`column-${x}`}
            style={{ left: intersectionPosition(x) }}
          >
            {goColumnLabel(boardSize, x)}
          </span>
        ))}
        {gridLines.map((_, y) => (
          <span
            className="board-coordinate board-coordinate--row"
            key={`row-label-${y}`}
            style={{ top: intersectionPosition(y) }}
          >
            {boardSize - y}
          </span>
        ))}
      </div>
      <div
        aria-colcount={boardSize}
        aria-describedby={instructionsId}
        aria-label={`${boardSize} × ${boardSize} ${copy.goBoard}`}
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
              const stoneLabel = stone === "black" ? copy.blackStone : copy.whiteStone;
              const groupLabel = stone === "black" ? copy.blackGroup : copy.whiteGroup;
              const coordinate = goCoordinate(boardSize, x, y);
              const isLastMove = lastMove?.x === x && lastMove.y === y;
              const actionable =
                !disabled && (interactionMode === "play" ? !stone : Boolean(stone));
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
                      ? joinBoardLabels(
                          formatBoardLabel(markedDead ? copy.restoreGroupLabel : copy.markGroupLabel, {
                            group: groupLabel,
                            coordinate,
                          }),
                          markedDead && copy.deadStoneState,
                          isLastMove && copy.lastMoveState,
                        )
                      : interactionMode === "mark-dead"
                      ? formatBoardLabel(copy.emptyIntersectionLabel, { coordinate })
                      : stone
                      ? joinBoardLabels(
                          formatBoardLabel(copy.stoneIntersectionLabel, {
                            stone: stoneLabel,
                            coordinate,
                          }),
                          isLastMove && copy.lastMoveState,
                        )
                      : formatBoardLabel(
                          actionable ? copy.placeStoneLabel : copy.emptyIntersectionLabel,
                          { coordinate },
                        )
                  }
                  aria-selected={interactionMode === "mark-dead" && stone ? markedDead : undefined}
                  className={`intersection ${isStarPoint(boardSize, x, y) ? "is-star" : ""} ${markedDead ? "is-dead" : ""}`}
                  key={`${x}-${y}`}
                  onClick={() => {
                    if (actionable) onIntersectionClick(x, y);
                  }}
                  onFocus={() => setFocusIndex(index)}
                  onKeyDown={(event) => {
                    const nextIndex = moveBoardFocus(
                      index,
                      event.key,
                      boardSize,
                      event.ctrlKey || event.metaKey,
                    );
                    if (isBoardNavigationKey(event.key)) event.preventDefault();
                    if ((event.key === "Enter" || event.key === " ") && !actionable) {
                      event.preventDefault();
                    }
                    if (nextIndex !== index) {
                      moveFocus(nextIndex);
                    }
                  }}
                  ref={(node) => {
                    buttonRefs.current[index] = node;
                  }}
                  role="gridcell"
                  style={{ left: intersectionPosition(x), top: intersectionPosition(y) }}
                  tabIndex={focusIndex === index ? 0 : -1}
                  type="button"
                >
                  {stone && <span className={`stone stone--${stone}`} />}
                  {markedDead ? (
                    <span aria-hidden="true" className="dead-stone-mark">
                      ×
                    </span>
                  ) : null}
                  {isLastMove ? <span aria-hidden="true" className="last-move-mark" /> : null}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
