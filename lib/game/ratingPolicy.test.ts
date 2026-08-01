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

test("rates account games and account-versus-bot games with verified identities", () => {
  assert.deepEqual(resolveRatingParticipants(
    [black, white],
    [account(white), account(black)],
  ), [account(black), account(white)]);

  const botKey = "bot:44444444-4444-4444-8444-444444444444";
  assert.deepEqual(resolveRatingParticipants(
    [black, botKey],
    [bot(botKey), account(black)],
  ), [account(black), bot(botKey)]);

  for (const [name, participants, rows] of [
    ["guest versus guest", ["guest:black", "guest:white"], []],
    ["account versus guest", [black, "guest:white"], [account(black)]],
    ["guest versus bot", ["guest:black", botKey], [bot(botKey)]],
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

test("keeps every terminal rating write behind one eligibility boundary", () => {
  const service = readFileSync(
    join(process.cwd(), "lib/game/gameService.ts"),
    "utf8",
  );
  const japaneseService = readFileSync(
    join(process.cwd(), "lib/game/japaneseGameService.ts"),
    "utf8",
  );
  const finalizer = readFileSync(
    join(process.cwd(), "lib/game/legacyRatingFinalizer.ts"),
    "utf8",
  );
  assert.equal(service.match(/await recordLegacyFinishedStats\(/g)?.length, 4);
  assert.equal(japaneseService.match(/await recordLegacyFinishedStats\(/g)?.length, 5);
  assert.equal(finalizer.match(/INSERT INTO player_stats/g)?.length, 1);
  assert.equal(finalizer.match(/INSERT INTO player_rating_history/g)?.length, 1);
  assert.equal(finalizer.match(/UPDATE player_stats/g)?.length, 1);
  assert.match(finalizer, /SELECT 'user:' \|\| id::text AS player_key/);
  assert.match(finalizer, /SELECT bot_player_key AS player_key/);
  assert.match(finalizer, /target_rating AS initial_rating/);
  assert.match(service, /COUNT\(DISTINCT history\.player_key\) = 2/);
  assert.match(
    service,
    /history\.player_key IN \(g\.black_player_key, g\.white_player_key\)/,
  );
  assert.match(finalizer, /FROM player_rating_history\s+WHERE game_id = \$1\s+FOR UPDATE/);
  assert.match(finalizer, /if \(existingHistory\.rowCount !== 0\)/);
  assert.match(finalizer, /if \(ledger\.rowCount !== 1\)/);
  assert.match(finalizer, /game\.finish_reason === "japanese_no_result"/);
  assert.match(finalizer, /game\.finish_reason === "japanese_repetition"/);
});
