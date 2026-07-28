import assert from "node:assert/strict";
import test from "node:test";
import { affectedAuthFields } from "./errorFields";

test("associates username errors only with the username field", () => {
  assert.deepEqual(affectedAuthFields("invalid_username"), ["username"]);
  assert.deepEqual(affectedAuthFields("username_taken"), ["username"]);
});

test("associates password errors only with the password field", () => {
  assert.deepEqual(affectedAuthFields("password_required"), ["password"]);
  assert.deepEqual(affectedAuthFields("password_too_short"), ["password"]);
  assert.deepEqual(affectedAuthFields("password_too_long"), ["password"]);
});

test("keeps cross-field and infrastructure failures semantically distinct", () => {
  assert.deepEqual(affectedAuthFields("invalid_credentials"), ["username", "password"]);
  assert.deepEqual(affectedAuthFields("rate_limited"), []);
  assert.deepEqual(affectedAuthFields("request_failed"), []);
  assert.deepEqual(affectedAuthFields(undefined), []);
});
