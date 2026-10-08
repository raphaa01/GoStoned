import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  validateProductionSchemaContract,
  type ProductionSchemaSnapshot,
} from "./productionSchemaContract";

const productionPreflight = readFileSync(
  new URL("../../scripts/check-production-schema.ts", import.meta.url),
  "utf8",
);

const currentSnapshot: ProductionSchemaSnapshot = {
  gameRulesDefault: "'japanese'::text",
  gameRulesProfileDefault: "'japanese-1989-gostone-v1'::text",
  gameScoringMethodDefault: "'territory'::text",
  gameKomiDefault: "6.5",
  queueRulesProfileDefault: "'japanese-1989-gostone-v1'::text",
  queueProfileConstraint:
    "CHECK (rules_profile IN ('legacy-immediate-area', 'chinese-2002-gostone-v1', 'japanese-1989-gostone-v1'))",
  queueAdaptiveConstraint:
    "CHECK (rules_snapshot = 'japanese' AND rules_version_snapshot = 'japanese-1989-gostone-v1' AND scoring_method_snapshot = 'territory' AND komi_snapshot = 6.5)",
  initialRatingPolicyConstraint:
    "CHECK (policy_version IN ('starting-strength-v1', 'starting-strength-v2'))",
  puzzleCategoryConstraint:
    "CHECK (board_size = 19 AND category IN ('gokyo_life', 'gokyo_death', 'gokyo_ko'))",
  puzzleVisitsConstraint: "CHECK (((visits >= 0) AND (visits <= 10000)))",
  boardPlacementDataType: "text",
  boardPlacementDefault: "'zoom'::text",
  boardPlacementNullable: "NO",
  boardPlacementConstraint: "CHECK (board_placement IN ('zoom', 'direct'))",
  boardDesignDataType: "text",
  boardDesignDefault: "'default'::text",
  boardDesignNullable: "NO",
  boardDesignConstraint: "CHECK (board_design IN ('default', 'light-oak', 'dark-slate', 'white-porcelain', 'sage', 'bordeaux'))",
  analysisProgressDataType: "jsonb",
  analysisProgressConstraint:
    "CHECK (status = 'running' AND (result IS NULL OR progress IS NOT NULL))",
  takebackRls: true,
  learnProgressRls: true,
  learnProgressWritable: true,
  analysisPriceVoteConstraint:
    "CHECK ((monthly_price_eur = ANY (ARRAY[3, 5, 8, 12])))",
  analysisPriceVotePrimary: "PRIMARY KEY (user_id)",
  analysisPriceVoteRls: true,
  analysisPriceVoteWritable: true,
};

test("accepts the current Japanese matchmaking schema", () => {
  assert.doesNotThrow(() => validateProductionSchemaContract(currentSnapshot));
});

test("rejects missing board-design storage before deployment", () => {
  assert.throws(() => validateProductionSchemaContract({ ...currentSnapshot, boardDesignDataType: null }), /board-design preference column/);
  assert.throws(() => validateProductionSchemaContract({ ...currentSnapshot, boardDesignConstraint: "CHECK (board_design = 'default')" }), /board-design preference constraint/);
});

test("rejects missing or inaccessible learning progress storage before deployment", () => {
  assert.throws(() => validateProductionSchemaContract({...currentSnapshot, learnProgressRls:false}), /learning progress/);
  assert.throws(() => validateProductionSchemaContract({...currentSnapshot, learnProgressWritable:false}), /learning progress/);
  assert.match(productionPreflight, /learn_progress/);
});

test("rejects missing or invalid analysis price-vote storage before deployment", () => {
  assert.throws(() => validateProductionSchemaContract({ ...currentSnapshot, analysisPriceVoteRls: false }), /analysis price-vote storage/);
  assert.throws(() => validateProductionSchemaContract({ ...currentSnapshot, analysisPriceVoteWritable: false }), /analysis price-vote storage/);
  assert.throws(() => validateProductionSchemaContract({ ...currentSnapshot, analysisPriceVotePrimary: null }), /account uniqueness/);
  assert.throws(() => validateProductionSchemaContract({
    ...currentSnapshot,
    analysisPriceVoteConstraint: "CHECK (monthly_price_eur IN (3, 5))",
  }), /allowed values/);
  assert.match(productionPreflight, /analysis_price_vote_constraint/);
  assert.match(productionPreflight, /analysis_price_vote_writable/);
});

test("rejects the old Chinese-only queue profile constraint", () => {
  assert.throws(
    () => validateProductionSchemaContract({
      ...currentSnapshot,
      queueProfileConstraint:
        "CHECK (rules_profile IN ('legacy-immediate-area', 'chinese-2002-gostone-v1'))",
    }),
    /matchmaking rules-profile constraint/,
  );
});

test("rejects the old Chinese-only adaptive matchmaking constraint", () => {
  assert.throws(
    () => validateProductionSchemaContract({
      ...currentSnapshot,
      queueAdaptiveConstraint:
        "CHECK (rules_snapshot = 'chinese' AND scoring_method_snapshot = 'area')",
    }),
    /adaptive matchmaking constraint/,
  );
});

test("rejects a rating-policy constraint that blocks new accounts", () => {
  assert.throws(
    () => validateProductionSchemaContract({
      ...currentSnapshot,
      initialRatingPolicyConstraint:
        "CHECK (policy_version = 'starting-strength-v1')",
    }),
    /new-account rating-policy constraint/,
  );
});

test("rejects a puzzle schema that cannot store the historical catalog", () => {
  assert.throws(
    () => validateProductionSchemaContract({
      ...currentSnapshot,
      puzzleCategoryConstraint:
        "CHECK (board_size = 13 AND category IN ('life_and_death', 'tesuji'))",
    }),
    /historical puzzle-category constraint/,
  );
});

test("rejects the production constraint that blocked all imported puzzle reads", () => {
  for (const puzzleVisitsConstraint of [null, "CHECK (((visits >= 1) AND (visits <= 10000)))", "CHECK ((visits >= 0))"]) {
    assert.throws(() => validateProductionSchemaContract({ ...currentSnapshot, puzzleVisitsConstraint }), /imported puzzle visits constraint/);
  }
  assert.match(productionPreflight, /puzzles_visits_check/);
});

test("rejects a missing or incomplete board-placement preference", () => {
  assert.throws(
    () => validateProductionSchemaContract({
      ...currentSnapshot,
      boardPlacementDataType: null,
      boardPlacementDefault: null,
      boardPlacementNullable: null,
      boardPlacementConstraint: null,
    }),
    /board-placement preference column/,
  );
  assert.throws(
    () => validateProductionSchemaContract({
      ...currentSnapshot,
      boardPlacementConstraint: "CHECK (board_placement = 'zoom')",
    }),
    /board-placement preference constraint/,
  );
});

test("production preflight respects the private migration ledger", () => {
  assert.doesNotMatch(
    productionPreflight,
    /SELECT filename FROM public\.schema_migrations/,
  );
  assert.match(productionPreflight, /board_placement_constraint/);
  assert.match(productionPreflight, /analysis_progress_constraint/);
});

test("rejects a schema that cannot expose running analysis previews", () => {
  assert.throws(
    () => validateProductionSchemaContract({
      ...currentSnapshot,
      analysisProgressDataType: null,
      analysisProgressConstraint: null,
    }),
    /progressive analysis column/,
  );
});
