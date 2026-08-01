import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const component = readFileSync(
  new URL("../../components/profile/ProfileView.tsx", import.meta.url),
  "utf8",
);

test("profile keeps a clear identity, performance, and history hierarchy", () => {
  assert.match(component, /className="profile-avatar-trigger"/);
  assert.match(component, /<ProfileAvatar size="lg"/);
  assert.match(component, /className="profile-header__identity"/);
  assert.match(component, /className="profile-performance"/);
  assert.match(component, /<RatingHistoryChart/);
  assert.match(component, /className="profile-history"/);
});

test("profile omits technical rating details and editable rating preferences", () => {
  assert.doesNotMatch(component, /RatingDetails/);
  assert.doesNotMatch(component, /rating-preferences/);
  assert.doesNotMatch(component, /savePreferences/);
  assert.doesNotMatch(component, /profile-header__rating/);
});
