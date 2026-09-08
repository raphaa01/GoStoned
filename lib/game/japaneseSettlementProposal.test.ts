import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { createEmptyBoard, boardHash } from "./goEngine";
import { JAPANESE_1989_RULES_PROFILE } from "./japanesePolicyContract";
import {
  hashJapaneseSettlementProposalV1,
  JapaneseSettlementProposalError,
  serializeJapaneseSettlementProposalV1,
  type JapaneseSettlementProposalErrorCode,
  type JapaneseSettlementProposalInput,
} from "./japaneseSettlementProposal";
import { RULES_POLICIES } from "./rulesPolicy";
import type { BoardSize } from "./types";

const GOLDEN_BOARD_HASH =
  "B.W....../.B......./........./........./........./........./........./........./........W";
const GOLDEN_CANONICAL =
  "[\"japanese-settlement-proposal-v1\",[\"game-id\",\"01890f3e-7b7a-7cc2-98e7-5d5e08e7a65f\"],[\"stopped-board-hash\",\"B.W....../.B......./........./........./........./........./........./........./........W\"],[\"stopped-move-number\",\"42\"],[\"revision\",\"3\"],[\"rules-identity\",[[\"rules\",\"japanese\"],[\"rules-profile\",\"japanese-1989-gostone-v1\"],[\"scoring-method\",\"territory\"],[\"komi-half-points\",\"13\"],[\"handicap\",\"0\"]]],[\"prisoner-ledger\",[[\"captured-white-by-black\",\"2\"],[\"captured-black-by-white\",\"1\"]]],[\"sorted-dead-stones\",[[\"2\",\"0\",\"white\"],[\"8\",\"8\",\"white\"]]],[\"sorted-neutral-region-seeds\",[[\"3\",\"3\"],[\"4\",\"4\"]]]]";
const GOLDEN_HASH = "2f5b9112944f56e3fb903bbb232746cdc0a8f6c6f40e108c56a7c4f3d68b8a2c";

function goldenProposal(): JapaneseSettlementProposalInput {
  return {
    gameId: "01890f3e-7b7a-7cc2-98e7-5d5e08e7a65f",
    stoppedBoardHash: GOLDEN_BOARD_HASH,
    stoppedMoveNumber: 42,
    revision: 3,
    rulesIdentity: {
      rules: "japanese",
      rulesProfile: JAPANESE_1989_RULES_PROFILE,
      scoringMethod: "territory",
      komi: 6.5,
      handicap: 0,
    },
    prisoners: {
      capturedWhiteByBlack: 2,
      capturedBlackByWhite: 1,
    },
    deadStones: [
      { x: 8, y: 8, color: "white" },
      { x: 2, y: 0, color: "white" },
    ],
    neutralRegionSeeds: [{ x: 4, y: 4 }, { x: 3, y: 3 }],
  };
}

function emptyProposal(size: BoardSize = 9): JapaneseSettlementProposalInput {
  return {
    ...goldenProposal(),
    stoppedBoardHash: boardHash(createEmptyBoard(size)),
    stoppedMoveNumber: 2,
    revision: 1,
    prisoners: {
      capturedWhiteByBlack: 0,
      capturedBlackByWhite: 0,
    },
    deadStones: [],
    neutralRegionSeeds: [],
  };
}

function assertProposalError(
  input: unknown,
  code: JapaneseSettlementProposalErrorCode,
): void {
  assert.throws(
    () => serializeJapaneseSettlementProposalV1(input as JapaneseSettlementProposalInput),
    (error: unknown) => error instanceof JapaneseSettlementProposalError && error.code === code,
  );
}

function assertHashError(
  input: unknown,
  code: JapaneseSettlementProposalErrorCode,
): void {
  assert.throws(
    () => hashJapaneseSettlementProposalV1(input as JapaneseSettlementProposalInput),
    (error: unknown) => error instanceof JapaneseSettlementProposalError && error.code === code,
  );
}

