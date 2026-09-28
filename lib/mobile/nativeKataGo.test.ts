import assert from "node:assert/strict";
import test from "node:test";
import { assertNativeKataGoStatus } from "./nativeKataGo";
import { MOBILE_KATAGO } from "./katagoContract";

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
