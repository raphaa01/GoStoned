import type { BoardSize } from "@/lib/game/types";

export type MatchmakingDescriptor = {
  boardSize: BoardSize;
  status: "available";
  persistence: "postgresql";
  realtime: "provider-ready";
};

export function getMatchmakingDescriptor(boardSize: BoardSize): MatchmakingDescriptor {
  return {
    boardSize,
    status: "available",
    persistence: "postgresql",
    realtime: "provider-ready",
  };
}
