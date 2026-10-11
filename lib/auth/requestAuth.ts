import type { NextRequest } from "next/server";
import { GameServiceError } from "@/lib/game/gameService";
import {
  getGuestSessionIdentity,
  GUEST_SESSION_COOKIE,
  type GuestIdentity,
} from "./guestSession";
import { getSessionUser, SESSION_COOKIE } from "./session";
import type { AuthUser } from "./types";
import { usesLegacyAccountContract } from "./clientContract";

type IdentityResolvers = {
  getAccount: (token: string | undefined) => Promise<AuthUser | null>;
  getGuest: (token: string | undefined) => Promise<GuestIdentity | null>;
};

const defaultIdentityResolvers: IdentityResolvers = {
  getAccount: getSessionUser,
  getGuest: getGuestSessionIdentity,
};

export function assertAccountEmailComplete(user: AuthUser): void {
  if (user.emailRequired) throw new GameServiceError("Add your email address to continue.", 403, "email_required");
}

export async function getRequestUser(request: NextRequest, options: { allowIncomplete?: boolean } = {}): Promise<AuthUser | null> {
  const user = await getSessionUser(request.cookies.get(SESSION_COOKIE)?.value);
  if (user && !options.allowIncomplete && !usesLegacyAccountContract(request)) assertAccountEmailComplete(user);
  return user;
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
  const accountToken = request.cookies.get(SESSION_COOKIE)?.value;
  if (accountToken !== undefined) {
    const account = await resolvers.getAccount(accountToken);
    if (account) {
      if (!usesLegacyAccountContract(request)) assertAccountEmailComplete(account);
      return account.playerKey;
    }
    throw new GameServiceError(
      "Your account session has expired. Please sign in again.",
      401,
      "session_expired",
    );
  }

  const guest = await resolvers.getGuest(request.cookies.get(GUEST_SESSION_COOKIE)?.value);
  if (guest) return guest.playerKey;

  throw new GameServiceError(
    "Your player session has expired. Please refresh and try again.",
    401,
    "session_expired",
  );
}
