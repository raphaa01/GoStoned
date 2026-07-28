import assert from "node:assert/strict";
import test from "node:test";
import { createIdentityRequestAuthority } from "./identityAuthority";

test("identity request generations reject A-B-A response races", () => {
  const authority = createIdentityRequestAuthority("account:A");
  const firstA = authority.capture();
  assert.equal(authority.isCurrent(firstA), true);

  assert.equal(authority.updateIdentity("account:B"), true);
  assert.equal(authority.isCurrent(firstA), false);
  const playerB = authority.capture();

  assert.equal(authority.updateIdentity("account:A"), true);
  assert.equal(authority.isCurrent(firstA), false);
  assert.equal(authority.isCurrent(playerB), false);
  assert.equal(authority.isCurrent(authority.capture()), true);
});

test("terminal invalidation rejects every request already in flight", () => {
  const authority = createIdentityRequestAuthority("guest:A");
  const poll = authority.capture();
  const mutation = authority.capture();
  authority.invalidate();
  assert.equal(authority.isCurrent(poll), false);
  assert.equal(authority.isCurrent(mutation), false);
  assert.equal(authority.isCurrent(authority.capture()), true);
  assert.equal(authority.updateIdentity("guest:A"), false);
});
