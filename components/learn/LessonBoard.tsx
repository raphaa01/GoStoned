"use client";

import type { CSSProperties } from "react";
import {
  lessonCoordinate,
  lessonPositionKey,
  type ChapterOneCopy,
  type LessonStone,
} from "@/lib/learn/chapterOne";
import type { Position } from "@/lib/game/types";

type LessonBoardProps = {
  size: number;
  stones: readonly LessonStone[];
  onPlay: (position: Position) => void;
  copy: ChapterOneCopy;
  disabled?: boolean;
  hintPositions?: readonly Position[];
  choicePositions?: readonly Position[];
  territoryTargets?: readonly Position[];
  ownedTerritory?: readonly Position[];
  markedPositions?: readonly Position[];
};

export function LessonBoard({
  size,
  stones,
  onPlay,
  copy,
  disabled = false,
  hintPositions = [],
  choicePositions = [],
  territoryTargets = [],
  ownedTerritory = [],
  markedPositions = [],
}: LessonBoardProps) {
  const grid = Array.from({ length: size });
  const inset = 50 / size;
  const span = 100 - inset * 2;
  const pointPosition = (value: number) => `${inset + (value / (size - 1)) * span}%`;
  const stonesByPoint = new Map(stones.map((stone) => [lessonPositionKey(stone), stone]));
  const hintKeys = new Set(hintPositions.map(lessonPositionKey));
  const choiceKeys = new Set(choicePositions.map(lessonPositionKey));
  const territoryKeys = new Set(territoryTargets.map(lessonPositionKey));
  const ownedKeys = new Set(ownedTerritory.map(lessonPositionKey));
  const markedKeys = new Set(markedPositions.map(lessonPositionKey));
  const pointSize = (span / (size - 1)) * 0.96;

  return (
    <div className="lesson-board-frame">
      <div
        aria-colcount={size}
        aria-label={copy.boardLabel}
        aria-rowcount={size}
        className="lesson-board"
        role="grid"
        style={{
          "--lesson-board-size": size,
          "--lesson-point-size": `${pointSize}%`,
        } as CSSProperties}
      >
        <div aria-hidden="true" className="lesson-board__grid">
          {grid.map((_, index) => (
            <span
              className="lesson-board__line lesson-board__line--vertical"
              key={`vertical-${index}`}
              style={{ left: pointPosition(index), top: `${inset}%`, height: `${span}%` }}
            />
          ))}
          {grid.map((_, index) => (
            <span
              className="lesson-board__line lesson-board__line--horizontal"
              key={`horizontal-${index}`}
              style={{ left: `${inset}%`, top: pointPosition(index), width: `${span}%` }}
            />
          ))}
        </div>

        <div className="lesson-board__points">
          {grid.map((_, y) => (
            <div aria-rowindex={y + 1} className="lesson-board__row" key={`row-${y}`} role="row">
              {grid.map((__, x) => {
                const position = { x, y };
                const key = lessonPositionKey(position);
                const stone = stonesByPoint.get(key);
                const coordinate = lessonCoordinate(size, position);
                const isHint = hintKeys.has(key);
                const isChoice = choiceKeys.has(key);
                const isTerritory = territoryKeys.has(key);
                const isOwned = ownedKeys.has(key);
                const isMarked = markedKeys.has(key);
                const label = stone
                  ? (stone.color === "black" ? copy.blackStone : copy.whiteStone)
                  : isMarked
                    ? copy.libertyPoint
                    : isTerritory
                    ? copy.territoryPoint
                    : isHint
                      ? copy.suggestedPoint
                      : copy.emptyPoint;

                return (
                  <button
                    aria-label={label.replace("{coordinate}", coordinate)}
                    className={`lesson-board__point${stone ? ` has-stone is-${stone.color}` : ""}${isHint ? " is-hint" : ""}${isChoice ? " is-choice" : ""}${isTerritory ? " is-territory-target" : ""}${isOwned ? " is-owned" : ""}${isMarked ? " is-marked" : ""}`}
                    data-coordinate={coordinate}
                    disabled={disabled || Boolean(stone)}
                    key={`point-${x}-${y}`}
                    onClick={() => {
                      if (!disabled && !stone) onPlay(position);
                    }}
                    style={{ left: pointPosition(x), top: pointPosition(y) }}
                    type="button"
                  >
                    <span aria-hidden="true" className="lesson-board__stone" />
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
