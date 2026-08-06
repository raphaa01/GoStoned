import assert from "node:assert/strict";
import test from "node:test";
import { exportGameToSgf, SgfExportError, type SgfExportInput } from "./sgfExport";

const base: SgfExportInput = {
  gameId: "11111111-1111-4111-8111-111111111111",
  boardSize: 9,
  rules: {
    ruleset: "japanese",
    rulesProfile: "japanese-1989-gostone-v1",
    scoringMethod: "territory",
    komi: 6.5,
    handicap: 0,
  },
  moves: [
    { moveNumber: 1, color: "black", x: 0, y: 0, isPass: false },
    { moveNumber: 2, color: "white", x: null, y: null, isPass: true },
    { moveNumber: 3, color: "black", x: null, y: null, isPass: true },
  ],
  result: { kind: "score", winner: "white", margin: 5.5 },
  players: { blackName: "Black", whiteName: "White" },
};

test("exports the exact Japanese profile, komi, moves, and score result", () => {
  const sgf = exportGameToSgf(base);
  assert.match(sgf, /RU\[japanese-1989-gostone-v1\]/);
  assert.match(sgf, /KM\[6\.5\]/);
  assert.match(sgf, /RE\[W\+5\.5\]/);
  assert.match(sgf, /GSRP\[japanese-1989-gostone-v1\]/);
  assert.match(sgf, /GSRS\[japanese\]/);
  assert.match(sgf, /GSSM\[territory\]/);
  assert.match(sgf, /;B\[aa\];W\[\];B\[\]/);
});

test("exports unresolved settlement and repetition as inspectable no-results", () => {
  for (const reason of ["unresolved-after-participation", "cyclic-repetition"] as const) {
    const sgf = exportGameToSgf({ ...base, result: { kind: "no-result", reason } });
    assert.match(sgf, /RE\[Void\]/);
    assert.ok(sgf.includes(`GSNR[${reason}]`));
  }
});

test("rejects mismatched Japanese rules tuples instead of reinterpreting them", () => {
  assert.throws(
    () => exportGameToSgf({
      ...base,
      rules: { ...base.rules, scoringMethod: "area" },
    }),
    (error: unknown) => error instanceof SgfExportError && error.code === "invalid_rules",
  );
});