function replaceBoardPoint(hash: string, x: number, y: number, value: "." | "B" | "W"): string {
  const rows = hash.split("/");
  rows[y] = `${rows[y].slice(0, x)}${value}${rows[y].slice(x + 1)}`;
  return rows.join("/");
}

test("serializes and hashes the published Japanese settlement golden vector", () => {
  const canonical = serializeJapaneseSettlementProposalV1(goldenProposal());
  assert.equal(canonical, GOLDEN_CANONICAL);
  assert.equal(Buffer.byteLength(canonical, "utf8"), 609);
  assert.equal(hashJapaneseSettlementProposalV1(goldenProposal()), GOLDEN_HASH);
  assert.equal(createHash("sha256").update(canonical, "utf8").digest("hex"), GOLDEN_HASH);
  assert.match(GOLDEN_HASH, /^[0-9a-f]{64}$/);
});

test("canonical ordering is permutation-invariant and does not mutate caller evidence", () => {
  const original = goldenProposal();
  const before = JSON.stringify(original);
  const reversed: JapaneseSettlementProposalInput = {
    ...goldenProposal(),
    deadStones: [...goldenProposal().deadStones].reverse(),
    neutralRegionSeeds: [...goldenProposal().neutralRegionSeeds].reverse(),
  };

  assert.equal(serializeJapaneseSettlementProposalV1(original), GOLDEN_CANONICAL);
  assert.equal(serializeJapaneseSettlementProposalV1(reversed), GOLDEN_CANONICAL);
  assert.equal(hashJapaneseSettlementProposalV1(reversed), GOLDEN_HASH);
  assert.equal(JSON.stringify(original), before);
});

test("rejects changing top-level accessors without invoking them", () => {
  for (const field of [
    "gameId",
    "stoppedBoardHash",
    "stoppedMoveNumber",
    "revision",
    "prisoners",
  ] as const) {
    const proposal = { ...goldenProposal() };
    const originalValue = proposal[field];
    let reads = 0;
    Object.defineProperty(proposal, field, {
      configurable: true,
      enumerable: true,
      get() {
        reads += 1;
        return reads === 1 ? originalValue : null;
      },
    });

    assertHashError(proposal, "invalid_proposal");
    assert.equal(reads, 0, `${field} getter must not be invoked`);
  }
});

test("rejects nested accessors and wraps hostile inspection failures", () => {
  let prisonerReads = 0;
  const prisoners = {
    capturedBlackByWhite: 1,
    get capturedWhiteByBlack() {
      prisonerReads += 1;
      return prisonerReads === 1 ? 2 : 99;
    },
  };
  assertHashError({ ...goldenProposal(), prisoners }, "invalid_prisoner_ledger");
  assert.equal(prisonerReads, 0);

  let throwingGetterReads = 0;
  const throwingProposal = { ...goldenProposal() };
  Object.defineProperty(throwingProposal, "gameId", {
    configurable: true,
    enumerable: true,
    get() {
      throwingGetterReads += 1;
      throw new Error("getter escaped");
    },
  });
  assertHashError(throwingProposal, "invalid_proposal");
  assert.equal(throwingGetterReads, 0);

  const hostileProposal = new Proxy(goldenProposal(), {
    ownKeys() {
      throw new Error("proxy escaped");
    },
  });
  assertHashError(hostileProposal, "invalid_proposal");

  const hostileDeadStones = new Proxy([...goldenProposal().deadStones], {
    getOwnPropertyDescriptor() {
      throw new Error("array proxy escaped");
    },
  });
  assertHashError(
    { ...goldenProposal(), deadStones: hostileDeadStones },
    "invalid_dead_stone",
  );

  const hostileThrownValue = new Proxy({}, {
    getPrototypeOf() {
      throw new RangeError("secondary escape");
    },
  });
  const hostileThrownProposal = new Proxy(goldenProposal(), {
    ownKeys() {
      throw hostileThrownValue;
    },
  });
  assertHashError(hostileThrownProposal, "invalid_proposal");

  const hostileThrownArray = new Proxy([...goldenProposal().deadStones], {
    getOwnPropertyDescriptor() {
      throw hostileThrownValue;
    },
  });
  assertHashError(
    { ...goldenProposal(), deadStones: hostileThrownArray },
    "invalid_dead_stone",
  );
});

