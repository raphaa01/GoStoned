import { CircleDot, Flag, SkipForward } from "lucide-react";
import type { GameState, Stone } from "@/lib/game/types";

type GamePanelProps = {
  game: GameState;
  playerKey: string;
  busy: boolean;
  onPass: () => void;
  onResign: () => void;
  onLeave: () => void;
};

export function GamePanel({
  game,
  playerKey,
  busy,
  onPass,
  onResign,
  onLeave,
}: GamePanelProps) {
  const yourColor: Stone = game.blackPlayerKey === playerKey ? "black" : "white";
  const yourTurn = game.status === "active" && game.turn === yourColor;
  const resultText =
    game.status === "finished"
      ? game.winnerKey === playerKey
        ? `You won · ${game.result}`
        : game.winnerKey
          ? `You lost · ${game.result}`
          : `Draw · ${game.result}`
      : yourTurn
        ? "Your turn"
        : "Opponent's turn";

  return (
    <aside className="game-panel" aria-live="polite">
      <div className={`game-panel-player ${yourColor === "white" ? "is-you" : ""}`}>
        <span className="player-stone player-stone--white" />
        <div>
          <strong>{game.whitePlayerName}</strong>
          <span>{yourColor === "white" ? "You · White" : "Opponent · White"}</span>
        </div>
      </div>

      <div className="game-meta-strip">
        <span><CircleDot size={15} /> {game.boardSize}×{game.boardSize}</span>
        <span>Chinese rules</span>
        <span>Move {game.moveCount}</span>
      </div>

      <div className={`game-state ${yourTurn ? "is-your-turn" : ""}`}>
        <span className={`player-stone player-stone--${game.turn ?? yourColor}`} />
        <div>
          <strong>{resultText}</strong>
          <span>
            {game.status === "finished"
              ? "Result and ratings saved."
              : "Moves are checked and saved by the server."}
          </span>
        </div>
      </div>

      <div className={`game-panel-player ${yourColor === "black" ? "is-you" : ""}`}>
        <span className="player-stone player-stone--black" />
        <div>
          <strong>{game.blackPlayerName}</strong>
          <span>{yourColor === "black" ? "You · Black" : "Opponent · Black"}</span>
        </div>
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
      ) : (
        <button className="button button--primary game-leave" onClick={onLeave} type="button">
          Find another game
        </button>
      )}
    </aside>
  );
}
