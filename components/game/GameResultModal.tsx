"use client";

import { Eye, Home, Minus, RotateCcw, Trophy, XCircle } from "lucide-react";
import { useEffect, useRef } from "react";
import { getTimeControl } from "@/lib/game/timeControls";
import type { GameState } from "@/lib/game/types";

type GameResultModalProps = {
  game: GameState;
  open: boolean;
  playerKey: string;
  onHome: () => void;
  onPlayAgain: () => void;
  onViewBoard: () => void;
};

function resultDescription(result: string | null) {
  if (!result) return "The game has ended.";
  const [winner, detail] = result.split("+");
  if (winner !== "B" && winner !== "W") return result;
  const color = winner === "B" ? "Black" : "White";
  if (detail === "R") return `${color} wins by resignation`;
  if (detail === "T") return `${color} wins on time`;
  return `${color} wins by ${detail} points`;
}

export function GameResultModal({
  game,
  open,
  playerKey,
  onHome,
  onPlayAgain,
  onViewBoard,
}: GameResultModalProps) {
  const dialog = useRef<HTMLElement>(null);
  const playAgainButton = useRef<HTMLButtonElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const onViewBoardRef = useRef(onViewBoard);

  useEffect(() => {
    onViewBoardRef.current = onViewBoard;
  }, [onViewBoard]);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    previousFocus.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    document.body.style.overflow = "hidden";
    const backdrop = dialog.current?.parentElement;
    const background = backdrop?.parentElement
      ? Array.from(backdrop.parentElement.children).filter(
          (element): element is HTMLElement => element instanceof HTMLElement && element !== backdrop,
        )
      : [];
    const backgroundState = background.map((element) => ({
      element,
      inert: element.inert,
      ariaHidden: element.getAttribute("aria-hidden"),
    }));
    for (const element of background) {
      element.inert = true;
      element.setAttribute("aria-hidden", "true");
    }
    playAgainButton.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onViewBoardRef.current();
        return;
      }
      if (event.key !== "Tab" || !dialog.current) return;
      const focusable = Array.from(
        dialog.current.querySelectorAll<HTMLElement>(
          "button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex='-1'])",
        ),
      );
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.current.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || !dialog.current.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
      for (const { element, inert, ariaHidden } of backgroundState) {
        element.inert = inert;
        if (ariaHidden === null) element.removeAttribute("aria-hidden");
        else element.setAttribute("aria-hidden", ariaHidden);
      }
      if (previousFocus.current?.isConnected) previousFocus.current.focus();
    };
  }, [open]);

  if (!open) return null;

  const draw = !game.winnerKey;
  const won = game.winnerKey === playerKey;
  const outcome = draw ? "Draw" : won ? "Victory" : "Defeat";
  const OutcomeIcon = draw ? Minus : won ? Trophy : XCircle;
  const deadCounts = (game.scoring?.deadStones ?? []).reduce(
    (counts, { x, y }) => {
      const color = game.board[y]?.[x];
      if (color) counts[color] += 1;
      return counts;
    },
    { black: 0, white: 0 },
  );

  return (
    <div className="modal-backdrop modal-backdrop--result">
      <section
        aria-labelledby="game-result-title"
        aria-modal="true"
        className={`result-modal ${draw ? "is-draw" : won ? "is-win" : "is-loss"}`}
        ref={dialog}
        role="dialog"
        tabIndex={-1}
      >
        <div className="result-modal-header">
          <span className="result-modal-icon"><OutcomeIcon size={27} /></span>
          <div>
            <span className="result-modal-kicker">Game complete</span>
            <h2 id="game-result-title">{outcome}</h2>
            <p>{resultDescription(game.result)}</p>
          </div>
          <strong className="result-code">{game.result ?? "Draw"}</strong>
        </div>

        <div className="result-player-list">
          <div className={game.winnerKey === game.blackPlayerKey ? "is-winner" : ""}>
            <span className="player-stone player-stone--black" />
            <span>
              <strong>{game.blackPlayerName}</strong>
              <small>{game.blackPlayerKey === playerKey ? "You · Black" : "Black"}</small>
            </span>
            {game.winnerKey === game.blackPlayerKey ? <b>Winner</b> : null}
          </div>
          <div className={game.winnerKey === game.whitePlayerKey ? "is-winner" : ""}>
            <span className="player-stone player-stone--white" />
            <span>
              <strong>{game.whitePlayerName}</strong>
              <small>{game.whitePlayerKey === playerKey ? "You · White" : "White"}</small>
            </span>
            {game.winnerKey === game.whitePlayerKey ? <b>Winner</b> : null}
          </div>
        </div>

        <div className="result-facts">
          <span><small>Board</small><strong>{game.boardSize}×{game.boardSize}</strong></span>
          <span><small>Moves</small><strong>{game.moveCount}</strong></span>
          <span><small>Clock</small><strong>{getTimeControl(game.timeControl).name}</strong></span>
        </div>

        {game.finishReason === "score" && game.scoring ? (
          <section className="result-score-details" aria-label="Agreed scoring details">
            <div>
              <span><small>Black total</small><strong>{game.scoring.preview.black}</strong></span>
              <span><small>White total</small><strong>{game.scoring.preview.white}</strong></span>
            </div>
            <div>
              <span>
                <small>Black stones · territory</small>
                <strong>{game.scoring.preview.blackStones} · {game.scoring.preview.blackTerritory}</strong>
              </span>
              <span>
                <small>White stones · territory</small>
                <strong>{game.scoring.preview.whiteStones} · {game.scoring.preview.whiteTerritory}</strong>
              </span>
            </div>
            <p>
              Chinese 2002 · GoStone v1 · area · {game.komi} komi · neutral {game.scoring.preview.neutralPoints}, shared equally
              {" · "}dead: {deadCounts.black} black, {deadCounts.white} white
            </p>
          </section>
        ) : null}

        <button
          className="button button--primary result-primary"
          onClick={onPlayAgain}
          ref={playAgainButton}
          type="button"
        >
          <RotateCcw size={18} />
          Find another game
        </button>
        <div className="result-secondary-actions">
          <button onClick={onViewBoard} type="button"><Eye size={16} /> View board</button>
          <button onClick={onHome} type="button"><Home size={16} /> Home</button>
        </div>
      </section>
    </div>
  );
}
