import assert from "node:assert/strict";
import test from "node:test";
import {
  validateProductionSchemaContract,
  type ProductionSchemaSnapshot,
} from "./productionSchemaContract";

const currentSnapshot: ProductionSchemaSnapshot = {
  migrationApplied: true,
  gameRulesDefault: "'japanese'::text",
  gameRulesProfileDefault: "'japanese-1989-gostone-v1'::text",
  gameScoringMethodDefault: "'territory'::text",
  gameKomiDefault: "6.5",
  queueRulesProfileDefault: "'japanese-1989-gostone-v1'::text",
  queueProfileConstraint:
    "CHECK (rules_profile IN ('legacy-immediate-area', 'chinese-2002-gostone-v1', 'japanese-1989-gostone-v1'))",
  queueAdaptiveConstraint:
    "CHECK (rules_snapshot = 'japanese' AND rules_version_snapshot = 'japanese-1989-gostone-v1' AND scoring_method_snapshot = 'territory' AND komi_snapshot = 6.5)",
  takebackRls: true,
};

test("accepts the current Japanese matchmaking schema", () => {
  assert.doesNotThrow(() => validateProductionSchemaContract(currentSnapshot));
});

test("rejects production when migration 037 is missing", () => {
  assert.throws(
    () => validateProductionSchemaContract({ ...currentSnapshot, migrationApplied: false }),
    /037_japanese_rules_and_takebacks\.sql/,
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
