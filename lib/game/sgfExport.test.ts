import assert from "node:assert/strict";
import test from "node:test";
import {
  exportGameToSgf,
  SGF_EXPORT_CONTRACT_VERSION,
  SgfExportError,
  VERIFIED_HANDICAP_EVIDENCE_VERSION,
  type SgfExportInput,
  type SgfTerminalResult,
} from "./sgfExport";

const GAME_ID = "01890f3e-7b7a-7cc2-98e7-5d5e08e7a65f";

function japaneseInput(
  overrides: Partial<SgfExportInput> = {},
): SgfExportInput {
  return {
    gameId: GAME_ID,
    boardSize: 19,
    rules: {
      ruleset: "japanese",
      rulesProfile: "japanese-1989-gostone-v1",
      scoringMethod: "territory",
      komi: 6.5,
      handicap: 0,
    },
    moves: [],
    result: { kind: "draw" },
    ...overrides,
  };
}

function errorCode(code: SgfExportError["code"]): (error: unknown) => boolean {
  return (error) => error instanceof SgfExportError && error.code === code;
}

function propertyValue(sgf: string, identifier: string): string | undefined {
  const start = sgf.indexOf(`${identifier}[`);
  if (start === -1) return undefined;
  let value = "";
  let escaped = false;
  for (let index = start + identifier.length + 1; index < sgf.length; index += 1) {
    const character = sgf[index];
    if (escaped) {
      value += character;
      escaped = false;
    } else if (character === "\\") {
      escaped = true;
    } else if (character === "]") {
      return value;
    } else {
      value += character;
    }
  }
  throw new Error(`Unterminated ${identifier} property.`);
}

function moveNodeCount(sgf: string): number {
  let inValue = false;
  let escaped = false;
  let count = 0;
  for (let index = 0; index < sgf.length; index += 1) {
    const character = sgf[index];
    if (inValue) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === "]") inValue = false;
    } else if (character === "[") {
      inValue = true;
    } else if (
      character === ";"
      && (sgf.slice(index + 1, index + 3) === "B[" || sgf.slice(index + 1, index + 3) === "W[")
    ) {
      count += 1;
    }
  }
  return count;
}

test("exports deterministic FF[4] roots and coordinates for every supported board size", () => {
  for (const boardSize of [9, 13, 19] as const) {
    const edge = boardSize - 1;
    const sgf = exportGameToSgf(japaneseInput({
      boardSize,
      moves: [
        { moveNumber: 1, color: "black", x: 0, y: 0, isPass: false },
        { moveNumber: 2, color: "white", x: edge, y: edge, isPass: false },
      ],
      result: { kind: "score", winner: "white", margin: 6.5 },
    }));
    const lastCoordinate = boardSize === 9 ? "ii" : boardSize === 13 ? "mm" : "ss";

    assert.ok(sgf.startsWith("(;FF[4]GM[1]CA[UTF-8]"));
    assert.match(sgf, new RegExp(`SZ\\[${boardSize}\\]`));
    assert.match(sgf, /RU\[japanese-1989-gostone-v1\]/);
    assert.match(sgf, /KM\[6\.5\]RE\[W\+6\.5\]/);
    assert.match(sgf, new RegExp(`;B\\[aa\\];W\\[${lastCoordinate}\\]`));
    assert.equal(propertyValue(sgf, "GSCV"), SGF_EXPORT_CONTRACT_VERSION);
  }
});

test("serializes pass-pass as empty move values without legacy pass coordinates", () => {
  const sgf = exportGameToSgf(japaneseInput({
    moves: [
      { moveNumber: 1, color: "black", x: null, y: null, isPass: true },
      { moveNumber: 2, color: "white", x: null, y: null, isPass: true },
    ],
    result: { kind: "score", winner: "white", margin: 6.5 },
  }));

  assert.match(sgf, /;B\[\];W\[\]\)\n$/);
  assert.doesNotMatch(sgf, /;[BW]\[tt\]/);
});

test("preserves a persisted same-color move after pass-pass resumption", () => {
  const sgf = exportGameToSgf(japaneseInput({
    moves: [
      { moveNumber: 1, color: "black", x: 3, y: 3, isPass: false },
      { moveNumber: 2, color: "white", x: null, y: null, isPass: true },
      { moveNumber: 3, color: "black", x: null, y: null, isPass: true },
      { moveNumber: 4, color: "black", x: 4, y: 4, isPass: false },
    ],
  }));

  assert.match(sgf, /;B\[dd\];W\[\];B\[\];B\[ee\]/);
});

test("maps every supported terminal outcome to a canonical SGF RE value", () => {
  const cases: readonly [SgfTerminalResult, string][] = [
    [{ kind: "score", winner: "black", margin: 2.5 }, "B+2.5"],
    [{ kind: "score", winner: "white", margin: 7 }, "W+7"],
    [{ kind: "resignation", winner: "black" }, "B+R"],
    [{ kind: "timeout", winner: "white" }, "W+T"],
    [{ kind: "draw" }, "0"],
    [{ kind: "no-result", reason: "cyclic-repetition" }, "Void"],
  ];

  for (const [result, expected] of cases) {
    assert.equal(propertyValue(exportGameToSgf(japaneseInput({ result })), "RE"), expected);
  }
});

test("no-result retains a stable machine reason distinct from an SGF draw", () => {
  const noResult = exportGameToSgf(japaneseInput({
    result: { kind: "no-result", reason: "adjudication-low-confidence" },
  }));
  const draw = exportGameToSgf(japaneseInput({ result: { kind: "draw" } }));

  assert.equal(propertyValue(noResult, "RE"), "Void");
  assert.equal(propertyValue(noResult, "GSNR"), "adjudication-low-confidence");
  assert.equal(propertyValue(draw, "RE"), "0");
  assert.equal(propertyValue(draw, "GSNR"), undefined);
});

