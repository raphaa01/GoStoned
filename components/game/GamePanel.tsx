import { CircleDot, Clock3, Flag, MessageSquare, MoreHorizontal } from "lucide-react";
import type { BoardSize, Stone } from "@/lib/game/types";

export function GamePanel({
  boardSize,
  turn,
  moveCount,
}: {
  boardSize: BoardSize;
  turn: Stone;
  moveCount: number;
}) {
  return (
    <aside className="game-panel">
      <div className="game-panel-player">
        <span className="player-stone player-stone--white" />
        <div>
          <strong>Waiting for opponent</strong>
          <span>Guest · unrated</span>
        </div>
        <strong className="game-time">--:--</strong>
      </div>

      <div className="game-meta-strip">
        <span><CircleDot size={15} /> {boardSize}×{boardSize}</span>
        <span><Clock3 size={15} /> Live</span>
        <span>Move {moveCount}</span>
      </div>

      <div className="game-state">
        <span className={`player-stone player-stone--${turn}`} />
        <div>
          <strong>{moveCount === 0 ? "Board preview" : `${turn === "black" ? "Black" : "White"} to move`}</strong>
          <span>Moves will be validated by the server.</span>
        </div>
      </div>

      <div className="game-panel-player">
        <span className="player-stone player-stone--black" />
        <div>
          <strong>You</strong>
          <span>Guest player</span>
        </div>
        <strong className="game-time">--:--</strong>
      </div>

      <div className="game-actions">
        <button type="button"><MessageSquare size={18} /> Chat</button>
        <button type="button"><Flag size={18} /> Resign</button>
        <button aria-label="More game actions" type="button"><MoreHorizontal size={19} /></button>
      </div>
    </aside>
  );
}
