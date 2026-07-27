import { CircleDot, Clock3, Flag, SkipForward } from "lucide-react";
import { shortPlayerName } from "@/lib/client/guestIdentity";
import type { GameState, Stone } from "@/lib/game/types";

type GamePanelProps = {
  game: GameState;
  playerKey: string;
  busy: boolean;
  onPass: () => void;
  onResign: () => void;
};

export function GamePanel({ game, playerKey, busy, onPass, onResign }: GamePanelProps) {
  const yourColor: Stone = game.blackPlayerKey === playerKey ? "black" : "white";
  const yourTurn = game.status === "active" && game.turn === yourColor;
  const whiteName = shortPlayerName(game.whitePlayerKey);
  const blackName = shortPlayerName(game.blackPlayerKey);
  const resultText =
    game.status === "finished"
      ? game.winnerKey === playerKey
        ? `You won · ${game.result}`
        : game.winnerKey
          ? `You lost · ${game.result}`
          : `Draw · ${game.result}`
      : yourTurn
        ? "Your turn"
        : `${game.turn === "black" ? "Black" : "White"} to move`;

  return (
    <aside className="game-panel" aria-live="polite">
      <div className={`game-panel-player ${yourColor === "white" ? "is-you" : ""}`}>
        <span className="player-stone player-stone--white" />
        <div>
          <strong>{whiteName}</strong>
          <span>{yourColor === "white" ? "You · White" : "Opponent · White"}</span>
        </div>
        <strong className="game-time">Live</strong>
      </div>

      <div className="game-meta-strip">
        <span><CircleDot size={15} /> {game.boardSize}×{game.boardSize}</span>
        <span><Clock3 size={15} /> No clock</span>
        <span>Move {game.moveCount}</span>
      </div>

      <div className={`game-state ${yourTurn ? "is-your-turn" : ""}`}>
        <span className={`player-stone player-stone--${game.turn ?? yourColor}`} />
        <div>
          <strong>{resultText}</strong>
          <span>
            {game.status === "finished"
              ? "The result and ratings were saved."
              : "Every move is validated and saved by the server."}
          </span>
        </div>
      </div>

      <div className={`game-panel-player ${yourColor === "black" ? "is-you" : ""}`}>
        <span className="player-stone player-stone--black" />
        <div>
          <strong>{blackName}</strong>
          <span>{yourColor === "black" ? "You · Black" : "Opponent · Black"}</span>
        </div>
        <strong className="game-time">Live</strong>
      </div>

      {game.status === "active" ? (
        <div className="game-actions">
          <button disabled={!yourTurn || busy} onClick={onPass} type="button">
            <SkipForward size={18} /> Pass
          </button>
          <button disabled={busy} onClick={onResign} type="button">
            <Flag size={18} /> Resign
          </button>
        </div>
      ) : null}
    </aside>
  );
}
