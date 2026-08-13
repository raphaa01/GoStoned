import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { parseBoardSize, parseMessageCursor, parsePlayerSearch, parseTimeControl } from "./request";
import { getFriendsCopy } from "@/lib/i18n/friends";

const schema = readFileSync(join(process.cwd(), "db", "schema.sql"), "utf8");
const migration = readFileSync(
  join(process.cwd(), "db", "migrations", "032_friend_system.sql"),
  "utf8",
);
const rating = readFileSync(join(process.cwd(), "lib", "rating", "ratingFinalizer.ts"), "utf8");
const service = readFileSync(join(process.cwd(), "lib", "friends", "friendService.ts"), "utf8");

test("schema and migration persist the complete friend-system contract", () => {
  for (const source of [schema, migration]) {
    assert.match(source, /CREATE TABLE(?: IF NOT EXISTS)? friendships/);
    assert.match(source, /CREATE TABLE(?: IF NOT EXISTS)? friend_messages/);
    assert.match(source, /CREATE TABLE(?: IF NOT EXISTS)? friend_game_invites/);
    assert.match(source, /CHECK \(requester_id <> addressee_id\)/);
    assert.match(source, /game_type IN \('matchmaking', 'friendly'\)/);
    assert.match(source, /friend_game_invites_one_pending_pair[\s\S]*?LEAST\(inviter_id::TEXT, invitee_id::TEXT\)/);
    assert.match(source, /ENABLE ROW LEVEL SECURITY/);
  }
  assert.match(schema, /friendly_game_rating_event_guard/);
  assert.match(migration, /friendly_game_rating_event_guard/);
});

test("friendly games are unconditionally excluded before rating evidence is created", () => {
  const friendlyGuard = rating.indexOf('if (game.game_type === "friendly")');
  const registeredLookup = rating.indexOf("const registered = await client.query");
  assert.ok(friendlyGuard > 0);
  assert.ok(registeredLookup > friendlyGuard);
  assert.match(rating, /return \{ rated: false, kind: "unrated" \}/);
});

test("accepting one invite atomically creates an explicitly friendly game", () => {
  assert.match(service, /INSERT INTO games\([\s\S]*?'friendly'/);
  assert.match(service, /UPDATE friend_game_invites SET status='accepted',game_id=\$2/);
  assert.match(service, /One of you is already in a game/);
  assert.match(service, /lockPlayerPair/);
});

test("friend mutations take the symmetric pair lock before mutable relationship rows", () => {
  assert.match(service, /lockFriendshipForActor[\s\S]*?lockPlayerPair[\s\S]*?friendshipForActor\(client, friendshipId, actorId, accepted, true\)/);
  assert.match(service, /snapshotResult[\s\S]*?lockPlayerPair[\s\S]*?lockedResult[\s\S]*?FOR UPDATE/);
});

test("friend request parsers enforce bounded searches and supported game choices", () => {
  assert.equal(parsePlayerSearch(new NextRequest("https://example.test/api/friends/search?q=al")), "al");
  assert.throws(() => parsePlayerSearch(new NextRequest("https://example.test/api/friends/search?q=a")));
  assert.throws(() => parsePlayerSearch(new NextRequest("https://example.test/api/friends/search?q=a%20b")));
  assert.equal(parseMessageCursor(new NextRequest("https://example.test/api/messages?after=12")), 12);
  assert.equal(parseBoardSize(13), 13);
  assert.equal(parseTimeControl("classic"), "classic");
  assert.throws(() => parseBoardSize(11));
  assert.throws(() => parseTimeControl("custom"));
});

test("German and English friend surfaces cover the complete interaction loop", () => {
  for (const copy of [getFriendsCopy("en"), getFriendsCopy("de")]) {
    assert.ok(copy.searchLabel);
    assert.ok(copy.requestsTitle);
    assert.ok(copy.messagePlaceholder);
    assert.ok(copy.inviteTitle);
    assert.ok(copy.unratedNotice);
    assert.ok(copy.acceptInvite);
  }
});
