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
  boardPlacementDataType: "text",
  boardPlacementDefault: "'zoom'::text",
  boardPlacementNullable: "NO",
  boardPlacementConstraint: "CHECK (board_placement IN ('zoom', 'direct'))",
  analysisProgressDataType: "jsonb",
  analysisProgressConstraint:
    "CHECK (status = 'running' AND (result IS NULL OR progress IS NOT NULL))",
  takebackRls: true,
};

test("accepts the current Japanese matchmaking schema", () => {
  assert.doesNotThrow(() => validateProductionSchemaContract(currentSnapshot));
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
