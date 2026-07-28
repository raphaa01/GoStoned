"use client";

import { Check, CircleDot, Flag, Play, SkipForward } from "lucide-react";
import { useState } from "react";
import { groupMarkedDeadStones } from "@/lib/game/scoring";
import { getTimeControl } from "@/lib/game/timeControls";
import type { GameState, Position, Stone } from "@/lib/game/types";
import { PlayerClock } from "./PlayerClock";

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
  onPass: () => void;
  onResign: () => void;
  onConfirmScore: () => void;
  onResumePlay: (claim: "dead" | "alive", disputedStone: Position) => void;
  onLeave: () => void;
};

export function GamePanel({
  game,
  playerKey,
  busy,
  onPass,
  onResign,
  onConfirmScore,
  onResumePlay,
  onLeave,
}: GamePanelProps) {
  const [selectedGroupKey, setSelectedGroupKey] = useState("");
  const yourColor: Stone = game.blackPlayerKey === playerKey ? "black" : "white";
  const yourTurn = game.status === "active" && game.turn === yourColor;
  const scoring = game.phase === "scoring" ? game.scoring : null;
  const activeScoring = game.status === "active" ? scoring : null;
  const disputeGroups = groupMarkedDeadStones(game.board, game.scoring?.deadStones ?? []);
  const selectedGroup = disputeGroups.find(({ key }) => key === selectedGroupKey)
    ?? disputeGroups[0]
    ?? null;
  const deadCounts = deadStoneCounts(game);
  const youConfirmed = yourColor === "black"
    ? scoring?.blackConfirmed
    : scoring?.whiteConfirmed;
  const resultText =
    game.status === "finished"
      ? game.winnerKey === playerKey
        ? `You won · ${game.result}`
        : game.winnerKey
          ? `You lost · ${game.result}`
          : `Draw · ${game.result}`
        : activeScoring
        ? "Agree on the final position"
        : yourTurn
        ? "Your turn"
        : "Opponent's turn";

  return (
    <aside className="game-panel" aria-live="polite">
      <div className={`game-panel-player ${yourColor === "white" ? "is-you" : ""}`}>
        <span className="player-stone player-stone--white" />
        <div className="game-player-name">
          <strong>{game.whitePlayerName}</strong>
          <span>{yourColor === "white" ? "You · White" : "Opponent · White"}</span>
        </div>
        <PlayerClock
          clock={game.clock}
          color="white"
          running={game.status === "active" && game.turn === "white"}
        />
      </div>

      <div className="game-meta-strip">
        <span><CircleDot size={15} /> {game.boardSize}×{game.boardSize}</span>
        <span>{getTimeControl(game.timeControl).name}</span>
        <span>{game.phase === "scoring" ? "Scoring" : `Move ${game.moveCount}`}</span>
      </div>

      <div className={`game-state ${yourTurn ? "is-your-turn" : ""}`}>
        <span className={`player-stone player-stone--${game.turn ?? yourColor}`} />
        <div>
          <strong>{resultText}</strong>
          <span>
            {game.status === "finished"
              ? "Result and ratings saved."
              : activeScoring
                ? "Mark dead groups, then both players confirm the same position."
              : game.lastResume?.claim === "deadline"
                ? "The scoring window expired, so play resumed without a result."
              : game.lastResume
                ? "Play resumed to resolve a marked-group dispute on the board."
              : "Moves are checked and saved by the server."}
          </span>
        </div>
      </div>

      <div className={`game-panel-player ${yourColor === "black" ? "is-you" : ""}`}>
        <span className="player-stone player-stone--black" />
        <div className="game-player-name">
          <strong>{game.blackPlayerName}</strong>
          <span>{yourColor === "black" ? "You · Black" : "Opponent · Black"}</span>
        </div>
        <PlayerClock
          clock={game.clock}
          color="black"
          running={game.status === "active" && game.turn === "black"}
        />
      </div>

      {activeScoring ? (
        <div className="scoring-controls">
          <div className="scoring-preview" aria-label="Provisional Chinese area score">
            <span><small>Black</small><strong>{activeScoring.preview.black}</strong></span>
            <span><small>White</small><strong>{activeScoring.preview.white}</strong></span>
          </div>
          <span className="scoring-note">
            Chinese 2002 · GoStone v1 · area · {game.komi} komi · neutral points shared
            <br />
            Respond by{" "}
            <time dateTime={activeScoring.expiresAt}>
              {new Date(activeScoring.expiresAt).toISOString().slice(11, 16)} UTC
            </time>
            ; otherwise play resumes automatically.
          </span>
          <p>
            Your confirmation: <strong>{youConfirmed ? "confirmed" : "waiting"}</strong>
            <br />
            Opponent: <strong>{(yourColor === "black" ? activeScoring.whiteConfirmed : activeScoring.blackConfirmed) ? "confirmed" : "waiting"}</strong>
          </p>
          <details className="scoring-breakdown">
            <summary>Score breakdown</summary>
            <span>
              Black: {activeScoring.preview.blackStones} stones + {activeScoring.preview.blackTerritory} territory
            </span>
            <span>
              White: {activeScoring.preview.whiteStones} stones + {activeScoring.preview.whiteTerritory} territory + {game.komi} komi
            </span>
            <span>
              Neutral: {activeScoring.preview.neutralPoints}, shared equally · Dead: {deadCounts.black} black, {deadCounts.white} white
            </span>
          </details>
          <label className="scoring-dispute-picker">
            <span>Marked group to dispute</span>
            <select
              disabled={busy || disputeGroups.length === 0}
              onChange={(event) => setSelectedGroupKey(event.target.value)}
              value={selectedGroup?.key ?? ""}
            >
              {disputeGroups.length === 0 ? <option value="">Mark a group first</option> : null}
              {disputeGroups.map((group) => (
                <option key={group.key} value={group.key}>
                  {group.color === "black" ? "Black" : "White"} group at column {group.representative.x + 1}, row {group.representative.y + 1} · {group.stones.length} {group.stones.length === 1 ? "stone" : "stones"}
                </option>
              ))}
            </select>
          </label>
          <div className="game-actions scoring-actions">
            <button disabled={busy || Boolean(youConfirmed)} onClick={onConfirmScore} type="button">
              <Check size={18} /> {youConfirmed ? "Confirmed" : "Confirm score"}
            </button>
            <button
              disabled={busy || !selectedGroup}
              onClick={() => selectedGroup && onResumePlay("dead", selectedGroup.representative)}
              type="button"
            >
              <Play size={18} /> Prove marked group dead
            </button>
            <button
              disabled={busy || !selectedGroup}
              onClick={() => selectedGroup && onResumePlay("alive", selectedGroup.representative)}
              type="button"
            >
              <Play size={18} /> Challenge a dead mark
            </button>
            <button disabled={busy} onClick={onResign} type="button">
              <Flag size={18} /> Resign
            </button>
          </div>
        </div>
      ) : game.status === "active" ? (
        <div className="game-actions">
          <button disabled={!yourTurn || busy} onClick={onPass} type="button">
            <SkipForward size={18} /> Pass
          </button>
          <button disabled={busy} onClick={onResign} type="button">
            <Flag size={18} /> Resign
          </button>
        </div>
      ) : (
        <>
          {game.finishReason === "score" && scoring?.finalizedAt ? (
            <div className="final-score-summary">
              <strong>Agreed Chinese area score</strong>
              <span>Black {scoring.preview.black} · White {scoring.preview.white}</span>
              <span>
                {scoring.deadStones.length} dead {scoring.deadStones.length === 1 ? "stone" : "stones"}
                {" · "}Chinese 2002 · GoStone v1 · {game.komi} komi · neutral points shared
              </span>
              <span>
                Black: {scoring.preview.blackStones} stones + {scoring.preview.blackTerritory} territory
                {" · "}White: {scoring.preview.whiteStones} stones + {scoring.preview.whiteTerritory} territory + {game.komi} komi
              </span>
              <span>
                Neutral: {scoring.preview.neutralPoints}, shared equally · Dead: {deadCounts.black} black, {deadCounts.white} white
              </span>
            </div>
          ) : null}
          <button className="button button--primary game-leave" onClick={onLeave} type="button">
            Find another game
          </button>
        </>
      )}
    </aside>
  );
}
