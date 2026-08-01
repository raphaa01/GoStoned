import assert from "node:assert/strict";
import test from "node:test";
import { canonicalizeKataGoScoringRequest } from "./canonical";
import {
  DeterministicKataGoScoringProvider,
  deterministicAliveResponse,
} from "./deterministicProvider";
import { KataGoScoringError } from "./errors";
import {
  HostedKataGoHttpProvider,
  LocalKataGoHttpProvider,
  hostedKataGoProviderFromEnvironment,
  localKataGoProviderFromEnvironment,
} from "./httpProvider";
import { validateKataGoScoringResponse } from "./response";
import { providerResponseFixture, scoringRequestFixture } from "./testFixtures";

function errorCode(code: string) {
  return (error: unknown) => error instanceof KataGoScoringError && error.code === code;
}

test("deterministic provider is zero-network and satisfies the shared response contract", async () => {
  const request = canonicalizeKataGoScoringRequest(scoringRequestFixture());
  const provider = new DeterministicKataGoScoringProvider();
  const raw = await provider.analyze(request, { signal: new AbortController().signal });
  const proposal = validateKataGoScoringResponse(raw, request, provider.kind);
  assert.equal(proposal.providerKind, "deterministic");
  assert.deepEqual(proposal.deadStones, []);
  assert.equal(proposal.groups.every(({ suggestedDead }) => !suggestedDead), true);
});

test("deterministic provider honors cancellation before invoking its resolver", async () => {
  const request = canonicalizeKataGoScoringRequest(scoringRequestFixture());
  let called = false;
  const provider = new DeterministicKataGoScoringProvider(() => {
    called = true;
    return deterministicAliveResponse(request);
  });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    provider.analyze(request, { signal: controller.signal }),
    errorCode("request_aborted"),
  );
  assert.equal(called, false);
});

test("hosted and local HTTP adapters send the identical bounded JSON contract", async () => {
  const request = canonicalizeKataGoScoringRequest(scoringRequestFixture());
  const observations: Array<{ url: string; init: RequestInit | undefined }> = [];
  const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    observations.push({ url: String(input), init });
    return new Response(JSON.stringify(providerResponseFixture(request)), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
  const hosted = new HostedKataGoHttpProvider({
    baseUrl: "https://katago.invalid",
    token: "placeholder",
    fetchImplementation: fakeFetch,
  });
  const local = new LocalKataGoHttpProvider({
    baseUrl: "http://127.0.0.1:8080",
    fetchImplementation: fakeFetch,
  });
  const hostedRaw = await hosted.analyze(request, { signal: new AbortController().signal });
  const localRaw = await local.analyze(request, { signal: new AbortController().signal });
  assert.deepEqual(hostedRaw, localRaw);
  assert.equal(observations[0].url, "https://katago.invalid/v1/scoring-proposal");
  assert.equal(observations[1].url, "http://127.0.0.1:8080/v1/scoring-proposal");
  assert.equal(observations[0].init?.method, "POST");
  assert.equal(observations[0].init?.redirect, "error");
  assert.equal(observations[0].init?.cache, "no-store");
  assert.equal(JSON.parse(String(observations[0].init?.body)).requestIdentity, request.requestIdentity);
  assert.equal(
    (observations[0].init?.headers as Record<string, string>).Authorization,
    "Bearer placeholder",
  );
  assert.equal("Authorization" in (observations[1].init?.headers as Record<string, string>), false);
});

test("HTTP adapters fail closed on unsafe configuration without including configured values", () => {
  const credentialUrl = new URL("https://katago.invalid");
  credentialUrl.username = "user";
  credentialUrl.password = "pass";
  for (const construct of [
    () => new HostedKataGoHttpProvider({ baseUrl: "http://katago.invalid", token: "x" }),
    () => new HostedKataGoHttpProvider({ baseUrl: credentialUrl.href, token: "x" }),
    () => new HostedKataGoHttpProvider({ baseUrl: "https://katago.invalid?secret=x", token: "x" }),
    () => new LocalKataGoHttpProvider({ baseUrl: "https://katago.invalid" }),
  ]) {
    assert.throws(construct, (error) => {
      assert.equal(error instanceof KataGoScoringError && error.code, "provider_not_configured");
      assert.doesNotMatch((error as Error).message, /user|pass|secret=x/);
      return true;
    });
  }
  assert.throws(
    () => hostedKataGoProviderFromEnvironment({}),
    errorCode("provider_not_configured"),
  );
  assert.throws(
    () => localKataGoProviderFromEnvironment({}),
    errorCode("provider_not_configured"),
  );
});

test("HTTP adapter returns stable errors for status, JSON, size, and network failures", async () => {
  const request = canonicalizeKataGoScoringRequest(scoringRequestFixture());
  const cases: Array<[string, typeof fetch, string]> = [
    ["status", (async () => new Response("unavailable", { status: 503 })) as typeof fetch, "provider_http_error"],
    ["json", (async () => new Response("not-json", {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })) as typeof fetch, "invalid_response_json"],
    ["size", (async () => new Response("{}", {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })) as typeof fetch, "response_too_large"],
    ["network", (async () => { throw new Error("socket detail"); }) as typeof fetch, "provider_unavailable"],
  ];
  for (const [name, fetchImplementation, code] of cases) {
    const provider = new HostedKataGoHttpProvider({
      baseUrl: "https://katago.invalid",
      token: "placeholder",
      fetchImplementation,
      ...(name === "size" ? { maxResponseBytes: 1 } : {}),
    });
    await assert.rejects(
      provider.analyze(request, { signal: new AbortController().signal }),
      errorCode(code),
    );
  }
});
