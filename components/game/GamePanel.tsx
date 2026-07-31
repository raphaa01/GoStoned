"use client";

import {
  Check,
  CircleDot,
  Flag,
  Play,
  RotateCcw,
  SkipForward,
  Undo2,
} from "lucide-react";
import { useState } from "react";
import { useI18n } from "@/components/i18n/I18nProvider";
import { formatBoardLabel, goCoordinate } from "@/lib/game/boardAccessibility";
import { groupMarkedDeadStones } from "@/lib/game/scoring";
import type { GameState, Position, Stone } from "@/lib/game/types";
import { localizedRulesSummary } from "@/lib/i18n/gameTerms";
import { PlayerClock } from "./PlayerClock";
import { ScoringDecisionCountdown } from "./ScoringDecisionCountdown";

function deadStoneCounts(game: GameState) {
  return (game.scoring?.deadStones ?? []).reduce(
    (counts, { x, y }) => {
      const color = game.board[y]?.[x];
      if (color) counts[color] += 1;
      return counts;
    },
    { black: 0, white: 0 },
  );
}

type GamePanelProps = {
  game: GameState;
  playerKey: string;
  busy: boolean;
  clockObservedAt: number | null;
  interactionDisabled: boolean;
  onPass: () => void;
  onResign: () => void;
  onConfirmScore: () => void;
  onResetScoring: () => void;
  onResolveDeadline: () => void;
  onResumeJapanesePlay: () => void;
  onResumePlay: (claim: "dead" | "alive", disputedStone: Position) => void;
  onUndoScoring: () => void;
  onLeave: () => void;
};

