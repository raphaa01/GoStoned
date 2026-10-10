"use client";

import { memo, useMemo, useRef, useState, type CSSProperties } from "react";
import type { Board, Position, Stone } from "@/lib/game/types";
import { formatLearn, learnUiCopy } from "@/lib/learn/curriculum";
import { pointKey } from "@/lib/learn/lessonEngine";

type InteractiveLearnBoardProps = Readonly<{
  board: Board;
  onPoint?: (position: Position) => void;
  disabled?: boolean;
  interaction?: "empty" | "stone" | "any";
  emphasis?: readonly Position[];
  selected?: readonly Position[];
  liberties?: readonly Position[];
  territory?: readonly Position[];
  blackTerritory?: readonly Position[];
  whiteTerritory?: readonly Position[];
  group?: readonly Position[];
  lastMove?: Position | null;
  previewColor?: Stone;
  locale: string;
}>;

const GO_COLUMNS = "ABCDEFGHJKLMNOPQRST";

function keys(points: readonly Position[]) {
  return new Set(points.map(pointKey));
}

function InteractiveLearnBoardComponent({
  board,
  onPoint,
  disabled = false,
  interaction = "empty",
  emphasis = [],
  selected = [],
  liberties = [],
  territory = [],
  blackTerritory = [],
  whiteTerritory = [],
  group = [],
  lastMove = null,
  previewColor = "black",
  locale,
}: InteractiveLearnBoardProps) {
  const size = board.length;
  const points = useMemo(() => Array.from({ length: size }), [size]);
  const emphasisKeys = useMemo(() => keys(emphasis), [emphasis]);
  const selectedKeys = useMemo(() => keys(selected), [selected]);
  const libertyKeys = useMemo(() => keys(liberties), [liberties]);
  const territoryKeys = useMemo(() => keys(territory), [territory]);
  const blackTerritoryKeys = useMemo(() => keys(blackTerritory), [blackTerritory]);
  const whiteTerritoryKeys = useMemo(() => keys(whiteTerritory), [whiteTerritory]);
  const groupKeys = useMemo(() => keys(group), [group]);
  const buttonRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [focusIndex, setFocusIndex] = useState(0);
  const [enlarged, setEnlarged] = useState(false);
  // Half a grid interval at each edge leaves room for full-size corner stones.
  const inset = 50 / size;
  const span = 100 - inset * 2;
  const position = (value: number) => `${inset + (value / (size - 1)) * span}%`;
  const coordinate = (x: number, y: number) => `${GO_COLUMNS[x] ?? "?"}${size - y}`;
  const copy = learnUiCopy(locale);

  return (
    <div className={`interactive-learn-board-frame${enlarged ? " is-enlarged" : ""}`}>
      {size >= 13 ? <button className="learn-text-button learn-board-zoom" aria-pressed={enlarged} onClick={() => setEnlarged((current) => !current)} type="button">{locale === "de" ? enlarged ? "Ganzes Brett anzeigen" : "Brett vergrößern · dann verschieben" : enlarged ? "Show whole board" : "Enlarge board · then pan"}</button> : null}
      <div className="learn-board-viewport" style={enlarged ? { maxHeight: "70svh", overflow: "auto" } : undefined}>
      <div
        aria-colcount={size}
        aria-label={formatLearn(copy.boardLabel, { size })}
        aria-rowcount={size}
        className="interactive-learn-board"
        data-preview-color={previewColor}
        role="grid"
        style={{
          "--learn-board-inset": `${inset}%`,
          "--learn-board-span": `${span}%`,
          "--learn-board-point": `${span / (size - 1)}%`,
          ...(enlarged ? { minWidth: `${size * 36}px` } : {}),
        } as CSSProperties}
      >
        <div aria-hidden="true" className="interactive-learn-board__grid">
          {points.map((_, index) => (
            <span className="is-vertical" key={`v-${index}`} style={{ left: position(index), top: `${inset}%`, height: `${span}%` }} />
          ))}
          {points.map((_, index) => (
            <span className="is-horizontal" key={`h-${index}`} style={{ left: `${inset}%`, top: position(index), width: `${span}%` }} />
          ))}
        </div>
        <div className="interactive-learn-board__points">
          {points.map((_, y) => (
            <div aria-rowindex={y + 1} key={`row-${y}`} role="row">
              {points.map((__, x) => {
                const index = y * size + x;
                const point = { x, y };
                const key = pointKey(point);
                const stone = board[y]?.[x] ?? null;
                const actionable = !disabled && Boolean(onPoint) && (
                  interaction === "any"
                  || (interaction === "empty" && !stone)
                  || (interaction === "stone" && Boolean(stone))
                );
                const label = formatLearn(
                  stone === "black" ? copy.blackStoneAt : stone === "white" ? copy.whiteStoneAt : copy.emptyAt,
                  { coordinate: coordinate(x, y) },
                );
                const moveFocus = (next: number) => {
                  const bounded = Math.max(0, Math.min(size * size - 1, next));
                  setFocusIndex(bounded);
                  window.requestAnimationFrame(() => buttonRefs.current[bounded]?.focus());
                };
                return (
                  <button
                    aria-colindex={x + 1}
                    aria-disabled={!actionable}
                    aria-label={label}
                    aria-selected={selectedKeys.has(key) || undefined}
                    className={[
                      "interactive-learn-board__point",
                      stone ? `has-stone is-${stone}` : "",
                      emphasisKeys.has(key) ? "is-emphasis" : "",
                      selectedKeys.has(key) ? "is-selected" : "",
                      libertyKeys.has(key) ? "is-liberty" : "",
                      territoryKeys.has(key) ? "is-territory" : "",
                      blackTerritoryKeys.has(key) ? "is-black-territory" : "",
                      whiteTerritoryKeys.has(key) ? "is-white-territory" : "",
                      groupKeys.has(key) ? "is-group" : "",
                      lastMove?.x === x && lastMove.y === y ? "is-last" : "",
                    ].filter(Boolean).join(" ")}
                    key={key}
                    onClick={() => actionable && onPoint?.(point)}
                    onFocus={() => setFocusIndex(index)}
                    onKeyDown={(event) => {
                      let next = index;
                      if (event.key === "ArrowLeft") next -= 1;
                      if (event.key === "ArrowRight") next += 1;
                      if (event.key === "ArrowUp") next -= size;
                      if (event.key === "ArrowDown") next += size;
                      if (next !== index) {
                        event.preventDefault();
                        moveFocus(next);
                      }
                    }}
                    ref={(node) => { buttonRefs.current[index] = node; }}
                    role="gridcell"
                    style={{ left: position(x), top: position(y) }}
                    tabIndex={focusIndex === index ? 0 : -1}
                    type="button"
                  >
                    {stone ? <span aria-hidden="true" className={`interactive-learn-board__stone is-${stone}`} /> : null}
                    {lastMove?.x === x && lastMove.y === y ? <span aria-hidden="true" className="interactive-learn-board__last" /> : null}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
      </div>
    </div>
  );
}

export const InteractiveLearnBoard = memo(InteractiveLearnBoardComponent);
