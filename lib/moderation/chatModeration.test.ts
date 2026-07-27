import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { bannedWords, containsBannedChatContent } from "./chatModeration";

describe("chat moderation", () => {
  it("blocks every configured word and phrase regardless of casing", () => {
    for (const word of bannedWords) {
      assert.equal(containsBannedChatContent(`Message: ${word.toUpperCase()}!`), true, word);
    }
  });

  it("blocks common punctuation, spacing, zero-width and leetspeak evasion", () => {
    assert.equal(containsBannedChatContent("f.u.c.k"), true);
    assert.equal(containsBannedChatContent("k i l l   y o u r s e l f"), true);
    assert.equal(containsBannedChatContent("sh\u200bit"), true);
    assert.equal(containsBannedChatContent("@ssh0le"), true);
    assert.equal(containsBannedChatContent("hurensooohn"), true);
  });

  it("does not block harmless words that only contain a short blocked term", () => {
    assert.equal(containsBannedChatContent("That robot played a nice joseki."), false);
    assert.equal(containsBannedChatContent("The Essex Go club meets today."), false);
    assert.equal(containsBannedChatContent("Please pass the stone."), false);
    assert.equal(containsBannedChatContent("Good game, well played!"), false);
  });
});
