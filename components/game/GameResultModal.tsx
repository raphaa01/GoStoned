"use client";

import { Eye, Home, Minus, RotateCcw, Trophy, XCircle } from "lucide-react";
import { useEffect, useRef } from "react";
import { useI18n } from "@/components/i18n/I18nProvider";
import type { Dictionary } from "@/lib/i18n/dictionary";
import type { GameState } from "@/lib/game/types";
import { localizedRulesSummary } from "@/lib/i18n/gameTerms";

type GameResultModalProps = {
  game: GameState;
  open: boolean;
  playerKey: string;
  onHome: () => void;
  onPlayAgain: () => void;
  onViewBoard: () => void;
};

function resultDescription(result: string | null, copy: Dictionary["game"]) {
  if (!result) return copy.ended;
  const [winner, detail] = result.split("+");
  if (winner !== "B" && winner !== "W") return result;
  const color = winner === "B" ? copy.black : copy.white;
  if (detail === "R") return `${color} ${copy.winsResignation}`;
  if (detail === "T") return `${color} ${copy.winsTime}`;
  return `${color} ${copy.winsPoints} ${detail} ${copy.points}`;
}

export function GameResultModal({
  game,
  open,
  playerKey,
  onHome,
  onPlayAgain,
  onViewBoard,
}: GameResultModalProps) {
  const { dictionary } = useI18n();
  const copy = dictionary.game;
  const rulesSummary = localizedRulesSummary(game, dictionary);
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
  const outcome = draw ? copy.draw : won ? copy.victory : copy.defeat;
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
            <span className="result-modal-kicker">{copy.complete}</span>
            <h2 id="game-result-title">{outcome}</h2>
            <p>{resultDescription(game.result, copy)}</p>
          </div>
          <strong className="result-code">{game.result ?? copy.draw}</strong>
        </div>

        <div className="result-player-list">
          <div className={game.winnerKey === game.blackPlayerKey ? "is-winner" : ""}>
            <span className="player-stone player-stone--black" />
            <span>
              <strong>{game.blackPlayerName}</strong>
              <small>{game.blackPlayerKey === playerKey ? copy.youBlack : copy.black}</small>
            </span>
            {game.winnerKey === game.blackPlayerKey ? <b>{copy.winner}</b> : null}
          </div>
          <div className={game.winnerKey === game.whitePlayerKey ? "is-winner" : ""}>
            <span className="player-stone player-stone--white" />
            <span>
              <strong>{game.whitePlayerName}</strong>
              <small>{game.whitePlayerKey === playerKey ? copy.youWhite : copy.white}</small>
            </span>
            {game.winnerKey === game.whitePlayerKey ? <b>{copy.winner}</b> : null}
          </div>
        </div>

        <div className="result-facts">
          <span><small>{copy.board}</small><strong>{game.boardSize}×{game.boardSize}</strong></span>
          <span><small>{copy.moves}</small><strong>{game.moveCount}</strong></span>
          <span><small>{copy.clock}</small><strong>{dictionary.timeControls[game.timeControl].name}</strong></span>
        </div>

        {game.finishReason === "score" && game.scoring ? (
          <section className="result-score-details" aria-label={copy.agreedDetails}>
            <div>
              <span><small>{copy.blackTotal}</small><strong>{game.scoring.preview.black}</strong></span>
              <span><small>{copy.whiteTotal}</small><strong>{game.scoring.preview.white}</strong></span>
            </div>
            <div>
              <span>
                <small>{copy.blackStonesTerritory}</small>
                <strong>{game.scoring.preview.blackStones} · {game.scoring.preview.blackTerritory}</strong>
              </span>
              <span>
                <small>{copy.whiteStonesTerritory}</small>
                <strong>{game.scoring.preview.whiteStones} · {game.scoring.preview.whiteTerritory}</strong>
              </span>
            </div>
            <p>
              {rulesSummary} · {copy.neutral.toLocaleLowerCase()} {game.scoring.preview.neutralPoints}, {copy.sharedEqually}
              {" · "}{copy.dead.toLocaleLowerCase()}: {deadCounts.black} {copy.black.toLocaleLowerCase()}, {deadCounts.white} {copy.white.toLocaleLowerCase()}
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
          {copy.findAnother}
        </button>
        <div className="result-secondary-actions">
          <button onClick={onViewBoard} type="button"><Eye size={16} /> {copy.viewBoard}</button>
          <button onClick={onHome} type="button"><Home size={16} /> {copy.home}</button>
        </div>
      </section>
    </div>
  );
}
