"use client";

import { Eye, Home, Minus, RotateCcw, Trophy, XCircle } from "lucide-react";
import { type RefObject, useId, useRef, useState } from "react";
import { useI18n } from "@/components/i18n/I18nProvider";
import { ModalDialog } from "@/components/ui/ModalDialog";
import type { GameState } from "@/lib/game/types";
import { localizedGameResult } from "@/lib/game/gameAccessibility";
import { localizedRulesSummary } from "@/lib/i18n/gameTerms";
import { RatingLabel } from "@/components/rating/RatingLabel";

type GameResultModalProps = {
  game: GameState;
  open: boolean;
  playerKey: string;
  onHome: () => void;
  onPlayAgain: () => void;
  onViewBoard: () => void;
  finalFocusRef?: RefObject<HTMLElement | null>;
};

export function GameResultModal({
  game,
  open,
  playerKey,
  onHome,
  onPlayAgain,
  onViewBoard,
  finalFocusRef,
}: GameResultModalProps) {
  const { dictionary, locale } = useI18n();
  const copy = dictionary.game;
  const rulesSummary = localizedRulesSummary(game, dictionary);
  const titleId = useId();
  const descriptionId = useId();
  const playAgainButton = useRef<HTMLButtonElement>(null);
  const exitingRef = useRef(false);
  const [exiting, setExiting] = useState(false);

  async function exitResult(action: () => void | Promise<void>) {
    if (exitingRef.current) return;
    exitingRef.current = true;
    setExiting(true);
    try {
      await action();
    } catch {
      exitingRef.current = false;
      setExiting(false);
    }
  }

  if (!open) return null;

  const noResult = game.finishReason === "japanese_no_result"
    || game.finishReason === "japanese_repetition";
  const draw = !game.winnerKey && !noResult;
  const neutralOutcome = draw || noResult;
  const won = game.winnerKey === playerKey;
  const outcome = noResult ? copy.noResult : draw ? copy.draw : won ? copy.victory : copy.defeat;
  const OutcomeIcon = neutralOutcome ? Minus : won ? Trophy : XCircle;
  const deadCounts = (game.scoring?.deadStones ?? []).reduce(
    (counts, { x, y }) => {
      const color = game.board[y]?.[x];
      if (color) counts[color] += 1;
      return counts;
    },
    { black: 0, white: 0 },
  );

  return (
    <ModalDialog
      backdropClassName="modal-backdrop--result"
      className={`result-modal ${neutralOutcome ? "is-draw" : won ? "is-win" : "is-loss"}`}
      descriptionId={descriptionId}
      finalFocusRef={finalFocusRef}
      initialFocusRef={playAgainButton}
      onDismiss={exiting ? undefined : () => void exitResult(onViewBoard)}
      open={open}
      titleId={titleId}
    >
        <div className="result-modal-header">
          <span className="result-modal-icon"><OutcomeIcon size={27} /></span>
          <div>
            <span className="result-modal-kicker">{copy.complete}</span>
            <h2 id={titleId}>{outcome}</h2>
            <p id={descriptionId}>
              {localizedGameResult(game.result, copy)} {game.rated
                ? copy.ratedResultSaved
                : copy.unratedResultSaved}
            </p>
          </div>
          <strong className="result-code">{game.result ?? copy.draw}</strong>
        </div>

        <div className="result-player-list">
          <div className={game.winnerKey === game.blackPlayerKey ? "is-winner" : ""}>
            <span className="player-stone player-stone--black" />
            <span>
              <strong>{game.blackPlayerName}</strong>
              <small>{game.blackPlayerKey === playerKey ? copy.youBlack : copy.black}</small>
              {game.blackRating !== null && game.blackRating !== undefined
                ? <RatingLabel rating={game.blackRating} preference={game.ratingDisplayPreference ?? "both"} locale={locale} />
                : null}
            </span>
            {game.winnerKey === game.blackPlayerKey ? <b>{copy.winner}</b> : null}
          </div>
          <div className={game.winnerKey === game.whitePlayerKey ? "is-winner" : ""}>
            <span className="player-stone player-stone--white" />
            <span>
              <strong>{game.whitePlayerName}</strong>
              <small>{game.whitePlayerKey === playerKey ? copy.youWhite : copy.white}</small>
              {game.whiteRating !== null && game.whiteRating !== undefined
                ? <RatingLabel rating={game.whiteRating} preference={game.ratingDisplayPreference ?? "both"} locale={locale} />
                : null}
            </span>
            {game.winnerKey === game.whitePlayerKey ? <b>{copy.winner}</b> : null}
          </div>
        </div>

        {game.rated && game.viewerRatingChange !== null && game.viewerRatingChange !== undefined ? (
          <p className="result-rating-change">
            {dictionary.profile.ratingChange}: {game.viewerRatingChange > 0 ? "+" : ""}{Math.round(game.viewerRatingChange)}
          </p>
        ) : null}

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
            {"blackPrisoners" in game.scoring.preview ? (
              <>
                <div>
                  <span>
                    <small>{copy.blackTerritoryPrisoners}</small>
                    <strong>{game.scoring.preview.blackTerritory} · {game.scoring.preview.blackPrisoners}</strong>
                  </span>
                  <span>
                    <small>{copy.whiteTerritoryPrisoners}</small>
                    <strong>{game.scoring.preview.whiteTerritory} · {game.scoring.preview.whitePrisoners}</strong>
                  </span>
                </div>
                <p>
                  {rulesSummary} · {copy.dame.toLocaleLowerCase()} {game.scoring.preview.neutralPoints}
                  {" · "}{copy.dead.toLocaleLowerCase()}: {deadCounts.black} {copy.black.toLocaleLowerCase()}, {deadCounts.white} {copy.white.toLocaleLowerCase()}
                </p>
              </>
            ) : (
              <>
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
              </>
            )}
          </section>
        ) : null}

        <button
          className="button button--primary result-primary"
          disabled={exiting}
          onClick={() => void exitResult(onPlayAgain)}
          ref={playAgainButton}
          type="button"
        >
          <RotateCcw size={18} />
          {copy.findAnother}
        </button>
        <span aria-atomic="true" aria-live="polite" className="sr-only" role="status">
          {exiting ? dictionary.common.pleaseWait : ""}
        </span>
        <div className="result-secondary-actions">
          <button disabled={exiting} onClick={() => void exitResult(onViewBoard)} type="button"><Eye size={16} /> {copy.viewBoard}</button>
          <button disabled={exiting} onClick={() => void exitResult(onHome)} type="button"><Home size={16} /> {copy.home}</button>
        </div>
    </ModalDialog>
  );
}
