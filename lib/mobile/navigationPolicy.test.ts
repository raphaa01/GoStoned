import assert from "node:assert/strict";
import test from "node:test";
import { allowsMobileBackGesture } from "./navigationPolicy";

test("edge back gestures protect games while allowing review, learning and account pages", () => {
  for (const prefix of ["", "/de", "/ja"]) {
    for (const route of ["/game/33333333-3333-4333-8333-333333333333", "/learn/ai", "/play/coach", "/game/active/"]) {
      assert.equal(allowsMobileBackGesture(`${prefix}${route}`), false);
    }
    for (const route of ["/", "/learn", "/puzzles", "/review/33333333-3333-4333-8333-333333333333", "/profile/settings", "/shared-game/token"]) {
      assert.equal(allowsMobileBackGesture(`${prefix}${route}`), true);
    }
  }
});
