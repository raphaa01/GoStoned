import assert from "node:assert/strict";
import test from "node:test";
import type { PoolClient } from "pg";
import { assertCommunityParticipation } from "./communityService";
import { isPlayerReportingEnabled } from "./playerReportGate";
test("unaccepted and suspended identities cannot create chat content", async () => {
  for (const [accepted, restricted, code] of [[false, false, "community_rules_required"], [true, true, "community_suspended"]] as const) {
    const client = { query: async () => ({ rows: [{ accepted, restricted }] }) } as unknown as PoolClient;
    await assert.rejects(assertCommunityParticipation("user:11111111-1111-4111-8111-111111111111", client), { code });
  }
  const client = { query: async () => ({ rows: [{ accepted: true, restricted: false }] }) } as unknown as PoolClient;
  await assert.doesNotReject(assertCommunityParticipation("guest:22222222-2222-4222-8222-222222222222", client));
});
test("reporting is ready by default and can be disabled explicitly", () => {
  assert.equal(isPlayerReportingEnabled("true"), true);
  assert.equal(isPlayerReportingEnabled("false"), false);
  assert.equal(isPlayerReportingEnabled("TRUE"), false);
});
