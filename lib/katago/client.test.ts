import assert from "node:assert/strict";
import test from "node:test";
import { KataGoScoringClient } from "./client";
import type { CanonicalKataGoScoringRequest, KataGoScoringProvider } from "./contracts";
import { kataGoError, KataGoScoringError } from "./errors";
import { providerResponseFixture, scoringRequestFixture } from "./testFixtures";

function errorCode(code: string) {
  return (error: unknown) => error instanceof KataGoScoringError && error.code === code;
}

function provider(
  analyze: KataGoScoringProvider["analyze"],
): KataGoScoringProvider {
  return { kind: "deterministic", analyze };
}

test("client coalesces concurrent requests and serves only validated cached proposals", async () => {
  let calls = 0;
  let release: (() => void) | undefined;
  let captured: CanonicalKataGoScoringRequest | undefined;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const scoringProvider = provider(async (request) => {
    calls += 1;
    captured = request;
    await gate;
    return providerResponseFixture(request);
  });
  const client = new KataGoScoringClient({ provider: scoringProvider, maxRetries: 0 });
  const request = scoringRequestFixture();
  const first = client.analyze(request);
  const second = client.analyze(structuredClone(request));
  assert.equal(calls, 1);
  assert.equal(captured?.requestIdentity.startsWith("sha256:"), true);
  release!();
  const [left, right] = await Promise.all([first, second]);
  assert.equal(left, right);
  assert.equal(calls, 1);
  assert.equal(await client.analyze(request), left);
  assert.equal(calls, 1);

  const changed = { ...request, scoringRevision: 2 };
  await client.analyze(changed);
  assert.equal(calls, 2);
});

test("one caller abort does not cancel a coalesced operation for another caller", async () => {
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let calls = 0;
  const scoringProvider = provider(async (request) => {
    calls += 1;
    await gate;
    return providerResponseFixture(request);
  });
  const client = new KataGoScoringClient({ provider: scoringProvider, maxRetries: 0 });
  const controller = new AbortController();
  const cancelled = client.analyze(scoringRequestFixture(), { signal: controller.signal });
  const survivor = client.analyze(scoringRequestFixture());
  controller.abort();
  await assert.rejects(cancelled, errorCode("request_aborted"));
  release!();
  assert.equal((await survivor).providerKind, "deterministic");
  assert.equal(calls, 1);
});

test("client retries retryable failures only within its configured bound", async () => {
  let calls = 0;
  const scoringProvider = provider(async (request) => {
    calls += 1;
    if (calls === 1) {
      throw kataGoError("provider_unavailable", "temporary", { retryable: true });
    }
    return providerResponseFixture(request);
  });
  const client = new KataGoScoringClient({
    provider: scoringProvider,
    maxRetries: 1,
    retryDelayMs: 0,
  });
  assert.equal((await client.analyze(scoringRequestFixture())).providerKind, "deterministic");
  assert.equal(calls, 2);

  let permanentCalls = 0;
  const permanent = new KataGoScoringClient({
    provider: provider(async () => {
      permanentCalls += 1;
      throw kataGoError("invalid_response", "bad response");
    }),
    maxRetries: 2,
    retryDelayMs: 0,
  });
  await assert.rejects(permanent.analyze(scoringRequestFixture()), errorCode("invalid_response"));
  assert.equal(permanentCalls, 1);
});

test("client enforces a deadline even when a provider ignores cancellation", async () => {
  const client = new KataGoScoringClient({
    provider: provider(() => new Promise(() => undefined)),
    timeoutMs: 100,
    maxRetries: 0,
  });
  await assert.rejects(client.analyze(scoringRequestFixture()), errorCode("request_timeout"));
});

test("client opens its circuit after consecutive failed operations and probes after cooldown", async () => {
  let now = 0;
  let calls = 0;
  let fail = true;
  const scoringProvider = provider(async (request) => {
    calls += 1;
    if (fail) throw kataGoError("provider_unavailable", "temporary", { retryable: true });
    return providerResponseFixture(request);
  });
  const client = new KataGoScoringClient({
    provider: scoringProvider,
    maxRetries: 0,
    circuitFailureThreshold: 2,
    circuitCooldownMs: 1_000,
    now: () => now,
  });
  await assert.rejects(client.analyze(scoringRequestFixture()), errorCode("provider_unavailable"));
  await assert.rejects(
    client.analyze({ ...scoringRequestFixture(), scoringRevision: 2 }),
    errorCode("provider_unavailable"),
  );
  await assert.rejects(
    client.analyze({ ...scoringRequestFixture(), scoringRevision: 3 }),
    errorCode("circuit_open"),
  );
  assert.equal(calls, 2);
  now = 1_001;
  fail = false;
  assert.equal(
    (await client.analyze({ ...scoringRequestFixture(), scoringRevision: 3 })).scoringRevision,
    3,
  );
  assert.equal(calls, 3);
});

test("bounded retry exhaustion has a stable public error code", async () => {
  let calls = 0;
  const client = new KataGoScoringClient({
    provider: provider(async () => {
      calls += 1;
      throw kataGoError("provider_unavailable", "temporary", { retryable: true });
    }),
    maxRetries: 2,
    retryDelayMs: 0,
  });
  await assert.rejects(client.analyze(scoringRequestFixture()), errorCode("retries_exhausted"));
  assert.equal(calls, 3);
});