test("requires exact own enumerable data properties on every record", () => {
  const baseline = goldenProposal();
  assertHashError({ ...baseline, extra: true }, "invalid_proposal");
  assertHashError(
    { ...baseline, [Symbol("extra")]: true },
    "invalid_proposal",
  );
  assertHashError(
    { ...baseline, rulesIdentity: { ...baseline.rulesIdentity, extra: true } },
    "rules_identity_mismatch",
  );
  assertHashError(
    { ...baseline, prisoners: { ...baseline.prisoners, extra: true } },
    "invalid_prisoner_ledger",
  );
  assertHashError(
    {
      ...baseline,
      deadStones: [{ ...baseline.deadStones[0], extra: true }],
    },
    "invalid_dead_stone",
  );
  assertHashError(
    {
      ...baseline,
      neutralRegionSeeds: [{ ...baseline.neutralRegionSeeds[0], extra: true }],
    },
    "invalid_neutral_region_seed",
  );

  const inheritedProposal = Object.assign(
    Object.create({ inherited: true }),
    baseline,
  );
  assertHashError(inheritedProposal, "invalid_proposal");
  const inheritedRules = Object.assign(
    Object.create({ inherited: true }),
    baseline.rulesIdentity,
  );
  assertHashError(
    { ...baseline, rulesIdentity: inheritedRules },
    "rules_identity_mismatch",
  );
  const inheritedPrisoners = Object.assign(
    Object.create({ inherited: true }),
    baseline.prisoners,
  );
  assertHashError(
    { ...baseline, prisoners: inheritedPrisoners },
    "invalid_prisoner_ledger",
  );
  const inheritedDeadStone = Object.assign(
    Object.create({ inherited: true }),
    baseline.deadStones[0],
  );
  assertHashError(
    { ...baseline, deadStones: [inheritedDeadStone] },
    "invalid_dead_stone",
  );
  const inheritedNeutralSeed = Object.assign(
    Object.create({ inherited: true }),
    baseline.neutralRegionSeeds[0],
  );
  assertHashError(
    { ...baseline, neutralRegionSeeds: [inheritedNeutralSeed] },
    "invalid_neutral_region_seed",
  );
});

test("requires dense own data slots and rejects inherited or accessor array evidence", () => {
  const baseline = goldenProposal();
  const inheritedSlot: unknown[] = [];
  inheritedSlot.length = 1;
  Object.setPrototypeOf(
    inheritedSlot,
    Object.create(Array.prototype, {
      0: {
        configurable: true,
        enumerable: true,
        value: baseline.deadStones[0],
        writable: true,
      },
    }),
  );
  assertHashError(
    { ...baseline, deadStones: inheritedSlot },
    "invalid_dead_stone",
  );

  let accessorReads = 0;
  const accessorSlot = [...baseline.neutralRegionSeeds];
  Object.defineProperty(accessorSlot, "0", {
    configurable: true,
    enumerable: true,
    get() {
      accessorReads += 1;
      return accessorReads === 1 ? baseline.neutralRegionSeeds[0] : { x: 8, y: 8 };
    },
  });
  assertHashError(
    { ...baseline, neutralRegionSeeds: accessorSlot },
    "invalid_neutral_region_seed",
  );
  assert.equal(accessorReads, 0);

  const extraArrayProperty = [...baseline.deadStones];
  Object.defineProperty(extraArrayProperty, "extra", {
    configurable: true,
    enumerable: true,
    value: true,
  });
  assertHashError(
    { ...baseline, deadStones: extraArrayProperty },
    "invalid_dead_stone",
  );
});

