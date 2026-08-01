import assert from "node:assert/strict";
import test from "node:test";
import {
  accountRegistrationPath,
  safeAccountReturnPath,
  safeAuthReturnPath,
  safeGameReturnPath,
  safeReauthenticationReturnPath,
} from "./returnPath";

const gameId = "11111111-1111-4111-8111-111111111111";

test("reauthentication accepts game paths in every supported locale", () => {
  assert.equal(safeGameReturnPath(`/game/${gameId}`), `/game/${gameId}`);
  assert.equal(safeGameReturnPath(`/de/game/${gameId}`), `/game/${gameId}`);
  assert.equal(safeGameReturnPath(`/fr/game/${gameId}`), `/game/${gameId}`);
  assert.equal(safeGameReturnPath(`/es/game/${gameId}`), `/game/${gameId}`);
  assert.equal(safeGameReturnPath(`/zh/game/${gameId}`), `/game/${gameId}`);
  assert.equal(safeGameReturnPath(`/ja/game/${gameId}`), `/game/${gameId}`);
  assert.equal(safeGameReturnPath(`/ko/game/${gameId}`), `/game/${gameId}`);
});

test("reauthentication can return to the localized play lobby", () => {
  assert.equal(safeReauthenticationReturnPath("/play"), "/play");
  assert.equal(safeReauthenticationReturnPath("/de/play"), "/play");
  assert.equal(safeReauthenticationReturnPath("/ja/play"), "/play");
  assert.equal(safeReauthenticationReturnPath(`/game/${gameId}`), `/game/${gameId}`);
  assert.equal(safeReauthenticationReturnPath("/profile"), null);
  assert.equal(safeReauthenticationReturnPath("/play?next=/profile"), null);
});

test("account onboarding returns only to protected account features", () => {
  assert.equal(safeAccountReturnPath("/profile"), "/profile");
  assert.equal(safeAccountReturnPath("/de/profile"), "/profile");
  assert.equal(safeAccountReturnPath("/review"), "/review");
  assert.equal(safeAccountReturnPath(`/ja/review/${gameId}`), `/review/${gameId}`);
  assert.equal(safeAccountReturnPath("/play"), null);
  assert.equal(safeAccountReturnPath("/puzzles"), null);
  assert.equal(safeAccountReturnPath("/review/not-a-uuid"), null);
  assert.equal(safeAccountReturnPath("/profile?next=//evil.example"), null);
});

test("auth return paths and registration links stay internal and canonical", () => {
  assert.equal(safeAuthReturnPath("/de/profile"), "/profile");
  assert.equal(safeAuthReturnPath("/fr/play"), "/play");
  assert.equal(safeAuthReturnPath(`/game/${gameId}`), `/game/${gameId}`);
  assert.equal(accountRegistrationPath("/review"), "/register?returnTo=%2Freview");
  assert.equal(
    accountRegistrationPath(`/review/${gameId}`),
    `/register?returnTo=${encodeURIComponent(`/review/${gameId}`)}`,
  );
  assert.equal(accountRegistrationPath("https://evil.example/profile"), "/register");
});

test("reauthentication rejects external, ambiguous, and unrelated paths", () => {
  for (const unsafe of [
    "//evil.example/game/11111111-1111-4111-8111-111111111111",
    "/%2F%2Fevil.example",
    "/\\evil.example",
    "https://evil.example/game/11111111-1111-4111-8111-111111111111",
    `/api/games/${gameId}`,
    `/play?returnTo=/game/${gameId}`,
    `/game/${gameId}?next=//evil.example`,
    `/game/${gameId}#board`,
    "/game/not-a-uuid",
  ]) {
    assert.equal(safeGameReturnPath(unsafe), null, unsafe);
  }
  assert.equal(safeGameReturnPath([`/game/${gameId}`]), null);
  assert.equal(safeGameReturnPath(undefined), null);
});
