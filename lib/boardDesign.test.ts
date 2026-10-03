import assert from "node:assert/strict";
import test from "node:test";
import { BOARD_DESIGNS, isBoardDesignUnlocked, parseBoardDesignPreference, parseBoardDesignUpdate } from "./boardDesign";

test("default plus all ten designs are visible, with exact win unlock boundaries", () => {
  assert.equal(BOARD_DESIGNS.length, 11);
  for (const { id, wins } of BOARD_DESIGNS) {
    if (wins === null) {
      assert.equal(isBoardDesignUnlocked(id, 0), false);
      assert.equal(isBoardDesignUnlocked(id, 1_000_000), false);
    } else {
      if (wins > 0) assert.equal(isBoardDesignUnlocked(id, wins - 1), false);
      assert.equal(isBoardDesignUnlocked(id, wins), true);
      assert.equal(isBoardDesignUnlocked(id, wins + 1), true);
    }
  }
  assert.deepEqual(BOARD_DESIGNS.slice(0, 6).map(({ wins }) => wins), [0, 0, 10, 20, 30, 50]);
});

test("updates cannot forge wins, user IDs, or unknown designs", () => {
  assert.equal(parseBoardDesignUpdate({ design: "sage" }), "sage");
  for (const body of [{}, { design: "missing" }, { design: "sage", wins: 30 }, { design: "sage", userId: "another-user" }]) {
    assert.throws(() => parseBoardDesignUpdate(body));
  }
});

test("client preferences reject unavailable, malformed and coming-soon selections", () => {
  assert.deepEqual(parseBoardDesignPreference({ design: "dark-slate", wins: 10 }), { design: "dark-slate", wins: 10 });
  for (const value of [null, {}, { design: "sage", wins: 29 }, { design: "orbit", wins: 100 }, { design: "default", wins: -1 }, { design: "default", wins: 1.2 }]) {
    assert.throws(() => parseBoardDesignPreference(value));
  }
});
