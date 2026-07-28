import type { NextRequest } from "next/server";
import { GameServiceError } from "@/lib/game/gameService";
import {
  getGuestSessionIdentity,
  GUEST_SESSION_COOKIE,
  type GuestIdentity,
} from "./guestSession";
import { getSessionUser, SESSION_COOKIE } from "./session";
import type { AuthUser } from "./types";

type IdentityResolvers = {
  getAccount: (token: string | undefined) => Promise<AuthUser | null>;
  getGuest: (token: string | undefined) => Promise<GuestIdentity | null>;
};

const defaultIdentityResolvers: IdentityResolvers = {
  getAccount: getSessionUser,
  getGuest: getGuestSessionIdentity,
};

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
  resolvers: IdentityResolvers = defaultIdentityResolvers,
): Promise<string> {
  const account = await resolvers.getAccount(request.cookies.get(SESSION_COOKIE)?.value);
  if (account) return account.playerKey;

  const guest = await resolvers.getGuest(request.cookies.get(GUEST_SESSION_COOKIE)?.value);
  if (guest) return guest.playerKey;

  throw new GameServiceError(
    "Your player session has expired. Please refresh and try again.",
    401,
    "session_expired",
  );
}
