import assert from "node:assert/strict";
import test from "node:test";
import { DeterministicKataGoScoringProvider } from "./deterministicProvider";
import { KataGoScoringError } from "./errors";
import {
  createKataGoScoringRuntime,
  DEFAULT_KATAGO_SCORING_VISITS,
} from "./runtime";

const identity = {
  KATAGO_ENGINE_VERSION: "katago-test",
  KATAGO_MODEL_VERSION: "model-test",
  KATAGO_CONFIG_VERSION: "config-test",
};

test("runtime binds provider, model identity, and bounded visits", () => {
  const runtime = createKataGoScoringRuntime({
    ...identity,
    KATAGO_SCORING_PROVIDER: "deterministic",
    KATAGO_MAX_VISITS: "64",
  }, { deterministicProvider: new DeterministicKataGoScoringProvider() });
  assert.deepEqual(runtime.engine, {
    engineVersion: "katago-test",
    modelVersion: "model-test",
    configVersion: "config-test",
  });
  assert.equal(runtime.providerKind, "deterministic");
  assert.equal(runtime.maxVisits, 64);
  assert.equal(Object.isFrozen(runtime), true);
  assert.equal(
    createKataGoScoringRuntime({
      ...identity,
      KATAGO_SCORING_PROVIDER: "deterministic",
    }, { deterministicProvider: new DeterministicKataGoScoringProvider() }).maxVisits,
    DEFAULT_KATAGO_SCORING_VISITS,
  );
});

test("runtime fails closed without exact server-only configuration", () => {
  for (const environment of [
    {},
    { ...identity, KATAGO_SCORING_PROVIDER: "deterministic" },
    { ...identity, KATAGO_SCORING_PROVIDER: "unknown" },
    { ...identity, KATAGO_SCORING_PROVIDER: "deterministic", KATAGO_MAX_VISITS: "0" },
    { KATAGO_SCORING_PROVIDER: "deterministic" },
  ]) {
    assert.throws(
      () => createKataGoScoringRuntime(environment, {}),
      (error) => error instanceof KataGoScoringError && error.code === "provider_not_configured",
    );
  }
});
