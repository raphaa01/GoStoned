import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const component = readFileSync(
  new URL("../../components/leaderboard/LeaderboardView.tsx", import.meta.url),
  "utf8",
);

test("leaderboard requests accept shared caching and cannot commit stale responses", () => {
  assert.match(component, /const controller = new AbortController\(\)/);
  assert.match(component, /let active = true/);
  assert.match(component, /signal: controller\.signal/);
  assert.match(component, /if \(!active\) return/);
  assert.match(component, /active = false;\s+controller\.abort\(\)/);
  assert.match(component, /fetch\("\/api\/stats"/);
  assert.match(component, /parsePublicLeaderboardSnapshot\(body\)/);
  assert.doesNotMatch(component, /boardSize=|setBoardSize/);
  assert.doesNotMatch(component, /cache:\s*["']no-store["']/);
});

test("leaderboard exposes freshness and a keyboard-scrollable labeled table", () => {
  assert.match(component, /dateStyle: "medium"/);
  assert.match(component, /timeStyle: "short"/);
  assert.match(component, /copy\.snapshotSummary/);
  assert.match(component, /aria-live="polite"/);
  assert.match(component, /aria-atomic="true"/);
  assert.match(component, /role="region"/);
  assert.match(component, /tabIndex=\{0\}/);
  assert.match(component, /aria-label=\{tableLabel\}/);
  assert.match(component, /entry\.position/);
  assert.match(component, /focusRetryStatus\.current = true/);
  assert.match(component, /resultStatusRef\.current\?\.focus\(\)/);
  assert.match(component, /ref=\{resultStatusRef\}/);
  assert.doesNotMatch(component, /entry\.player_name|entry\.updated_at|entry\.highest_rating/);
});

test("leaderboard keeps the signed-in player's rating visible before eligibility", () => {
  assert.match(component, /rating: viewerRating/);
  assert.match(component, /className="leaderboard-viewer"/);
  assert.match(component, /viewerRating\.displayPreference/);
  assert.match(component, /isProvisional=\{viewerRating\.isProvisional\}/);
  assert.match(component, /provisionalLabel=\{dictionary\.profile\.provisional\}/);
  assert.doesNotMatch(component, /viewerRating\.deviation/);
});
