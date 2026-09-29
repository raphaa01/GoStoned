"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useI18n } from "@/components/i18n/I18nProvider";
import {
  BOARD_GRID_INSET_RATIO,
  BOARD_GRID_SPAN_RATIO,
  boardPositionFromClientPoint,
  TOUCH_LENS_RADIUS,
  touchLensCoordinates,
} from "@/lib/client/precisionPlacement";
import {
  formatBoardLabel,
  goColumnLabel,
  goCoordinate,
  isBoardNavigationKey,
  joinBoardLabels,
  moveBoardFocus,
} from "@/lib/game/boardAccessibility";
import type { Board, Position, Stone } from "@/lib/game/types";

type GoBoardProps = {
  boardSize: 9 | 13 | 19;
  boardState: Board;
  onIntersectionClick: (x: number, y: number) => void;
  disabled?: boolean;
  interactionMode?: "play" | "mark-dead";
  deadStones?: Position[];
  selectedDeadStones?: Position[];
  lastMove?: Position | null;
  pendingMove?: (Position & { color: Stone }) | null;
  previewColor?: Stone;
  precisionRevision: string;
  hintMove?: Position | null;
};

type TouchLens = {
  pointerId: number;
  position: Position;
  left: number;
  top: number;
  revision: string;
};

const TOUCH_LENS_DELAY_MS = 180;
const TOUCH_MOVE_TOLERANCE_PX = 10;

