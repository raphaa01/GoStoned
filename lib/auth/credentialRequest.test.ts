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
