import type { BoardSize, TimeControlId } from "@/lib/game/types";
import type { MatchPool } from "@/lib/matchmaking/adaptiveMatchPolicy";
import type { BotMatchPreference } from "@/lib/rating/preferences";
import type { RatingDisplayPreference } from "@/lib/rating/rankPolicy";

export type MatchmakingQueueState = {
  status: "idle" | "waiting" | "matched";
  gameId: string | null;
  boardSize: BoardSize | null;
  timeControl: TimeControlId | null;
  pool?: MatchPool;
  botMatchPreference?: BotMatchPreference;
  rating?: number | null;
  ratingDeviation?: number | null;
  displayPreference?: RatingDisplayPreference;
  waitingSince?: string;
};

type ActiveMatch = {
  gameId: string;
  boardSize: BoardSize;
  timeControl: TimeControlId;
};

type MatchmakingStateHandlers = {
  enterGame: (gameId: string) => void;
  selectBoardSize: (boardSize: BoardSize) => void;
  selectTimeControl: (timeControl: TimeControlId) => void;
  setActiveGame: (game: ActiveMatch | null) => void;
  setQueueStatus: (status: "idle" | "waiting") => void;
};

export function applyMatchmakingQueueState(
  queue: MatchmakingQueueState,
  enterMatchedGame: boolean,
  handlers: MatchmakingStateHandlers,
) {
  if (queue.boardSize) handlers.selectBoardSize(queue.boardSize);
  if (queue.timeControl) handlers.selectTimeControl(queue.timeControl);
  if (
    queue.status === "matched"
    && queue.gameId
    && queue.boardSize
    && queue.timeControl
  ) {
    handlers.setActiveGame({
      gameId: queue.gameId,
      boardSize: queue.boardSize,
      timeControl: queue.timeControl,
    });
    handlers.setQueueStatus("idle");
    if (enterMatchedGame) {
      handlers.enterGame(queue.gameId);
    }
    return;
  }
  handlers.setActiveGame(null);
  handlers.setQueueStatus(queue.status === "waiting" ? "waiting" : "idle");
}
