import type { NextRequest } from "next/server";
import { GameServiceError } from "@/lib/game/gameService";
import { EXPECTED_PLAYER_HEADER } from "./playerBinding";

export function assertExpectedPlayer(request: NextRequest, playerKey: string): void {
  if (request.headers.get(EXPECTED_PLAYER_HEADER) === playerKey) return;
  throw new GameServiceError(
    "The player session changed. Refresh before continuing.",
    409,
    "identity_changed",
  );
}
