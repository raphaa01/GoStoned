import assert from "node:assert/strict";
import test from "node:test";
import { allowsMobileBackGesture, isSameMobileOrigin } from "./navigationPolicy";

test("edge back gestures protect games while allowing review, learning and account pages", () => {
  for (const prefix of ["", "/de", "/ja"]) {
    for (const route of ["/game/33333333-3333-4333-8333-333333333333", "/learn/ai", "/play/coach", "/play/local", "/play/clock", "/game/active/"]) {
      assert.equal(allowsMobileBackGesture(`${prefix}${route}`), false);
    }
    for (const route of ["/", "/learn", "/puzzles", "/review/33333333-3333-4333-8333-333333333333", "/profile/settings", "/shared-game/token"]) {
      assert.equal(allowsMobileBackGesture(`${prefix}${route}`), true);
    }
  }
});
test("native navigation compares the actual scheme and host, including opaque iOS origins", () => {
  const current = new URL("capacitor://localhost/de/profile");
  assert.equal(isSameMobileOrigin(new URL("/de/puzzles", current), current), true);
  assert.equal(isSameMobileOrigin(new URL("capacitor://other-app/de/puzzles"), current), false);
  assert.equal(isSameMobileOrigin(new URL("https://localhost/de/puzzles"), current), false);
  assert.equal(isSameMobileOrigin(new URL("https://gostone.app/de/puzzles"), new URL("https://localhost/")), false);
  assert.equal(isSameMobileOrigin(new URL("https://localhost/de/puzzles"), new URL("https://localhost/")), true);
});
