import assert from "node:assert/strict";
import test from "node:test";
import {
  classifySettlementGroup,
  ownershipSurvivalProbability,
} from "./settlementClassification";

test("derives stone survival from KataGo-compatible ownership perspective", () => {
  assert.equal(ownershipSurvivalProbability("black", -1), 1);
  assert.equal(ownershipSurvivalProbability("black", 1), 0);
  assert.equal(ownershipSurvivalProbability("white", 1), 1);
  assert.equal(ownershipSurvivalProbability("white", -1), 0);
});

test("combines both v4 settlement heads instead of trusting survival alone", () => {
  assert.equal(classifySettlementGroup({
    modelSurvival: 0.5,
    ownershipSurvival: 0.12,
    libertyCount: 2,
    enclosedEyeCount: 0,
  }).status, "dead");
  assert.equal(classifySettlementGroup({
    modelSurvival: 0.88,
    ownershipSurvival: 0.12,
    libertyCount: 2,
    enclosedEyeCount: 0,
  }).status, "uncertain");
});

test("two enclosed eyes conservatively override a pessimistic model proposal", () => {
  assert.equal(classifySettlementGroup({
    modelSurvival: 0.05,
    ownershipSurvival: 0.05,
    libertyCount: 8,
    enclosedEyeCount: 2,
  }).status, "alive");
});

test("keeps conflicting mid-confidence evidence visibly uncertain", () => {
  assert.equal(classifySettlementGroup({
    modelSurvival: 0.65,
    ownershipSurvival: 0.45,
    libertyCount: 4,
    enclosedEyeCount: 0,
  }).status, "uncertain");
});
