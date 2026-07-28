import assert from "node:assert/strict";
import test from "node:test";
import { safeGameReturnPath, safeReauthenticationReturnPath } from "./returnPath";

const gameId = "11111111-1111-4111-8111-111111111111";

test("reauthentication accepts only an English or German game path", () => {
  assert.equal(safeGameReturnPath(`/game/${gameId}`), `/game/${gameId}`);
  assert.equal(safeGameReturnPath(`/de/game/${gameId}`), `/game/${gameId}`);
});

test("reauthentication can return to the localized play lobby", () => {
  assert.equal(safeReauthenticationReturnPath("/play"), "/play");
  assert.equal(safeReauthenticationReturnPath("/de/play"), "/play");
  assert.equal(safeReauthenticationReturnPath(`/game/${gameId}`), `/game/${gameId}`);
  assert.equal(safeReauthenticationReturnPath("/profile"), null);
  assert.equal(safeReauthenticationReturnPath("/play?next=/profile"), null);
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
