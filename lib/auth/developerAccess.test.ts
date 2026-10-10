import assert from "node:assert/strict";
import test from "node:test";
import { hasDeveloperAccess } from "./developerAccess";
import { serializeAuthUser } from "./types";
import { getSessionUser } from "./session";
import { canPlayCoach } from "@/lib/mobile/coachAccess";
import { canOpenLearnLesson } from "@/lib/learn/access";
import { LEARN_LESSONS } from "@/lib/learn/curriculum";
import { emptyLearnProgress } from "@/lib/learn/progress";

const developerId = "2f507157-9a4a-4960-b3c8-87fa721cdd26";
const account = { id: developerId, username: "developer", display_name: "developer" };

test("developer privileges belong only to the provisioned identity, not a name or client flag", () => {
  assert.equal(hasDeveloperAccess(account), true);
  const renamed = { ...account, username: "renamed" };
  assert.equal(hasDeveloperAccess(renamed), true);
  assert.equal(hasDeveloperAccess({ ...account, id: "another-user" }), false);
  assert.equal(hasDeveloperAccess({ id: "developer" }), false);
  assert.equal(hasDeveloperAccess(null), false);
  assert.equal(hasDeveloperAccess(undefined), false);
  const spoofed = { ...account, id: "normal", developerAccess: true, analysisUnlimited: true };
  const ordinary = serializeAuthUser(spoofed);
  assert.equal(ordinary.developerAccess, false);
  assert.equal(ordinary.analysisUnlimited, false);
  assert.equal(ordinary.coachBetaEnabled, false);
});

test("developer serialization grants analysis and native coach access but not a web-only coach", () => {
  const user = serializeAuthUser(account);
  assert.equal(user.developerAccess, true);
  assert.equal(user.analysisUnlimited, true);
  assert.equal(user.coachBetaEnabled, true);
  assert.equal(canPlayCoach(user, true), true);
  assert.equal(canPlayCoach(user, false), false);
  assert.equal(canPlayCoach(user, true, true), false);
  assert.equal(canPlayCoach(user, true, false, "expired"), false);
  assert.equal(canPlayCoach(null, true), false);
  const ordinaryPremium = serializeAuthUser({ ...account, id: "premium", analysis_unlimited: true });
  assert.equal(ordinaryPremium.analysisUnlimited, true);
  assert.equal(ordinaryPremium.developerAccess, false);
  assert.equal(ordinaryPremium.coachBetaEnabled, false);
});

test("authenticated sessions derive current developer entitlements server-side", async () => {
  const user = await getSessionUser("A".repeat(43), async () => ({ ...account, expires_at: new Date(Date.now() + 1000) }));
  assert.equal(user?.developerAccess, true);
  assert.equal(user?.analysisUnlimited, true);
  assert.equal(canPlayCoach(user, true), true);
  assert.equal(await getSessionUser(undefined), null);
  assert.equal(await getSessionUser("A".repeat(43), async () => null), null);
});

test("developer can open every real lesson without forging completion; ordinary linear gates remain", () => {
  const progress = emptyLearnProgress();
  const before = JSON.stringify(progress);
  LEARN_LESSONS.forEach((_, index) => {
    assert.equal(canOpenLearnLesson(false, index, 0, true), true);
    assert.equal(canOpenLearnLesson(false, index, 0, false), index === 0);
  });
  assert.equal(canOpenLearnLesson(true, 5, 0, false), true);
  assert.equal(canOpenLearnLesson(false, -1, 0, true), false);
  assert.equal(JSON.stringify(progress), before);
  assert.deepEqual(progress.completedLessonIds, []);
  assert.deepEqual(progress.completedStages, []);
});