test("every supported proposal input is bound to the digest", () => {
  const baseline = goldenProposal();
  const variants: JapaneseSettlementProposalInput[] = [
    { ...baseline, gameId: "01890f3e-7b7a-7cc2-98e7-5d5e08e7a650" },
    { ...baseline, stoppedBoardHash: replaceBoardPoint(baseline.stoppedBoardHash, 0, 8, "B") },
    { ...baseline, stoppedMoveNumber: 43 },
    { ...baseline, revision: 4 },
    {
      ...baseline,
      prisoners: { ...baseline.prisoners, capturedWhiteByBlack: 3 },
    },
    {
      ...baseline,
      prisoners: { ...baseline.prisoners, capturedBlackByWhite: 2 },
    },
    { ...baseline, deadStones: baseline.deadStones.slice(0, 1) },
    { ...baseline, neutralRegionSeeds: [...baseline.neutralRegionSeeds, { x: 5, y: 5 }] },
  ];

  for (const variant of variants) {
    assert.notEqual(hashJapaneseSettlementProposalV1(variant), GOLDEN_HASH);
  }
});

test("rules identity accepts only the exact active Japanese tuple", () => {
  const baseline = goldenProposal();
  const invalidRules = [
    { ...baseline.rulesIdentity, rules: "chinese" },
    { ...baseline.rulesIdentity, rulesProfile: "japanese-latest" },
    { ...baseline.rulesIdentity, scoringMethod: "area" },
    { ...baseline.rulesIdentity, komi: 7.5 },
    { ...baseline.rulesIdentity, handicap: 1 },
  ];
  for (const rulesIdentity of invalidRules) {
    assertProposalError({ ...baseline, rulesIdentity }, "rules_identity_mismatch");
  }

  assert.equal(
    hashJapaneseSettlementProposalV1({
      ...baseline,
      rulesIdentity: { ...baseline.rulesIdentity, komi: "6.5" },
    }),
    GOLDEN_HASH,
  );
  assert.equal(Object.hasOwn(RULES_POLICIES, JAPANESE_1989_RULES_PROFILE), true);
});

test("accepts supported board sizes and PostgreSQL integer boundaries", () => {
  for (const size of [9, 13, 19] as const) {
    assert.match(hashJapaneseSettlementProposalV1(emptyProposal(size)), /^[0-9a-f]{64}$/);
  }
  assert.match(
    hashJapaneseSettlementProposalV1({
      ...emptyProposal(),
      stoppedMoveNumber: 2_147_483_647,
      revision: 2_147_483_647,
      prisoners: {
        capturedWhiteByBlack: 2_147_483_647,
        capturedBlackByWhite: 2_147_483_647,
      },
    }),
    /^[0-9a-f]{64}$/,
  );
});

test("rejects malformed identities, boards, revisions, and prisoner ledgers", () => {
  const baseline = emptyProposal();
  assertProposalError({ ...baseline, gameId: baseline.gameId.toUpperCase() }, "invalid_game_id");
  assertProposalError({ ...baseline, gameId: "not-a-uuid" }, "invalid_game_id");

  for (const stoppedBoardHash of [
    "........./.........",
    `${boardHash(createEmptyBoard(9))}.`,
    boardHash(createEmptyBoard(9)).replace(".", "X"),
    boardHash(createEmptyBoard(13)).split("/").slice(0, 12).join("/"),
  ]) {
    assertProposalError({ ...baseline, stoppedBoardHash }, "invalid_board_hash");
  }

  for (const stoppedMoveNumber of [1, -1, 2.5, NaN, Infinity, 2_147_483_648]) {
    assertProposalError(
      { ...baseline, stoppedMoveNumber },
      "invalid_stopped_move_number",
    );
  }
  for (const revision of [0, -1, 1.5, NaN, Infinity, 2_147_483_648]) {
    assertProposalError({ ...baseline, revision }, "invalid_revision");
  }
  for (const prisoners of [
    { capturedWhiteByBlack: -1, capturedBlackByWhite: 0 },
    { capturedWhiteByBlack: 0.5, capturedBlackByWhite: 0 },
    { capturedWhiteByBlack: 0, capturedBlackByWhite: Infinity },
    { capturedWhiteByBlack: 0, capturedBlackByWhite: 2_147_483_648 },
  ]) {
    assertProposalError({ ...baseline, prisoners }, "invalid_prisoner_ledger");
  }
});