export function GamePanel({
  game,
  playerKey,
  busy,
  clockObservedAt,
  interactionDisabled,
  onPass,
  onResign,
  onConfirmScore,
  onResetScoring,
  onResolveDeadline,
  onResumeJapanesePlay,
  onResumePlay,
  onUndoScoring,
  onLeave,
}: GamePanelProps) {
  const { dictionary } = useI18n();
  const copy = dictionary.game;
  const rulesSummary = localizedRulesSummary(game, dictionary);
  const [selectedGroupKey, setSelectedGroupKey] = useState("");
  const yourColor: Stone | null = game.blackPlayerKey === playerKey
    ? "black"
    : game.whitePlayerKey === playerKey
      ? "white"
      : null;
  const controlsDisabled = busy || interactionDisabled || !yourColor;
  const yourTurn = Boolean(
    !interactionDisabled
    && yourColor
    && game.status === "active"
    && game.turn === yourColor,
  );
  const scoring = game.phase === "scoring" ? game.scoring : null;
  const activeScoring = game.status === "active" ? scoring : null;
  const japanesePreview = activeScoring
    && game.rulesProfile === "japanese-1989-gostone-v1"
    && game.ruleset === "japanese"
    && game.scoringMethod === "territory"
    && "blackPrisoners" in activeScoring.preview
    ? activeScoring.preview
    : null;
  const japaneseScoring = japanesePreview ? activeScoring : null;
  const suggestionPending = japaneseScoring?.suggestion?.status === "pending";
  const scoringControlsDisabled = controlsDisabled || suggestionPending;
  const disputeGroups = groupMarkedDeadStones(game.board, game.scoring?.deadStones ?? []);
  const selectedGroup = disputeGroups.find(({ key }) => key === selectedGroupKey)
    ?? disputeGroups[0]
    ?? null;
  const deadCounts = deadStoneCounts(game);
  const youConfirmed = yourColor === "black"
    ? scoring?.blackConfirmed
    : yourColor === "white"
      ? scoring?.whiteConfirmed
      : false;
  const resultText =
    game.status === "finished"
      ? game.finishReason === "japanese_no_result"
        ? `${copy.gameOver} · ${copy.noResult}`
        : !yourColor
        ? `${copy.gameOver} · ${game.result}`
        : game.winnerKey === playerKey
        ? `${copy.youWon} · ${game.result}`
        : game.winnerKey
          ? `${copy.youLost} · ${game.result}`
          : `${copy.draw} · ${game.result}`
        : interactionDisabled
        ? copy.controlsPaused
        : activeScoring
        ? copy.agreeFinalPosition
        : yourTurn
        ? copy.yourTurn
        : copy.opponentTurn;

  return (
    <aside className="game-panel">
      <div className={`game-panel-player ${yourColor === "white" ? "is-you" : ""}`}>
        <span className="player-stone player-stone--white" />
        <div className="game-player-name">
          <strong>{game.whitePlayerName}</strong>
          <span>{game.whitePlayerIsBot ? `${copy.botOpponent} · ${copy.white}` : yourColor === "white" ? copy.youWhite : copy.opponentWhite}</span>
        </div>
        <PlayerClock
          clock={game.clock}
          color="white"
          observedAt={clockObservedAt}
          running={game.status === "active" && game.turn === "white"}
        />
      </div>

      <div className="game-meta-strip">
        <span><CircleDot size={15} /> {game.boardSize}×{game.boardSize}</span>
        <span>{dictionary.timeControls[game.timeControl].name}</span>
        <span>{game.phase === "scoring" ? copy.scoring : `${copy.move} ${game.moveCount}`}</span>
      </div>

      <div className={`game-state ${yourTurn ? "is-your-turn" : ""}`}>
        <span className={`player-stone player-stone--${game.turn ?? yourColor ?? "black"}`} />
        <div>
          <strong>{resultText}</strong>
          <span>
            {game.status === "finished"
              ? game.rated ? copy.ratedResultSaved : copy.unratedResultSaved
              : interactionDisabled
                ? copy.lastVerifiedState
              : activeScoring
                ? copy.scoringInstructions
              : game.lastResume?.claim === "deadline"
                ? copy.scoringExpired
              : game.lastResume
                ? copy.disputeResumed
              : copy.movesVerified}
          </span>
        </div>
      </div>

      <div className={`game-panel-player ${yourColor === "black" ? "is-you" : ""}`}>
        <span className="player-stone player-stone--black" />
        <div className="game-player-name">
          <strong>{game.blackPlayerName}</strong>
          <span>{game.blackPlayerIsBot ? `${copy.botOpponent} · ${copy.black}` : yourColor === "black" ? copy.youBlack : copy.opponentBlack}</span>
        </div>
        <PlayerClock
          clock={game.clock}
          color="black"
          observedAt={clockObservedAt}
          running={game.status === "active" && game.turn === "black"}
        />
      </div>

      {japaneseScoring && japanesePreview ? (
        <div className="scoring-controls japanese-scoring-controls">
          <section aria-labelledby="japanese-scoring-guide" className="japanese-scoring-guide">
            <strong id="japanese-scoring-guide">{copy.japaneseScoringTitle}</strong>
            <ol>
              <li><b>1</b><span>{copy.japaneseScoringStepMark}</span></li>
              <li><b>2</b><span>{copy.japaneseScoringStepReview}</span></li>
              <li><b>3</b><span>{copy.japaneseScoringStepConfirm}</span></li>
            </ol>
          </section>

          <div className="japanese-suggestion" data-status={japaneseScoring.suggestion?.status ?? "unavailable"}>
            <strong>{copy.computerSuggestion}</strong>
            <span>
              {japaneseScoring.suggestion?.status === "pending"
                ? copy.suggestionPending
                : japaneseScoring.suggestion?.status === "ready"
                  ? copy.suggestionReady
                  : japaneseScoring.suggestion?.status === "low_confidence"
                    ? copy.suggestionLowConfidence
                    : japaneseScoring.suggestion?.status === "invalid"
                      ? copy.suggestionInvalid
                      : copy.suggestionUnavailable}
            </span>
          </div>

          <div className="scoring-preview" aria-label={copy.provisionalJapaneseScore}>
            <span><small>{copy.black}</small><strong>{japanesePreview.black}</strong></span>
            <span><small>{copy.white}</small><strong>{japanesePreview.white}</strong></span>
          </div>

          <ScoringDecisionCountdown
            actionLabel={copy.resolveDeadline}
            clock={game.clock}
            deadlineKey={`${game.id}:${japaneseScoring.revision}:${japaneseScoring.expiresAt}`}
            disabled={controlsDisabled}
            expiredLabel={copy.decisionDeadlineReached}
            expiresAt={japaneseScoring.expiresAt}
            label={copy.decisionTimeRemaining}
            onExpired={onResolveDeadline}
          />

          <div className="scoring-revision-feedback">
            <span>{copy.scoringRevision} <strong>{japaneseScoring.revision}</strong></span>
            <span>
              {copy.yourConfirmation}: <strong>{youConfirmed ? copy.confirmed : copy.notConfirmed}</strong>
            </span>
            <span>
              {copy.opponentConfirmation}: <strong>{(yourColor === "black" ? japaneseScoring.whiteConfirmed : japaneseScoring.blackConfirmed) ? copy.confirmed : copy.notConfirmed}</strong>
            </span>
          </div>

          <div className="japanese-score-breakdown" aria-label={copy.scoreBreakdown}>
            <strong>{copy.territoryScoringBreakdown}</strong>
            <span>
              {copy.black}: {japanesePreview.blackTerritory} {copy.territory.toLocaleLowerCase()}
              {" + "}{japanesePreview.blackPrisoners} {copy.prisoners}
            </span>
            <span>
              {copy.white}: {japanesePreview.whiteTerritory} {copy.territory.toLocaleLowerCase()}
              {" + "}{japanesePreview.whitePrisoners} {copy.prisoners}
              {" + "}{game.komi} {dictionary.rules.komi}
            </span>
            <span>
              {copy.dame}: {japanesePreview.neutralPoints}
              {" · "}{copy.dead}: {deadCounts.black} {copy.black.toLocaleLowerCase()}, {deadCounts.white} {copy.white.toLocaleLowerCase()}
            </span>
          </div>

          {japaneseScoring.finalResolution ? (
            <div className="final-resolution-note" role="note">
              <strong>{copy.finalResolutionTitle}</strong>
              <span>{copy.finalResolutionDescription}</span>
            </div>
          ) : (
            <p className="resumption-note">
              {copy.resumptionsRemaining}: <strong>{japaneseScoring.resumptionsRemaining ?? 0}</strong>.
              {" "}{copy.resumeOpponentMovesFirst}
            </p>
          )}

          <div className="game-actions scoring-actions japanese-scoring-actions">
            <button
              disabled={scoringControlsDisabled || Boolean(youConfirmed)}
              onClick={onConfirmScore}
              type="button"
            >
              <Check size={18} /> {youConfirmed ? copy.confirmed : copy.confirmScore}
            </button>
            <button
              disabled={scoringControlsDisabled || japaneseScoring.canUndo !== true}
              onClick={onUndoScoring}
              type="button"
            >
              <Undo2 size={18} /> {copy.undoScoringChange}
            </button>
            <button
              disabled={
                scoringControlsDisabled
                || japaneseScoring.canResetToSuggestion !== true
                || japaneseScoring.suggestion?.status !== "ready"
              }
              onClick={onResetScoring}
              type="button"
            >
              <RotateCcw size={18} /> {copy.resetToSuggestion}
            </button>
            <button
              disabled={scoringControlsDisabled || japaneseScoring.finalResolution === true}
              onClick={onResumeJapanesePlay}
              type="button"
            >
              <Play size={18} /> {copy.resumePlay}
            </button>
            <button disabled={controlsDisabled} onClick={onResign} type="button">
              <Flag size={18} /> {copy.resign}
            </button>
          </div>
        </div>
      ) : activeScoring ? (
        <div className="scoring-controls">
          <div className="scoring-preview" aria-label={copy.provisionalScore}>
            <span><small>{copy.black}</small><strong>{activeScoring.preview.black}</strong></span>
            <span><small>{copy.white}</small><strong>{activeScoring.preview.white}</strong></span>
          </div>
          <span className="scoring-note">
            {rulesSummary} · {copy.neutralShared}
            <br />
            {copy.respondBy}{" "}
            <time dateTime={activeScoring.expiresAt}>
              {new Date(activeScoring.expiresAt).toISOString().slice(11, 16)} UTC
            </time>
            ; {copy.autoResume}
          </span>
          <p>
            {copy.yourConfirmation}: <strong>{youConfirmed ? copy.confirmed : copy.waiting}</strong>
            <br />
            {copy.opponent}: <strong>{(yourColor === "black" ? activeScoring.whiteConfirmed : activeScoring.blackConfirmed) ? copy.confirmed : copy.waiting}</strong>
          </p>
          <details className="scoring-breakdown">
            <summary>{copy.scoreBreakdown}</summary>
            <span>
              {copy.black}: {activeScoring.preview.blackStones} {copy.stones} + {activeScoring.preview.blackTerritory} {copy.territory}
            </span>
            <span>
              {copy.white}: {activeScoring.preview.whiteStones} {copy.stones} + {activeScoring.preview.whiteTerritory} {copy.territory} + {game.komi} {dictionary.rules.komi}
            </span>
            <span>
              {copy.neutral}: {activeScoring.preview.neutralPoints}, {copy.sharedEqually} · {copy.dead}: {deadCounts.black} {copy.black.toLocaleLowerCase()}, {deadCounts.white} {copy.white.toLocaleLowerCase()}
            </span>
          </details>
          <label className="scoring-dispute-picker">
            <span>{copy.markedGroup}</span>
            <select
              disabled={controlsDisabled || disputeGroups.length === 0}
              onChange={(event) => setSelectedGroupKey(event.target.value)}
              value={selectedGroup?.key ?? ""}
            >
              {disputeGroups.length === 0 ? <option value="">{copy.markGroupFirst}</option> : null}
              {disputeGroups.map((group) => (
                <option key={group.key} value={group.key}>
                  {formatBoardLabel(copy.groupOptionLabel, {
                    group: group.color === "black" ? copy.blackGroupOption : copy.whiteGroupOption,
                    coordinate: goCoordinate(game.boardSize, group.representative.x, group.representative.y),
                    stoneCount: `${group.stones.length} ${group.stones.length === 1 ? copy.stone : copy.stones}`,
                  })}
                </option>
              ))}
            </select>
          </label>
          <div className="game-actions scoring-actions">
            <button disabled={controlsDisabled || Boolean(youConfirmed)} onClick={onConfirmScore} type="button">
              <Check size={18} /> {youConfirmed ? copy.confirmed : copy.confirmScore}
            </button>
            <button
              disabled={controlsDisabled || !selectedGroup}
              onClick={() => selectedGroup && onResumePlay("dead", selectedGroup.representative)}
              type="button"
            >
              <Play size={18} /> {copy.proveDead}
            </button>
            <button
              disabled={controlsDisabled || !selectedGroup}
              onClick={() => selectedGroup && onResumePlay("alive", selectedGroup.representative)}
              type="button"
            >
              <Play size={18} /> {copy.challengeDead}
            </button>
            <button disabled={controlsDisabled} onClick={onResign} type="button">
              <Flag size={18} /> {copy.resign}
            </button>
          </div>
        </div>
      ) : game.status === "active" ? (
        <div className="game-actions">
          <button disabled={!yourTurn || controlsDisabled} onClick={onPass} type="button">
            <SkipForward size={18} /> {copy.pass}
          </button>
          <button disabled={controlsDisabled} onClick={onResign} type="button">
            <Flag size={18} /> {copy.resign}
          </button>
        </div>
      ) : (
        <>
          {game.finishReason === "score" && scoring?.finalizedAt ? (
            <div className="final-score-summary">
              {"blackPrisoners" in scoring.preview ? (
                <>
                  <strong>{copy.agreedJapaneseScore}</strong>
                  <span>{copy.black} {scoring.preview.black} · {copy.white} {scoring.preview.white}</span>
                  <span>
                    {copy.black}: {scoring.preview.blackTerritory} {copy.territory.toLocaleLowerCase()} + {scoring.preview.blackPrisoners} {copy.prisoners}
                  </span>
                  <span>
                    {copy.white}: {scoring.preview.whiteTerritory} {copy.territory.toLocaleLowerCase()} + {scoring.preview.whitePrisoners} {copy.prisoners} + {game.komi} {dictionary.rules.komi}
                  </span>
                  <span>
                    {copy.dame}: {scoring.preview.neutralPoints} · {copy.dead}: {deadCounts.black} {copy.black.toLocaleLowerCase()}, {deadCounts.white} {copy.white.toLocaleLowerCase()}
                  </span>
                </>
              ) : (
                <>
                  <strong>{copy.agreedScore}</strong>
                  <span>{copy.black} {scoring.preview.black} · {copy.white} {scoring.preview.white}</span>
                  <span>
                    {scoring.deadStones.length} {copy.dead.toLocaleLowerCase()} {scoring.deadStones.length === 1 ? copy.stone : copy.stones}
                    {" · "}{rulesSummary} · {copy.neutralShared}
                  </span>
                  <span>
                    {copy.black}: {scoring.preview.blackStones} {copy.stones} + {scoring.preview.blackTerritory} {copy.territory}
                    {" · "}{copy.white}: {scoring.preview.whiteStones} {copy.stones} + {scoring.preview.whiteTerritory} {copy.territory} + {game.komi} {dictionary.rules.komi}
                  </span>
                  <span>
                    {copy.neutral}: {scoring.preview.neutralPoints}, {copy.sharedEqually} · {copy.dead}: {deadCounts.black} {copy.black.toLocaleLowerCase()}, {deadCounts.white} {copy.white.toLocaleLowerCase()}
                  </span>
                </>
              )}
            </div>
          ) : null}
          <button className="button button--primary game-leave" onClick={onLeave} type="button">
            {copy.findAnother}
          </button>
        </>
      )}
    </aside>
  );
}
