import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { GameServiceError } from "@/lib/game/gameService";
import {
  createGuestSessionToken,
  GUEST_SESSION_COOKIE,
  guestSessionCookieOptions,
  hashGuestSessionToken,
  serializeGuestIdentity,
} from "./guestSession";
import { resolvePlayerKey } from "./requestAuth";
import { SESSION_COOKIE } from "./session";
import type { AuthUser } from "./types";

const guestA = serializeGuestIdentity("11111111-1111-4111-8111-111111111111");
const guestB = serializeGuestIdentity("22222222-2222-4222-8222-222222222222");

function requestWithCookies(url: string, cookies: Record<string, string>) {
  return new NextRequest(url, {
    headers: {
      cookie: Object.entries(cookies)
        .map(([name, value]) => `${name}=${value}`)
        .join("; "),
    },
  });
}

test("rejects an arbitrary guest player key without a server session", async () => {
  const request = new NextRequest(
    `https://gostone.test/api/matchmaking?playerKey=${encodeURIComponent(guestB.playerKey)}`,
  );

  await assert.rejects(
    resolvePlayerKey(request, {
      getAccount: async () => null,
      getGuest: async () => null,
    }),
    (error) =>
      error instanceof GameServiceError &&
      error.status === 401 &&
      error.code === "session_expired",
  );
});

test("a guest session cannot be changed by claiming another guest key", async () => {
  const request = requestWithCookies(
    `https://gostone.test/api/games/game-id?playerKey=${encodeURIComponent(guestB.playerKey)}`,
    { [GUEST_SESSION_COOKIE]: "guest-a-token" },
  );

  const playerKey = await resolvePlayerKey(request, {
    getAccount: async () => null,
    getGuest: async (token) => (token === "guest-a-token" ? guestA : null),
  });

  assert.equal(playerKey, guestA.playerKey);
  assert.notEqual(playerKey, guestB.playerKey);
});

test("rejects a tampered guest session cookie", async () => {
  const request = requestWithCookies("https://gostone.test/api/matchmaking", {
    [GUEST_SESSION_COOKIE]: "tampered-token",
  });

  await assert.rejects(
    resolvePlayerKey(request, {
      getAccount: async () => null,
      getGuest: async () => null,
    }),
    (error) => error instanceof GameServiceError && error.status === 401,
  );
});

test("an authenticated account takes precedence over a guest cookie", async () => {
  const account: AuthUser = {
    id: "33333333-3333-4333-8333-333333333333",
    username: "secure_player",
    displayName: "Secure Player",
    playerKey: "user:33333333-3333-4333-8333-333333333333",
  };
  const request = requestWithCookies("https://gostone.test/api/matchmaking", {
    [SESSION_COOKIE]: "account-token",
    [GUEST_SESSION_COOKIE]: "guest-a-token",
  });

  const playerKey = await resolvePlayerKey(request, {
    getAccount: async (token) => (token === "account-token" ? account : null),
    getGuest: async () => guestA,
  });

  assert.equal(playerKey, account.playerKey);
});

test("guest tokens are hashed and use hardened cookie options", () => {
  const generatedToken = createGuestSessionToken();
  assert.equal(Buffer.from(generatedToken, "base64url").byteLength, 32);
  const token = "raw-token-that-must-never-be-persisted";
  const hash = hashGuestSessionToken(token);
  assert.notEqual(hash, token);
  assert.match(hash, /^[0-9a-f]{64}$/);
  assert.deepEqual(guestSessionCookieOptions(true), {
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    path: "/",
    maxAge: 2_592_000,
    priority: "high",
  });
});