test("rejects malformed, duplicate, and contradictory dead-stone evidence", () => {
  const baseline = goldenProposal();
  for (const deadStones of [
    [{ x: -1, y: 0, color: "black" }],
    [{ x: 9, y: 0, color: "black" }],
    [{ x: 0.5, y: 0, color: "black" }],
    [{ x: 0, y: 0, color: "green" }],
  ]) {
    assertProposalError({ ...baseline, deadStones }, "invalid_dead_stone");
  }
  assertProposalError(
    { ...baseline, deadStones: [{ x: 0, y: 0, color: "white" }] },
    "dead_stone_board_mismatch",
  );
  assertProposalError(
    { ...baseline, deadStones: [{ x: 1, y: 0, color: "black" }] },
    "dead_stone_board_mismatch",
  );
  assertProposalError(
    {
      ...baseline,
      deadStones: [
        { x: 2, y: 0, color: "white" },
        { x: 2, y: 0, color: "white" },
      ],
    },
    "duplicate_dead_stone",
  );
  assertProposalError(
    {
      ...baseline,
      deadStones: [
        { x: 2, y: 0, color: "white" },
        { x: 2, y: 0, color: "black" },
      ],
    },
    "duplicate_dead_stone",
  );

  const sparse = new Array(1);
  assertProposalError({ ...baseline, deadStones: sparse }, "invalid_dead_stone");
  assertProposalError(
    { ...baseline, deadStones: new Array(82).fill({ x: 0, y: 0, color: "black" }) },
    "invalid_dead_stone",
  );
});

test("validates neutral seeds against the board after agreed dead stones are removed", () => {
  const baseline = goldenProposal();
  for (const neutralRegionSeeds of [
    [{ x: -1, y: 0 }],
    [{ x: 0, y: 9 }],
    [{ x: 0, y: 0.5 }],
  ]) {
    assertProposalError(
      { ...baseline, neutralRegionSeeds },
      "invalid_neutral_region_seed",
    );
  }
  assertProposalError(
    { ...baseline, neutralRegionSeeds: [{ x: 0, y: 0 }] },
    "invalid_neutral_region_seed",
  );
  assertProposalError(
    { ...baseline, neutralRegionSeeds: [{ x: 3, y: 3 }, { x: 3, y: 3 }] },
    "duplicate_neutral_region_seed",
  );

  const neutralOnDead = {
    ...baseline,
    neutralRegionSeeds: [{ x: 2, y: 0 }],
  };
  assert.match(hashJapaneseSettlementProposalV1(neutralOnDead), /^[0-9a-f]{64}$/);

  const sparse = new Array(1);
  assertProposalError(
    { ...baseline, neutralRegionSeeds: sparse },
    "invalid_neutral_region_seed",
  );
  assertProposalError(
    { ...baseline, neutralRegionSeeds: new Array(82).fill({ x: 3, y: 3 }) },
    "invalid_neutral_region_seed",
  );
});

test("rejects non-object proposal and evidence shapes without leaking native errors", () => {
  assertProposalError(null, "invalid_proposal");
  assertProposalError({ ...emptyProposal(), rulesIdentity: null }, "rules_identity_mismatch");
  assertProposalError({ ...emptyProposal(), prisoners: null }, "invalid_prisoner_ledger");
  assertProposalError({ ...emptyProposal(), deadStones: null }, "invalid_dead_stone");
  assertProposalError(
    { ...emptyProposal(), neutralRegionSeeds: null },
    "invalid_neutral_region_seed",
  );
});
