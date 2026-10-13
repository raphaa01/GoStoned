"use client";

import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useI18n } from "@/components/i18n/I18nProvider";
import { finishedGamePosition, type FinishedGameMove } from "@/lib/game/finishedGameReplay";
import { removeDeadStones } from "@/lib/game/scoring";
import type { Board, BoardSize, Position } from "@/lib/game/types";
import { getSharedGameCopy } from "@/lib/i18n/sharedGame";
import { GoBoard } from "./GoBoard";
import styles from "./FinishedGameBoard.module.css";

export function FinishedGameBoard({ gameId, boardSize, board, moves, deadStones = [], territory }: {
  gameId: string;
  boardSize: BoardSize;
  board: Board;
  moves: readonly FinishedGameMove[];
  deadStones?: Position[];
  territory?: { black: Position[]; white: Position[] };
}) {
  const { dictionary, locale } = useI18n();
  const copy = getSharedGameCopy(locale);
  const [selection, setSelection] = useState<{ gameId: string; index: number } | null>(null);
  const index = selection?.gameId === gameId ? Math.min(selection.index, moves.length) : moves.length;
  const position = useMemo(() => finishedGamePosition(boardSize, moves, index), [boardSize, moves, index]);
  const atEnd = index === moves.length;
  const currentMove = moves[index - 1];
  const select = (next: number) => setSelection({ gameId, index: Math.max(0, Math.min(moves.length, next)) });

  useEffect(() => {
    const navigate = (event: KeyboardEvent) => {
      const target = event.target;
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey
        || document.querySelector('[role="dialog"][aria-modal="true"]')
        || (target instanceof HTMLElement && target.closest('input, textarea, select, [contenteditable="true"]'))) return;
      const delta = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : null;
      if (delta === null && event.key !== "Home" && event.key !== "End") return;
      event.preventDefault();
      setSelection(current => {
        const previous = current?.gameId === gameId ? current.index : moves.length;
        const next = event.key === "Home" ? 0 : event.key === "End" ? moves.length : previous + delta!;
        return { gameId, index: Math.max(0, Math.min(moves.length, next)) };
      });
    };
    window.addEventListener("keydown", navigate);
    return () => window.removeEventListener("keydown", navigate);
  }, [gameId, moves.length]);

  return <div className={styles.replay}>
    <GoBoard
      boardSize={boardSize}
      boardState={atEnd ? territory ? removeDeadStones(board, deadStones) : board : position.board}
      deadStones={atEnd && !territory ? deadStones : undefined}
      territory={atEnd ? territory : undefined}
      disabled
      lastMove={position.lastMove}
      onIntersectionClick={() => undefined}
      precisionRevision={`replay:${gameId}:${index}`}
    />
    <div className={styles.controls} role="group" aria-label={copy.navigation}>
      <button type="button" aria-label={copy.firstMove} title={copy.firstMove} disabled={index === 0} onClick={() => select(0)}><ChevronsLeft size={20} /></button>
      <button type="button" aria-label={copy.previousMove} title={copy.previousMove} disabled={index === 0} onClick={() => select(index - 1)}><ChevronLeft size={20} /></button>
      <span className={styles.progress} aria-live="polite" aria-atomic="true">
        <strong>{dictionary.game.move} {index} <span>/ {moves.length}</span></strong>
        <small>{atEnd ? copy.finalPosition : currentMove?.isPass ? `${currentMove.color === "black" ? dictionary.game.black : dictionary.game.white} · ${dictionary.game.pass}` : index === 0 ? copy.startPosition : "\u00a0"}</small>
      </span>
      <button type="button" aria-label={copy.nextMove} title={copy.nextMove} disabled={atEnd} onClick={() => select(index + 1)}><ChevronRight size={20} /></button>
      <button type="button" aria-label={copy.lastMove} title={copy.lastMove} disabled={atEnd} onClick={() => select(moves.length)}><ChevronsRight size={20} /></button>
    </div>
  </div>;
}
