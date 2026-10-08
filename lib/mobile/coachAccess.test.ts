import assert from "node:assert/strict";
import test from "node:test";
import { serializeAuthUser } from "@/lib/auth/types";
import { getSessionUser } from "@/lib/auth/session";
import { canPlayCoach } from "./coachAccess";

const account = { id: "beta", username: "rapha", display_name: "Rapha" };
test("coach is opt-in, native-only, and closed during loading or session errors", () => {
  const invited = serializeAuthUser({ ...account, coach_beta_enabled: true });
  assert.equal(invited.coachBetaEnabled, true);
  assert.equal(serializeAuthUser(account).coachBetaEnabled, false);
  assert.equal(canPlayCoach(invited, true), true);
  assert.equal(canPlayCoach(invited, false), false);
  assert.equal(canPlayCoach(invited, true, true), false);
  assert.equal(canPlayCoach(invited, true, false, "expired"), false);
  assert.equal(canPlayCoach(null, true), false);
  assert.equal(canPlayCoach(serializeAuthUser({ ...account, coach_beta_enabled: false }), true), false);
});

test("session serialization exposes the current database entitlement and its revocation", async () => {
  for (const enabled of [true, false]) {
    const user = await getSessionUser("A".repeat(43), async () => ({ ...account, coach_beta_enabled: enabled, expires_at: new Date(Date.now() + 10000) }));
    assert.equal(canPlayCoach(user, true), enabled);
  }
});
