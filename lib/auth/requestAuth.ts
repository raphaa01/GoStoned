import type { NextRequest } from "next/server";
import { GameServiceError } from "@/lib/game/gameService";
import { isValidPlayerKey } from "@/lib/matchmaking/matchmakingService";
import { getSessionUser, SESSION_COOKIE } from "./session";
import type { AuthUser } from "./types";

export async function getRequestUser(request: NextRequest): Promise<AuthUser | null> {
  return getSessionUser(request.cookies.get(SESSION_COOKIE)?.value);
}

export async function requireRequestUser(request: NextRequest): Promise<AuthUser> {
  const user = await getRequestUser(request);
  if (!user) throw new GameServiceError("Please log in first.", 401, "authentication_required");
  return user;
}

export async function resolvePlayerKey(
  request: NextRequest,
  claimedPlayerKey: unknown,
): Promise<string> {
  if (!isValidPlayerKey(claimedPlayerKey)) {
    throw new GameServiceError("Invalid player key.", 400, "invalid_player_key");
  }
  if (claimedPlayerKey.startsWith("guest:")) return claimedPlayerKey;

  const user = await getRequestUser(request);
  if (!user) {
    throw new GameServiceError("Your session has expired. Please log in again.", 401, "session_expired");
  }
  if (user.playerKey !== claimedPlayerKey) {
    throw new GameServiceError("This account does not own that player.", 403, "player_mismatch");
  }
  return user.playerKey;
}
