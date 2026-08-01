import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { resolveRatingParticipants, type RatingParticipantRow } from "./ratingPolicy";

const black = "user:22222222-2222-4222-8222-222222222222";
const white = "user:33333333-3333-4333-8333-333333333333";

const account = (playerKey: string): RatingParticipantRow => ({
  player_key: playerKey,
  initial_rating: 1_200,
  participant_type: "account",
});
const bot = (playerKey: string, rating = 1_350): RatingParticipantRow => ({
  player_key: playerKey,
  initial_rating: rating,
  participant_type: "bot",
});

test("rates only games between two verified registered accounts", () => {
  assert.deepEqual(resolveRatingParticipants(
    [black, white],
    [account(white), account(black)],
  ), [account(black), account(white)]);

  const botKey = "bot:44444444-4444-4444-8444-444444444444";
  for (const [name, participants, rows] of [
    ["guest versus guest", ["guest:black", "guest:white"], []],
    ["account versus guest", [black, "guest:white"], [account(black)]],
    ["guest versus bot", ["guest:black", botKey], [bot(botKey)]],
    ["uncalibrated bot", [black, botKey], [account(black), bot(botKey)]],
    ["deleted account", [black, white], [account(black)]],
    ["malformed account key", [black, "user:not-a-uuid"], [account(black)]],
    ["same account twice", [black, black], [account(black)]],
    ["bot versus bot", [botKey, "bot:second"], [bot(botKey), bot("bot:second")]],
    ["duplicate resolver evidence", [black, white], [
      account(black),
      account(black),
    ]],
    ["partial resolver evidence", [black, white], [account(white)]],
    ["unrelated resolver evidence", [black, white], [
      account(black),
      account("user:44444444-4444-4444-8444-444444444444"),
    ]],
    ["invalid bot rating", [black, botKey], [account(black), bot(botKey, 99)]],
  ] as const) {
    assert.equal(
      resolveRatingParticipants(
        participants as readonly [string, string],
        rows,
      ),
      null,
      name,
    );
  }
});

test("routes every terminal flow through the global rating finalizer", () => {
  const chineseService = readFileSync(
    join(process.cwd(), "lib/game/gameService.ts"),
    "utf8",
  );
  const japaneseService = readFileSync(
    join(process.cwd(), "lib/game/japaneseGameService.ts"),
    "utf8",
  );
  const finalizer = readFileSync(
    join(process.cwd(), "lib/rating/ratingFinalizer.ts"),
    "utf8",
  );

  assert.equal(chineseService.match(/await finalizeGameRatings\(/g)?.length, 4);
  assert.equal(japaneseService.match(/await finalizeGameRatings\(/g)?.length, 5);
  assert.doesNotMatch(chineseService, /INSERT INTO player_stats|UPDATE player_stats/);
  assert.doesNotMatch(chineseService, /INSERT INTO player_rating_history/);
  assert.doesNotMatch(japaneseService, /INSERT INTO player_stats|UPDATE player_stats/);
  assert.doesNotMatch(japaneseService, /INSERT INTO player_rating_history/);
  assert.match(finalizer, /INSERT INTO game_glicko2_rating_events/);
  assert.match(finalizer, /UPDATE player_glicko2_ratings/);
  for (const service of [chineseService, japaneseService]) {
    assert.match(service, /COUNT\(\*\) = 2 AND BOOL_AND\(event\.opponent_kind = 'registered_human'\)/);
    assert.match(service, /COUNT\(\*\) = 1 AND BOOL_AND\(event\.opponent_kind = 'calibrated_bot'\)/);
  }
  assert.match(finalizer, /FROM games WHERE id=\$1 FOR UPDATE/);
  assert.match(finalizer, /ORDER BY player_key\s+FOR UPDATE/);
  assert.match(finalizer, /if \(existing\.rowCount !== 0\)/);
});
