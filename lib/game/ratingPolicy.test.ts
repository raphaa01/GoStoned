import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { hasExactlyRegisteredParticipants } from "./ratingPolicy";

const black = "user:22222222-2222-4222-8222-222222222222";
const white = "user:33333333-3333-4333-8333-333333333333";

test("rates only two distinct participants backed by the exact two account rows", () => {
  assert.equal(hasExactlyRegisteredParticipants(
    [black, white],
    [{ player_key: white }, { player_key: black }],
  ), true);

  for (const [name, participants, rows] of [
    ["guest versus guest", ["guest:black", "guest:white"], []],
    ["account versus guest", [black, "guest:white"], [{ player_key: black }]],
    ["deleted account", [black, white], [{ player_key: black }]],
    ["malformed account key", [black, "user:not-a-uuid"], [{ player_key: black }]],
    ["same account twice", [black, black], [{ player_key: black }]],
    ["duplicate resolver evidence", [black, white], [
      { player_key: black },
      { player_key: black },
    ]],
    ["partial resolver evidence", [black, white], [{ player_key: white }]],
    ["unrelated resolver evidence", [black, white], [
      { player_key: black },
      { player_key: "user:44444444-4444-4444-8444-444444444444" },
    ]],
  ] as const) {
    assert.equal(
      hasExactlyRegisteredParticipants(
        participants as readonly [string, string],
        rows,
      ),
      false,
      name,
    );
  }
});

test("keeps every terminal rating write behind one eligibility boundary", () => {
  const service = readFileSync(
    join(process.cwd(), "lib/game/gameService.ts"),
    "utf8",
  );
  assert.equal(service.match(/await recordFinishedStats\(/g)?.length, 4);
  assert.equal(service.match(/INSERT INTO player_stats/g)?.length, 1);
  assert.equal(service.match(/INSERT INTO player_rating_history/g)?.length, 1);
  assert.equal(service.match(/UPDATE player_stats/g)?.length, 1);
  assert.match(service, /SELECT 'user:' \|\| id::text AS player_key/);
  assert.match(service, /COUNT\(DISTINCT history\.player_key\) = 2/);
  assert.match(
    service,
    /history\.player_key IN \(g\.black_player_key, g\.white_player_key\)/,
  );
  assert.match(service, /FROM player_rating_history\s+WHERE game_id = \$1\s+FOR UPDATE/);
  assert.match(service, /if \(existingHistory\.rowCount !== 0\)/);
  assert.match(service, /if \(ledger\.rowCount !== 1\)/);
});
