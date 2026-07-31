"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { useI18n } from "@/components/i18n/I18nProvider";
import {
  activatePrecisionPlacement,
  boardPositionFromClientPoint,
  reconcilePrecisionPlacement,
  type PrecisionPlacementActivation,
  type PrecisionPlacementState,
  WHOLE_BOARD,
} from "@/lib/client/precisionPlacement";
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
  precisionRevision: string;
};

type PrecisionSession = {
  resetKey: string;
  state: PrecisionPlacementState;
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
  precisionRevision,
}: GoBoardProps) {
  const { dictionary, locale } = useI18n();
  const copy = dictionary.game;
  const instructionsId = useId();
  const buttonRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const boardRef = useRef<HTMLDivElement>(null);
  const precisionToolbarRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const pointerTypeRef = useRef<PrecisionPlacementActivation["pointerType"]>("keyboard");
  const touchPointersRef = useRef(new Set<number>());
  const touchGestureRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    moved: boolean;
    multiTouch: boolean;
  } | null>(null);
  const suppressTouchClickUntilRef = useRef(0);
  const resetKey = JSON.stringify([
    precisionRevision,
    locale,
    boardSize,
    interactionMode,
    disabled,
  ]);
  const [precisionSession, setPrecisionSession] = useState<PrecisionSession>(() => ({
    resetKey,
    state: WHOLE_BOARD,
  }));
  const precisionSessionRef = useRef(precisionSession);
  if (precisionSession.resetKey !== resetKey) {
    setPrecisionSession({ resetKey, state: WHOLE_BOARD });
  }
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
  const precisionContext = {
    boardSize,
    disabled,
    interactionMode,
    revision: resetKey,
  } as const;
  const reconciledPrecision = precisionSession.resetKey === resetKey
    ? reconcilePrecisionPlacement(precisionSession.state, precisionContext)
    : WHOLE_BOARD;
  const precisionPosition = reconciledPrecision.kind === "precision"
    ? reconciledPrecision.position
    : null;
  const precisionIndex = precisionPosition
    ? precisionPosition.y * boardSize + precisionPosition.x
    : null;

  useLayoutEffect(() => {
    precisionSessionRef.current = precisionSession;
  }, [precisionSession]);

  useLayoutEffect(() => {
    if (!precisionPosition || !boardRef.current || !viewportRef.current) return;
    const board = boardRef.current;
    const viewport = viewportRef.current;
    const ratio = (value: number) => (7 + (value / (boardSize - 1)) * 86) / 100;
    viewport.scrollTo({
      behavior: "auto",
      left: board.clientWidth * ratio(precisionPosition.x) - viewport.clientWidth / 2,
      top: board.clientHeight * ratio(precisionPosition.y) - viewport.clientHeight / 2,
    });
    const previewIndex = precisionPosition.y * boardSize + precisionPosition.x;
    const focusPreview = window.setTimeout(() => {
      precisionToolbarRef.current?.scrollIntoView({ block: "center", inline: "nearest" });
      buttonRefs.current[previewIndex]?.focus({ preventScroll: true });
    }, 0);
    return () => window.clearTimeout(focusPreview);
  }, [boardSize, precisionPosition]);

  const cancelPrecision = useCallback(() => {
    const restoreIndex = precisionIndex ?? focusIndex;
    pointerTypeRef.current = "keyboard";
    const nextSession = { resetKey, state: WHOLE_BOARD };
    precisionSessionRef.current = nextSession;
    setPrecisionSession(nextSession);
    window.requestAnimationFrame(() => buttonRefs.current[restoreIndex]?.focus());
  }, [focusIndex, precisionIndex, resetKey]);

  useEffect(() => {
    if (!precisionPosition) return;
    const cancelOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      cancelPrecision();
    };
    window.addEventListener("keydown", cancelOnEscape);
    return () => window.removeEventListener("keydown", cancelOnEscape);
  }, [cancelPrecision, precisionPosition]);

  const activateIntersection = (
    x: number,
    y: number,
    actionable: boolean,
    pointerType: PrecisionPlacementActivation["pointerType"],
  ) => {
    const storedSession = precisionSessionRef.current;
    const storedState = storedSession.resetKey === resetKey
      ? storedSession.state
      : WHOLE_BOARD;
    const result = activatePrecisionPlacement(
      reconcilePrecisionPlacement(storedState, precisionContext),
      precisionContext,
      {
        x,
        y,
        actionable,
        coarseMobile: pointerType === "touch"
          && window.matchMedia("(pointer: coarse) and (max-width: 620px)").matches,
        pointerType,
      },
    );
    const nextSession = { resetKey, state: result.state };
    precisionSessionRef.current = nextSession;
    setPrecisionSession(nextSession);
    if (result.state.kind === "precision") setFocusIndex(y * boardSize + x);
    if (result.submit) onIntersectionClick(x, y);
  };

  const activateBoardSurface = (
    event: React.PointerEvent<HTMLDivElement>,
    pointerType: "mouse" | "pen" | "touch",
  ) => {
    const board = boardRef.current;
    if (!board || !coarseMobileTouchEnabled()) return;
    const position = boardPositionFromClientPoint(
      event.clientX,
      event.clientY,
      board.getBoundingClientRect(),
      boardSize,
    );
    if (!position) return;
    suppressTouchClickUntilRef.current = event.timeStamp + 750;
    pointerTypeRef.current = pointerType;
    event.preventDefault();
    activateIntersection(
      position.x,
      position.y,
      !boardState[position.y]?.[position.x],
      pointerType,
    );
  };

  const coarseMobileTouchEnabled = () => boardSize === 19
    && interactionMode === "play"
    && !disabled
    && window.matchMedia("(pointer: coarse) and (max-width: 620px)").matches;

  const handleBoardPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== "touch" || !coarseMobileTouchEnabled()) return;
    pointerTypeRef.current = "touch";
    touchPointersRef.current.add(event.pointerId);
    if (touchPointersRef.current.size > 1) {
      if (touchGestureRef.current) touchGestureRef.current.multiTouch = true;
      return;
    }
    touchGestureRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
      multiTouch: false,
    };
  };

  const handleBoardPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const gesture = touchGestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    if (Math.hypot(event.clientX - gesture.startX, event.clientY - gesture.startY) > 10) {
      gesture.moved = true;
    }
  };

  const handleBoardPointerEnd = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== "touch") {
      if (
        (event.pointerType === "mouse" || event.pointerType === "pen")
        && !precisionPosition
      ) {
        activateBoardSurface(event, event.pointerType);
      }
      return;
    }
    touchPointersRef.current.delete(event.pointerId);
    const gesture = touchGestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) {
      if (touchPointersRef.current.size === 0) touchGestureRef.current = null;
      return;
    }
    touchGestureRef.current = null;
    if (gesture.moved || gesture.multiTouch || touchPointersRef.current.size > 0) {
      suppressTouchClickUntilRef.current = event.timeStamp + 750;
      event.preventDefault();
      return;
    }
    suppressTouchClickUntilRef.current = event.timeStamp + 750;
    pointerTypeRef.current = "touch";
    event.preventDefault();
    activateBoardSurface(event, "touch");
  };

  const handleBoardPointerCancel = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== "touch") return;
    touchPointersRef.current.delete(event.pointerId);
    if (touchGestureRef.current?.pointerId === event.pointerId) {
      touchGestureRef.current = null;
    }
    pointerTypeRef.current = "keyboard";
  };

  return (
    <div
      className="go-board-shell"
      data-precision={precisionPosition ? "true" : "false"}
      onClickCapture={(event) => {
        if (
          event.detail > 0
          && pointerTypeRef.current !== "keyboard"
          && event.timeStamp <= suppressTouchClickUntilRef.current
        ) {
          event.preventDefault();
          event.stopPropagation();
          suppressTouchClickUntilRef.current = 0;
          pointerTypeRef.current = "keyboard";
        }
      }}
      onPointerDownCapture={(event) => {
        if (
          suppressTouchClickUntilRef.current > 0
          && event.timeStamp <= suppressTouchClickUntilRef.current
        ) {
          suppressTouchClickUntilRef.current = 0;
        }
      }}
    >
      {precisionPosition ? (
        <div className="precision-placement-toolbar" ref={precisionToolbarRef}>
          <p aria-atomic="true" aria-live="polite" role="status">
            {formatBoardLabel(copy.precisionPlacementStatus, {
              coordinate: goCoordinate(boardSize, precisionPosition.x, precisionPosition.y),
            })}
          </p>
          <button onClick={cancelPrecision} type="button">{copy.showWholeBoard}</button>
        </div>
      ) : null}
      <div className="go-board-viewport" ref={viewportRef}>
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
              "--grid-step": `${100 / (boardSize - 1)}%`,
              "--intersection-size": `${86 / (boardSize - 1)}%`,
            } as React.CSSProperties
          }
          data-size={boardSize}
          data-interaction-mode={interactionMode}
          onPointerCancelCapture={handleBoardPointerCancel}
          onPointerDownCapture={handleBoardPointerDown}
          onPointerMoveCapture={handleBoardPointerMove}
          onPointerUpCapture={handleBoardPointerEnd}
          role="grid"
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
        className="go-board-points"
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
              const isPrecisionPreview = precisionPosition?.x === x && precisionPosition.y === y;
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
                  className={`intersection ${isStarPoint(boardSize, x, y) ? "is-star" : ""} ${markedDead ? "is-dead" : ""} ${isPrecisionPreview ? "is-precision-preview" : ""}`}
                  key={`${x}-${y}`}
                  onClick={(event) => {
                    if (
                      event.detail > 0
                      && pointerTypeRef.current === "touch"
                      && event.timeStamp <= suppressTouchClickUntilRef.current
                    ) {
                      pointerTypeRef.current = "keyboard";
                      return;
                    }
                    const pointerType = event.detail === 0 ? "keyboard" : pointerTypeRef.current;
                    pointerTypeRef.current = "keyboard";
                    activateIntersection(x, y, actionable, pointerType);
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