test("emits HA and sorted AB only for complete verified handicap evidence", () => {
  const rules = {
    ...japaneseInput().rules,
    handicap: 2,
  } as const;
  const sgf = exportGameToSgf(japaneseInput({
    rules,
    handicapEvidence: {
      kind: "verified-fixed-placement",
      version: VERIFIED_HANDICAP_EVIDENCE_VERSION,
      stones: [{ x: 15, y: 3 }, { x: 3, y: 15 }],
    },
    moves: [
      { moveNumber: 1, color: "white", x: 9, y: 9, isPass: false },
      { moveNumber: 2, color: "black", x: null, y: null, isPass: true },
    ],
  }));

  assert.match(sgf, /HA\[2\]AB\[dp\]\[pd\]/);
  assert.match(sgf, /;W\[jj\];B\[\]/);

  assert.throws(
    () => exportGameToSgf(japaneseInput({ rules })),
    errorCode("invalid_handicap_evidence"),
  );
  assert.throws(
    () => exportGameToSgf(japaneseInput({
      rules,
      handicapEvidence: {
        kind: "verified-fixed-placement",
        version: VERIFIED_HANDICAP_EVIDENCE_VERSION,
        stones: [{ x: 3, y: 15 }],
      },
    })),
    errorCode("invalid_handicap_evidence"),
  );

  const evenGame = exportGameToSgf(japaneseInput());
  assert.equal(propertyValue(evenGame, "HA"), undefined);
  assert.equal(propertyValue(evenGame, "AB"), undefined);
});

test("preserves current and legacy Chinese persisted tuples without reinterpretation", () => {
  const current = exportGameToSgf(japaneseInput({
    rules: {
      ruleset: "chinese",
      rulesProfile: "chinese-2002-gostone-v1",
      scoringMethod: "area",
      komi: 7.5,
      handicap: 0,
    },
    result: { kind: "score", winner: "white", margin: 7.5 },
  }));
  const legacy = exportGameToSgf(japaneseInput({
    rules: {
      ruleset: "chinese",
      rulesProfile: "legacy-immediate-area",
      scoringMethod: "area",
      komi: 6.5,
      handicap: 0,
    },
  }));

  assert.equal(propertyValue(current, "RU"), "chinese-2002-gostone-v1");
  assert.equal(propertyValue(current, "KM"), "7.5");
  assert.equal(propertyValue(current, "GSRS"), "chinese");
  assert.equal(propertyValue(current, "GSSM"), "area");
  assert.equal(propertyValue(legacy, "RU"), "legacy-immediate-area");
  assert.equal(propertyValue(legacy, "KM"), "6.5");
  assert.doesNotMatch(current + legacy, /RU\[japanese-1989-gostone-v1\]/);
});

test("escapes malicious player and bot text without creating SGF nodes or properties", () => {
  const maliciousName = "Mallory];B[aa]\\\r\n(;W[ss])";
  const maliciousModel = "model]\\\n(;B[bb])";
  const sgf = exportGameToSgf(japaneseInput({
    players: { blackName: maliciousName, whiteName: "Normal" },
    bots: {
      black: {
        provider: "local]provider",
        model: maliciousModel,
        version: "v1\\candidate",
      },
    },
  }));

  assert.equal(propertyValue(sgf, "PB"), "Mallory];B[aa]\\ (;W[ss])");
  assert.equal(propertyValue(sgf, "PW"), "Normal");
  assert.deepEqual(JSON.parse(propertyValue(sgf, "GSBOTB")!), {
    kind: "bot",
    provider: "local]provider",
    model: maliciousModel,
    version: "v1\\candidate",
  });
  assert.equal(moveNodeCount(sgf), 0);
  assert.ok(sgf.endsWith(")\n"));
});

test("rejects mismatched rules, malformed moves, unknown fields, and invented outcomes", () => {
  assert.throws(
    () => exportGameToSgf(japaneseInput({
      rules: { ...japaneseInput().rules, scoringMethod: "area" },
    })),
    errorCode("invalid_rules"),
  );
  assert.throws(
    () => exportGameToSgf(japaneseInput({
      moves: [{ moveNumber: 1, color: "white", x: 0, y: 0, isPass: false }],
    })),
    errorCode("invalid_move"),
  );
  assert.throws(
    () => exportGameToSgf({ ...japaneseInput(), locale: "de" } as SgfExportInput),
    errorCode("invalid_input"),
  );
  assert.throws(
    () => exportGameToSgf(japaneseInput({
      result: { kind: "no-result", reason: "timeout" } as unknown as SgfTerminalResult,
    })),
    errorCode("invalid_result"),
  );
});

test("rejects sparse and accessor-backed evidence without invoking accessors", () => {
  const sparse = new Array(1) as SgfExportInput["moves"];
  assert.throws(
    () => exportGameToSgf(japaneseInput({ moves: sparse })),
    errorCode("invalid_move"),
  );

  let accessed = false;
  const accessorMoves: unknown[] = [];
  Object.defineProperty(accessorMoves, "0", {
    enumerable: true,
    get() {
      accessed = true;
      return { moveNumber: 1, color: "black", x: 0, y: 0, isPass: false };
    },
  });
  assert.throws(
    () => exportGameToSgf(japaneseInput({
      moves: accessorMoves as SgfExportInput["moves"],
    })),
    errorCode("invalid_move"),
  );
  assert.equal(accessed, false);
});