function TouchMagnifier({
  board,
  center,
  previewColor,
}: {
  board: Board;
  center: Position;
  previewColor: Stone;
}) {
  const cells = touchLensCoordinates(center, board.length as 9 | 13 | 19);
  const firstValidColumn = Math.max(0, TOUCH_LENS_RADIUS - center.x) + 0.5;
  const lastValidColumn = Math.min(6, TOUCH_LENS_RADIUS + board.length - 1 - center.x) + 0.5;
  const firstValidRow = Math.max(0, TOUCH_LENS_RADIUS - center.y) + 0.5;
  const lastValidRow = Math.min(6, TOUCH_LENS_RADIUS + board.length - 1 - center.y) + 0.5;
  return (
    <svg aria-hidden="true" className="touch-magnifier-board" viewBox="0 0 7 7">
      <rect className="touch-magnifier-surface" height="7" width="7" />
      {Array.from({ length: 7 }, (_, index) => {
        const x = center.x + index - TOUCH_LENS_RADIUS;
        return x >= 0 && x < board.length ? (
          <line className="touch-magnifier-grid" key={`v-${index}`} x1={index + 0.5} x2={index + 0.5} y1={firstValidRow} y2={lastValidRow} />
        ) : null;
      })}
      {Array.from({ length: 7 }, (_, index) => {
        const y = center.y + index - TOUCH_LENS_RADIUS;
        return y >= 0 && y < board.length ? (
          <line className="touch-magnifier-grid" key={`h-${index}`} x1={firstValidColumn} x2={lastValidColumn} y1={index + 0.5} y2={index + 0.5} />
        ) : null;
      })}
      {cells.map((position, index) => {
        if (!position) return null;
        const stone = board[position.y]?.[position.x];
        if (!stone) return null;
        return <circle className={`touch-magnifier-stone touch-magnifier-stone--${stone}`} cx={(index % 7) + 0.5} cy={Math.floor(index / 7) + 0.5} key={`${position.x}:${position.y}`} r="0.4" />;
      })}
      {!board[center.y]?.[center.x] ? <circle className={`touch-magnifier-preview touch-magnifier-preview--${previewColor}`} cx="3.5" cy="3.5" r="0.38" /> : null}
      <path className="touch-magnifier-crosshair" d="M3.5 2.98v1.04M2.98 3.5h1.04" />
      <circle className="touch-magnifier-ring" cx="3.5" cy="3.5" r="0.55" />
    </svg>
  );
}

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
  selectedDeadStones = [],
  lastMove = null,
  pendingMove = null,
  previewColor = "black",
  precisionRevision,
  hintMove = null,
}: GoBoardProps) {
  const { dictionary } = useI18n();
  const copy = dictionary.game;
  const instructionsId = useId();
  const buttonRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const boardRef = useRef<HTMLDivElement>(null);
  const pointerTypeRef = useRef<"keyboard" | "mouse" | "pen" | "touch">("keyboard");
  const touchPointersRef = useRef(new Set<number>());
  const touchGestureRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    moved: boolean;
    multiTouch: boolean;
    timer: number;
  } | null>(null);
  const touchLensRef = useRef<TouchLens | null>(null);
  const suppressTouchClickUntilRef = useRef(0);
  const [touchLens, setTouchLens] = useState<TouchLens | null>(null);
  const visibleTouchLens = touchLens?.revision === precisionRevision ? touchLens : null;
  const [focusIndex, setFocusIndex] = useState(() => {
    if (interactionMode !== "mark-dead") return 0;
    const firstStone = boardState.flat().findIndex(Boolean);
    return firstStone >= 0 ? firstStone : 0;
  });
  const gridLines = Array.from({ length: boardSize });
  const gridPosition = (value: number) => `${(value / (boardSize - 1)) * 100}%`;
  const intersectionPosition = (value: number) =>
    `${(
      BOARD_GRID_INSET_RATIO
      + (value / (boardSize - 1)) * BOARD_GRID_SPAN_RATIO
    ) * 100}%`;
  const deadStoneKeys = new Set(deadStones.map(({ x, y }) => `${x}:${y}`));
  const selectedDeadStoneKeys = new Set(
    selectedDeadStones.map(({ x, y }) => `${x}:${y}`),
  );
  const positionAt = (clientX: number, clientY: number) => {
    const board = boardRef.current;
    if (!board) return null;
    return boardPositionFromClientPoint(clientX, clientY, board.getBoundingClientRect(), boardSize);
  };

  const preciseTouchEnabled = () => boardSize === 19
    && interactionMode === "play"
    && !disabled
    && window.matchMedia("(pointer: coarse) and (max-width: 620px)").matches;

  const clearTouchGesture = () => {
    const gesture = touchGestureRef.current;
    if (gesture) window.clearTimeout(gesture.timer);
    touchGestureRef.current = null;
  };

  const clearTouchLens = () => {
    touchLensRef.current = null;
    setTouchLens(null);
  };

  useEffect(() => {
    clearTouchGesture();
    touchLensRef.current = null;
  }, [precisionRevision, boardSize, disabled, interactionMode]);

  useEffect(() => {
    const board = boardRef.current;
    if (!board) return;
    const preventScrollWhileAiming = (event: TouchEvent) => {
      if (touchLensRef.current) event.preventDefault();
    };
    board.addEventListener("touchmove", preventScrollWhileAiming, { passive: false });
    return () => board.removeEventListener("touchmove", preventScrollWhileAiming);
  }, []);

  function updateTouchLens(pointerId: number, clientX: number, clientY: number) {
    const board = boardRef.current;
    const position = positionAt(clientX, clientY);
    if (!board || !position) return;
    const bounds = board.getBoundingClientRect();
    const lens = {
      pointerId,
      position,
      left: clientX - bounds.left,
      top: clientY - bounds.top,
      revision: precisionRevision,
    };
    touchLensRef.current = lens;
    setTouchLens(lens);
    setFocusIndex(position.y * boardSize + position.x);
  }

  const handleBoardPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== "touch" || !preciseTouchEnabled()) return;
    pointerTypeRef.current = "touch";
    touchPointersRef.current.add(event.pointerId);
    if (touchPointersRef.current.size > 1) {
      if (touchGestureRef.current) touchGestureRef.current.multiTouch = true;
      return;
    }
    const gesture = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
      multiTouch: false,
      timer: 0,
    };
    gesture.timer = window.setTimeout(() => {
      if (touchGestureRef.current !== gesture || gesture.moved || gesture.multiTouch) return;
      boardRef.current?.setPointerCapture(gesture.pointerId);
      suppressTouchClickUntilRef.current = performance.now() + 1_000;
      updateTouchLens(gesture.pointerId, gesture.startX, gesture.startY);
    }, TOUCH_LENS_DELAY_MS);
    touchGestureRef.current = gesture;
  };

  const handleBoardPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const gesture = touchGestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    if (touchLensRef.current?.pointerId === event.pointerId) {
      event.preventDefault();
      updateTouchLens(event.pointerId, event.clientX, event.clientY);
      return;
    }
    if (Math.hypot(event.clientX - gesture.startX, event.clientY - gesture.startY) > TOUCH_MOVE_TOLERANCE_PX) {
      gesture.moved = true;
      window.clearTimeout(gesture.timer);
    }
  };

  const handleBoardPointerEnd = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== "touch") {
      return;
    }
    touchPointersRef.current.delete(event.pointerId);
    const gesture = touchGestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) {
      if (touchPointersRef.current.size === 0) touchGestureRef.current = null;
      return;
    }
    window.clearTimeout(gesture.timer);
    touchGestureRef.current = null;
    const activeLens = touchLensRef.current?.pointerId === event.pointerId
      ? touchLensRef.current
      : null;
    if (activeLens) {
      suppressTouchClickUntilRef.current = performance.now() + 1_000;
      event.preventDefault();
      clearTouchLens();
      const { x, y } = activeLens.position;
      if (!boardState[y]?.[x]) onIntersectionClick(x, y);
      return;
    }
    if (gesture.moved || gesture.multiTouch || touchPointersRef.current.size > 0) {
      suppressTouchClickUntilRef.current = performance.now() + 750;
      event.preventDefault();
      return;
    }
    pointerTypeRef.current = "touch";
  };

  const handleBoardPointerCancel = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== "touch") return;
    touchPointersRef.current.delete(event.pointerId);
    if (touchGestureRef.current?.pointerId === event.pointerId) {
      clearTouchGesture();
    }
    clearTouchLens();
    pointerTypeRef.current = "keyboard";
  };

  return (
    <div
      className="go-board-shell"
      data-touch-lens={visibleTouchLens ? "true" : "false"}
      onClickCapture={(event) => {
        if (
          event.detail > 0
          && pointerTypeRef.current !== "keyboard"
          && performance.now() <= suppressTouchClickUntilRef.current
        ) {
          event.preventDefault();
          event.stopPropagation();
          suppressTouchClickUntilRef.current = 0;
          pointerTypeRef.current = "keyboard";
        }
      }}
      onPointerDownCapture={() => {
        if (
          suppressTouchClickUntilRef.current > 0
          && performance.now() <= suppressTouchClickUntilRef.current
        ) {
          suppressTouchClickUntilRef.current = 0;
        }
      }}
    >
      <div className="go-board-viewport">
        <div
          aria-colcount={boardSize}
          aria-describedby={instructionsId}
          aria-label={`${boardSize} × ${boardSize} ${copy.goBoard}`}
          aria-rowcount={boardSize}
          className="go-board"
          ref={boardRef}
          style={
            {
              "--board-size": boardSize,
              "--board-grid-inset": `${BOARD_GRID_INSET_RATIO * 100}%`,
              "--board-grid-span": `${BOARD_GRID_SPAN_RATIO * 100}%`,
              "--grid-step": `${100 / (boardSize - 1)}%`,
              "--intersection-size": `${(BOARD_GRID_SPAN_RATIO * 100) / (boardSize - 1)}%`,
            } as React.CSSProperties
          }
          data-size={boardSize}
          data-interaction-mode={interactionMode}
          data-preview-color={previewColor}
          onPointerCancelCapture={handleBoardPointerCancel}
          onPointerDownCapture={handleBoardPointerDown}
          onPointerMoveCapture={handleBoardPointerMove}
          onPointerUpCapture={handleBoardPointerEnd}
          role="grid"
        >
      {visibleTouchLens ? (
        <div
          className="touch-magnifier"
          style={{ "--touch-x": `${visibleTouchLens.left}px`, "--touch-y": `${visibleTouchLens.top}px` } as React.CSSProperties}
        >
          <TouchMagnifier board={boardState} center={visibleTouchLens.position} previewColor={previewColor} />
        </div>
      ) : null}
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
        className="go-board-points"
      >
        {gridLines.map((_, y) => (
          <div aria-rowindex={y + 1} key={`row-${y}`} role="row">
            {gridLines.map((__, x) => {
              const index = y * boardSize + x;
              const serverStone = boardState[y]?.[x] ?? null;
              const pendingStone = !serverStone
                && pendingMove?.x === x
                && pendingMove.y === y
                  ? pendingMove.color
                  : null;
              const stone = serverStone ?? pendingStone;
              const isPendingMove = pendingStone !== null;
              const markedDead = deadStoneKeys.has(`${x}:${y}`);
              const disputeSelected = selectedDeadStoneKeys.has(`${x}:${y}`);
              const stoneLabel = stone === "black" ? copy.blackStone : copy.whiteStone;
              const groupLabel = stone === "black" ? copy.blackGroup : copy.whiteGroup;
              const coordinate = goCoordinate(boardSize, x, y);
              const isLastMove = lastMove?.x === x && lastMove.y === y;
              const isPrecisionPreview = visibleTouchLens?.position.x === x && visibleTouchLens.position.y === y;
              const isHint = hintMove?.x === x && hintMove.y === y;
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
                      : joinBoardLabels(
                          formatBoardLabel(
                            actionable ? copy.placeStoneLabel : copy.emptyIntersectionLabel,
                            { coordinate },
                          ),
                          isPrecisionPreview && copy.precisionPreviewState,
                        )
                  }
                  aria-selected={interactionMode === "mark-dead"
                    ? stone ? markedDead : undefined
                    : isPrecisionPreview || undefined}
                  className={`intersection ${isStarPoint(boardSize, x, y) ? "is-star" : ""} ${markedDead ? "is-dead" : ""} ${disputeSelected ? "is-dispute-selected" : ""} ${isPrecisionPreview ? "is-precision-preview" : ""} ${isHint ? "is-hint" : ""} ${isPendingMove ? "is-pending-move" : ""}`}
                  key={`${x}-${y}`}
                  onClick={(event) => {
                    if (
                      event.detail > 0
                      && pointerTypeRef.current === "touch"
                      && performance.now() <= suppressTouchClickUntilRef.current
                    ) {
                      pointerTypeRef.current = "keyboard";
                      return;
                    }
                    pointerTypeRef.current = "keyboard";
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
                  onPointerCancel={() => {
                    pointerTypeRef.current = "keyboard";
                  }}
                  onPointerDown={(event) => {
                    pointerTypeRef.current = event.pointerType === "touch"
                      || event.pointerType === "pen"
                      || event.pointerType === "mouse"
                      ? event.pointerType
                      : "mouse";
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
                  {disputeSelected ? (
                    <span aria-hidden="true" className="dispute-selection-mark" />
                  ) : null}
                  {isLastMove ? <span aria-hidden="true" className="last-move-mark" /> : null}
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
