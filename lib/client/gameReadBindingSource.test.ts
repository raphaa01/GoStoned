import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path: string): string {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
}

function section(value: string, start: string, end: string): string {
  const startIndex = value.indexOf(start);
  const endIndex = value.indexOf(end, startIndex + start.length);
  assert.ok(startIndex >= 0 && endIndex > startIndex, `${start} section must exist`);
  return value.slice(startIndex, endIndex);
}

test("primary game polls bind the effect-captured player identity", () => {
  const room = source("components/game/GameRoom.tsx");
  const refresh = section(room, "const refreshGame = useCallback", "const refreshChat");
  const poll = section(room, "const pollGame = async () => {", "const pollChat");

  assert.match(refresh, /expectedPlayerKey: string/);
  assert.match(refresh, /headers: \{ \[EXPECTED_PLAYER_HEADER\]: expectedPlayerKey \}/);
  assert.match(room, /const expectedPlayerKey = playerKey;\s+const requestIdentity = identityAuthority\.current\.capture\(\)/);
  assert.match(poll, /refreshGame\(signal, requestIdentity, expectedPlayerKey\)/);
});

test("only a current primary-poll identity conflict can trigger identity recovery", () => {
  const room = source("components/game/GameRoom.tsx");
  const poll = section(room, "const pollGame = async () => {", "const pollChat");
  const catchBoundary = poll.indexOf("} catch (caughtError) {");
  const currentGuard = poll.indexOf("gameGuard.isCurrent(guardSignal)", catchBoundary);
  const generationGuard = poll.indexOf(
    "identityAuthority.current.isCurrent(requestIdentity)",
    currentGuard,
  );
  const conflict = poll.indexOf('caughtError.code === "identity_changed"', generationGuard);
  const recovery = poll.indexOf("recoverChangedIdentity()", conflict);
  const genericFailure = poll.indexOf("applyConnectionFailure(requestError", conflict);

  assert.ok(catchBoundary >= 0);
  assert.ok(currentGuard > catchBoundary);
  assert.ok(generationGuard > currentGuard);
  assert.ok(conflict > generationGuard);
  assert.ok(recovery > conflict);
  assert.ok(genericFailure > recovery);
});
