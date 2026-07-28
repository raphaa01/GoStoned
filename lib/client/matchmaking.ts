import type { BoardSize, TimeControlId } from "@/lib/game/types";

export type MatchmakingQueueState = {
  status: "idle" | "waiting" | "matched";
  gameId: string | null;
  boardSize: BoardSize | null;
  timeControl: TimeControlId | null;
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
    if (enterMatchedGame) {
      handlers.enterGame(queue.gameId);
    } else {
      handlers.setActiveGame({
        gameId: queue.gameId,
        boardSize: queue.boardSize,
        timeControl: queue.timeControl,
      });
      handlers.setQueueStatus("idle");
    }
    return;
  }
  handlers.setActiveGame(null);
  handlers.setQueueStatus(queue.status === "waiting" ? "waiting" : "idle");
}
