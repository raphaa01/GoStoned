import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  DEFAULT_PROFILE_AVATAR_STYLE,
  isProfileAvatarStyle,
  parseProfileAvatarUpdate,
} from "./profileAvatar";
import { serializeAuthUser } from "./auth/types";

test("the original Kifu Mark remains the default profile symbol", () => {
  assert.equal(DEFAULT_PROFILE_AVATAR_STYLE, "kifu-classic");
  assert.equal(isProfileAvatarStyle("kifu-classic"), true);
  assert.equal(isProfileAvatarStyle("urushi-mon"), true);
  assert.equal(isProfileAvatarStyle("cyber-green"), false);
});

test("profile symbol updates accept only one known style", () => {
  assert.deepEqual(parseProfileAvatarUpdate({ avatarStyle: "urushi-mon" }), {
    avatarStyle: "urushi-mon",
  });
  assert.throws(() => parseProfileAvatarUpdate({ avatarStyle: "unknown" }));
  assert.throws(() => parseProfileAvatarUpdate({ avatarStyle: "kifu-classic", extra: true }));
  assert.throws(() => parseProfileAvatarUpdate({}));
});

test("auth serialization preserves valid selections and safely defaults legacy rows", () => {
  const row = { id: "user-id", username: "sente", display_name: "Sente" };
  assert.equal(serializeAuthUser(row).avatarStyle, "kifu-classic");
  assert.equal(serializeAuthUser({ ...row, avatar_style: "urushi-mon" }).avatarStyle, "urushi-mon");
  assert.equal(serializeAuthUser({ ...row, avatar_style: "invalid" }).avatarStyle, "kifu-classic");
});

test("Kifu stones use exact grid intersections in the production SVG", async () => {
  const source = await readFile(
    new URL("../components/profile/ProfileAvatar.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /cx="25" cy="25"/);
  assert.match(source, /cx="75" cy="50"/);
  assert.match(source, /cx="50" cy="75"/);
  assert.match(source, /cx="50" cy="50"/);
  assert.match(source, /M25 0V100M50 0V100M75 0V100M0 25H100M0 50H100M0 75H100/);
});
