import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { AuthError } from "./accountService";
import { assertAuthMutationRequest, readCredentialRequest } from "./credentialRequest";

function credentialRequest(body: BodyInit, headers: Record<string, string> = {}) {
  return new NextRequest("https://gostone.test/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body,
  });
}

test("credential requests reject malformed and non-object JSON as client errors", async () => {
  for (const body of ["{", "null", "[]", JSON.stringify("credentials")]) {
    await assert.rejects(
      readCredentialRequest(credentialRequest(body)),
      (error) =>
        error instanceof AuthError
        && error.status === 400
        && error.code === "invalid_request",
    );
  }
});

test("credential requests retain normalized credential validation", async () => {
  assert.deepEqual(
    await readCredentialRequest(credentialRequest(
      JSON.stringify({ username: " Named_Player ", password: "password123" }),
    )),
    { username: "Named_Player", password: "password123" },
  );
});

test("auth mutation guard rejects non-JSON and cross-origin credential requests", async () => {
  const rejected = [
    credentialRequest(
      JSON.stringify({ username: "Named_Player", password: "password123" }),
      { "Content-Type": "text/plain" },
    ),
    credentialRequest(
      JSON.stringify({ username: "Named_Player", password: "password123" }),
      { "Sec-Fetch-Site": "cross-site" },
    ),
    credentialRequest(
      JSON.stringify({ username: "Named_Player", password: "password123" }),
      { Origin: "https://attacker.example" },
    ),
  ];

  for (const request of rejected) {
    await assert.rejects(
      readCredentialRequest(request),
      (error) =>
        error instanceof AuthError
        && error.status === 403
        && error.code === "request_rejected",
    );
  }

  assert.doesNotThrow(() => assertAuthMutationRequest(new NextRequest(
    "https://gostone.test/api/auth/logout",
    { method: "POST", headers: { Origin: "https://gostone.test" } },
  )));
});

test("auth mutation guard recovers only the exact addressed loopback origin", () => {
  for (const origin of [
    "http://localhost:3100",
    "http://127.0.0.1:3100",
    "http://127.9.8.7:3100",
    "http://[::1]:3100",
  ]) {
    const request = new NextRequest(`${origin}/api/auth/logout`, {
      method: "POST",
      headers: { Host: new URL(origin).host, Origin: origin },
    });
    assert.equal(request.nextUrl.origin, "http://localhost:3100");
    assert.doesNotThrow(() => assertAuthMutationRequest(request));
  }

  for (const rejectedOrigin of [
    "http://localhost:3100",
    "http://127.9.8.7:3100",
    "http://[::1]:3100",
    "https://127.0.0.1:3100",
    "http://127.0.0.1:3101",
    "http://127.attacker.example:3100",
    "http://attacker.example:3100",
    "http://user@127.0.0.1:3100",
    "http://127.0.0.1:3100/path",
    "http://127.0.0.1:3100, http://attacker.example",
    "not an origin",
  ]) {
    const request = new NextRequest("http://127.0.0.1:3100/api/auth/logout", {
      method: "POST",
      headers: { Host: "127.0.0.1:3100", Origin: rejectedOrigin },
    });
    assert.throws(
      () => assertAuthMutationRequest(request),
      (error) => error instanceof AuthError
        && error.status === 403
        && error.code === "request_rejected",
    );
  }

  assert.throws(
    () => assertAuthMutationRequest(new NextRequest(
      "http://127.0.0.1:3100/api/auth/logout",
      { method: "POST", headers: { Origin: "http://127.0.0.1:3100" } },
    )),
    (error) => error instanceof AuthError
      && error.status === 403
      && error.code === "request_rejected",
  );

  for (const host of [
    "user@127.0.0.1:3100",
    "127.0.0.1:3100/path",
    "127.0.0.1:3100?query",
    "127.0.0.1:3100#fragment",
    "attacker.example:3100",
  ]) {
    assert.throws(
      () => assertAuthMutationRequest(new NextRequest(
        "http://127.0.0.1:3100/api/auth/logout",
        {
          method: "POST",
          headers: { Host: host, Origin: "http://127.0.0.1:3100" },
        },
      )),
      (error) => error instanceof AuthError
        && error.status === 403
        && error.code === "request_rejected",
    );
  }

  assert.throws(
    () => assertAuthMutationRequest(new NextRequest(
      "https://gostone.app/api/auth/logout",
      { method: "POST", headers: { Origin: "https://go-stone.vercel.app" } },
    )),
    (error) => error instanceof AuthError
      && error.status === 403
      && error.code === "request_rejected",
  );
});
