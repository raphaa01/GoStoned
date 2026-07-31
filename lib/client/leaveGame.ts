import { EXPECTED_PLAYER_HEADER } from "@/lib/auth/playerBinding";
import type { BoardSize, TimeControlId } from "@/lib/game/types";
import { ApiRequestError, readApi } from "./api";
import { assertResponseActor } from "./identityAuthority";

export type LeaveGameResult =
  | { kind: "left" }
  | {
      kind: "active";
      gameId: string;
      boardSize: BoardSize;
      timeControl: TimeControlId;
    };

type MatchmakingCancellationResponse = {
  actor: string;
  matchmaking: {
    status: "idle" | "waiting" | "matched";
    gameId: string | null;
    boardSize: BoardSize | null;
    timeControl: TimeControlId | null;
  };
};

export async function leaveGameAndQueue(
  gameId: string,
  expectedPlayerKey: string,
  signal?: AbortSignal,
): Promise<LeaveGameResult> {
  const resignResponse = await fetch(`/api/games/${gameId}/resign`, {
    method: "POST",
    headers: { [EXPECTED_PLAYER_HEADER]: expectedPlayerKey },
    signal,
  });

  if (resignResponse.ok) {
    const resignation = await readApi<{ actor: string }>(resignResponse);
    assertResponseActor(resignation.actor, expectedPlayerKey);
  } else {
    try {
      await readApi(resignResponse);
    } catch (error) {
      // A finished game no longer needs a resignation, but its matchmaking
      // entry still has to be removed so the player can start another game.
      if (!(error instanceof ApiRequestError && error.code === "game_finished")) {
        throw error;
      }
    }
  }

  const cancellation = await readApi<MatchmakingCancellationResponse>(
    await fetch("/api/matchmaking", {
      method: "DELETE",
      headers: { [EXPECTED_PLAYER_HEADER]: expectedPlayerKey },
      signal,
    }),
  );
  assertResponseActor(cancellation.actor, expectedPlayerKey);
  const queue = cancellation.matchmaking;
  if (
    queue.status === "matched"
    && queue.gameId
    && queue.boardSize
    && queue.timeControl
  ) {
    return {
      kind: "active",
      gameId: queue.gameId,
      boardSize: queue.boardSize,
      timeControl: queue.timeControl,
    };
  }
  if (queue.status !== "idle") {
    throw new ApiRequestError("The queue could not confirm that the game was left.", {
      status: 409,
      code: "queue_state_changed",
    });
  }
  return { kind: "left" };
}
