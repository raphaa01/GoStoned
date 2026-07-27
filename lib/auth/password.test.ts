import assert from "node:assert/strict";
import test from "node:test";
import { hashPassword, normalizeUsername, validatePassword, verifyPassword } from "./password";

test("hashes and verifies passwords without storing the original password", async () => {
  const password = "correct-horse-42";
  const encoded = await hashPassword(password);
  assert.equal(encoded.includes(password), false);
  assert.equal(await verifyPassword(password, encoded), true);
  assert.equal(await verifyPassword("wrong-password", encoded), false);
});

test("validates usernames and password length", () => {
  assert.equal(normalizeUsername(" Stone_Player "), "Stone_Player");
  assert.equal(normalizeUsername("no spaces"), null);
  assert.equal(normalizeUsername("ab"), null);
  assert.equal(validatePassword("short"), "Password must contain at least 8 characters.");
  assert.equal(validatePassword("long-enough"), null);
});
