"use client";

import { Eye, Home, Minus, RotateCcw, Trophy, XCircle } from "lucide-react";
import { useEffect, useRef } from "react";
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
  const playAgainButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    playAgainButton.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onViewBoard();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onViewBoard, open]);

  if (!open) return null;

  const draw = !game.winnerKey;
  const won = game.winnerKey === playerKey;
  const outcome = draw ? "Draw" : won ? "Victory" : "Defeat";
  const OutcomeIcon = draw ? Minus : won ? Trophy : XCircle;

  return (
    <div className="modal-backdrop modal-backdrop--result">
      <section
        aria-labelledby="game-result-title"
        aria-modal="true"
        className={`result-modal ${draw ? "is-draw" : won ? "is-win" : "is-loss"}`}
        role="dialog"
      >
        <div className="result-modal-hero">
          <span className="result-modal-icon"><OutcomeIcon size={34} /></span>
          <span className="result-modal-kicker">Game complete</span>
          <h2 id="game-result-title">{outcome}</h2>
          <p>{resultDescription(game.result)}</p>
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
          <span><small>Result</small><strong>{game.result ?? "Draw"}</strong></span>
        </div>

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
