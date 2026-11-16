import assert from "node:assert/strict";
import test from "node:test";
import { assertNativeKataGoStatus, preferNativeReviewResult } from "./nativeKataGo";
import { MOBILE_KATAGO } from "./katagoContract";
import type { GameAnalysisResult } from "../analysis/types";

test("accepts only the pinned available native KataGo runtime", () => {
  assert.doesNotThrow(() => assertNativeKataGoStatus({
    available: true,
    engineVersion: MOBILE_KATAGO.engineVersion,
    modelSha256: MOBILE_KATAGO.modelSha256.toUpperCase(),
  }));
  assert.throws(() => assertNativeKataGoStatus({
    available: false,
    reason: "core not linked",
    engineVersion: MOBILE_KATAGO.engineVersion,
    modelSha256: MOBILE_KATAGO.modelSha256,
  }), /core not linked/);
  assert.throws(() => assertNativeKataGoStatus({
    available: true,
    engineVersion: "v0.0.0",
    modelSha256: MOBILE_KATAGO.modelSha256,
  }), /does not match/);
});

test("a restarted native review preserves coverage and verified moves", () => {
  const review = (moves: number, provisional: boolean) => ({
    gameVersion: 3,
    moves: Array.from({ length: moves }, () => ({ provisional, classification: "good" })),
  }) as GameAnalysisResult;
  const saved = review(10, false);
  assert.equal(preferNativeReviewResult(saved, null), saved);
  assert.equal(preferNativeReviewResult(saved, review(1, true)), saved);
  assert.equal(preferNativeReviewResult(saved, review(10, true)), saved);
  const longer = review(11, true);
  assert.equal(preferNativeReviewResult(saved, longer), longer);
});
