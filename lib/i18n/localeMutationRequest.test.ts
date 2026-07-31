import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import {
  assertLocaleMutationMetadata,
  LocaleMutationRequestError,
  LOCALE_MUTATION_BODY_TIMEOUT_MS,
  MAX_LOCALE_MUTATION_BODY_BYTES,
  MAX_LOCALE_MUTATION_BODY_CHUNKS,
  readLocaleMutation,
} from "./localeMutationRequest";
import { SUPPORTED_LOCALES } from "./config";

function request(
  body: BodyInit | null,
  options: {
    contentLength?: string;
    contentType?: string;
    origin?: string;
    secFetchSite?: string;
    signal?: AbortSignal;
    url?: string;
  } = {},
): NextRequest {
  return new NextRequest(options.url ?? "https://gostone.test/api/locale", {
    method: "POST",
    headers: {
      "Content-Type": options.contentType ?? "application/json",
      ...(options.contentLength === undefined ? {} : {
        "Content-Length": options.contentLength,
      }),
      ...(options.origin === undefined ? {} : { Origin: options.origin }),
      ...(options.secFetchSite === undefined ? {} : {
        "Sec-Fetch-Site": options.secFetchSite,
      }),
    },
    ...(body === null ? {} : { body }),
    ...(body instanceof ReadableStream ? { duplex: "half" as const } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
  });
}

function invalidLocale(error: unknown): boolean {
  return error instanceof LocaleMutationRequestError
    && error.status === 400
    && error.code === "invalid_locale";
}

test("locale mutation metadata preserves the canonical request boundary", () => {
  assert.doesNotThrow(() => assertLocaleMutationMetadata(request(
    JSON.stringify({ locale: "de" }),
    { contentType: "application/json; charset=utf-8", origin: "https://GOSTONE.test:443" },
  )));

  for (const candidate of [
    request(JSON.stringify({ locale: "de" }), { contentType: "text/plain" }),
    request(JSON.stringify({ locale: "de" }), { origin: "https://attacker.test" }),
    request(JSON.stringify({ locale: "de" }), { origin: "not an origin" }),
    request(JSON.stringify({ locale: "de" }), { secFetchSite: "cross-site" }),
  ]) {
    assert.throws(
      () => assertLocaleMutationMetadata(candidate),
      (error: unknown) => error instanceof LocaleMutationRequestError
        && error.status === 403
        && error.code === "locale_request_rejected",
    );
  }

  assert.throws(
    () => assertLocaleMutationMetadata(request(
      JSON.stringify({ locale: "de" }),
      { url: "https://gostone.test/api/locale?cache-bust=1" },
    )),
    invalidLocale,
  );
});

test("locale mutation accepts an exact body across transport-defined chunks", async () => {
  for (const locale of SUPPORTED_LOCALES) {
    const encoded = new TextEncoder().encode(JSON.stringify({ locale }));
    let offset = 0;
    const fragmented = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (offset >= encoded.length) {
          controller.close();
          return;
        }
        controller.enqueue(encoded.subarray(offset, offset + 1));
        offset += 1;
      },
    });
    assert.equal(await readLocaleMutation(request(fragmented)), locale);
  }
});

test("declared locale body limits reject before consuming the stream", async () => {
  for (const contentLength of [
    "",
    "0",
    "00",
    "+15",
    "15.0",
    "1e2",
    "15, 15",
    String(MAX_LOCALE_MUTATION_BODY_BYTES + 1),
    String(Number.MAX_SAFE_INTEGER + 1),
  ]) {
    const stalled = new ReadableStream<Uint8Array>({
      pull() {
        return new Promise<void>(() => undefined);
      },
    });
    const candidate = request(stalled, { contentLength });
    await assert.rejects(readLocaleMutation(candidate), invalidLocale, contentLength);
    assert.equal(candidate.bodyUsed, false, contentLength);
  }
});

test("locale mutation rejects malformed JSON and an inexact object contract", async () => {
  const invalidBodies: Array<BodyInit | null> = [
    null,
    "",
    "not-json",
    "null",
    "[]",
    "\"de\"",
    "{}",
    JSON.stringify({ locale: "it" }),
    JSON.stringify({ locale: "de", padding: "" }),
    '{"locale":"de","__proto__":null}',
    new Uint8Array([0xc3, 0x28]),
  ];
  for (const body of invalidBodies) {
    await assert.rejects(readLocaleMutation(request(body)), invalidLocale);
  }

  const failed = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.error(new Error("transport failed"));
    },
  });
  await assert.rejects(readLocaleMutation(request(failed)), invalidLocale);
});

test("actual byte and chunk limits cancel without awaiting hostile cancellation", async () => {
  for (const fixture of ["bytes", "chunks"] as const) {
    let cancelled = 0;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        if (fixture === "bytes") {
          controller.enqueue(new Uint8Array(MAX_LOCALE_MUTATION_BODY_BYTES + 1));
          return;
        }
        for (let index = 0; index <= MAX_LOCALE_MUTATION_BODY_CHUNKS; index += 1) {
          controller.enqueue(new Uint8Array());
        }
      },
      cancel() {
        cancelled += 1;
        return new Promise<void>(() => undefined);
      },
    });
    await Promise.race([
      assert.rejects(readLocaleMutation(request(
        body,
        fixture === "bytes" ? { contentLength: "1" } : {},
      )), invalidLocale),
      new Promise((_, reject) => setTimeout(
        () => reject(new Error(`${fixture} rejection awaited cancellation`)),
        100,
      )),
    ]);
    assert.equal(cancelled, 1, fixture);
  }
});

test("locale mutation abort and deadline settle stalled readers", async () => {
  const abortController = new AbortController();
  let abortCancelled = 0;
  const abortedBody = new ReadableStream<Uint8Array>({
    pull() {
      return new Promise<void>(() => undefined);
    },
    cancel() {
      abortCancelled += 1;
      return new Promise<void>(() => undefined);
    },
  });
  const aborted = readLocaleMutation(request(abortedBody, { signal: abortController.signal }));
  await Promise.resolve();
  abortController.abort();
  await Promise.race([
    assert.rejects(aborted, invalidLocale),
    new Promise((_, reject) => setTimeout(
      () => reject(new Error("locale request abort did not settle")),
      100,
    )),
  ]);
  assert.equal(abortCancelled, 1);

  let timeoutCancelled = 0;
  const stalledBody = new ReadableStream<Uint8Array>({
    pull() {
      return new Promise<void>(() => undefined);
    },
    cancel() {
      timeoutCancelled += 1;
      return new Promise<void>(() => undefined);
    },
  });
  await Promise.race([
    assert.rejects(readLocaleMutation(request(stalledBody)), invalidLocale),
    new Promise((_, reject) => setTimeout(
      () => reject(new Error("locale body validation exceeded its deadline")),
      LOCALE_MUTATION_BODY_TIMEOUT_MS + 250,
    )),
  ]);
  assert.equal(timeoutCancelled, 1);
});
