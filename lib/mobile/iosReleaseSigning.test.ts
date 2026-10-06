import assert from "node:assert/strict";
import test from "node:test";
import { iosReleaseSigning } from "./iosReleaseSigning";

const team = "ABCDEFGHIJ";
const profile = "12345678-1234-1234-1234-123456789abc";

test("App Store archives and exports consistently use manual distribution signing", () => {
  const signing = iosReleaseSigning(team, profile);
  assert.deepEqual(signing.archiveSettings, [
    `DEVELOPMENT_TEAM=${team}`,
    "CODE_SIGN_STYLE=Manual",
    "CODE_SIGN_IDENTITY=Apple Distribution",
    `PROVISIONING_PROFILE_SPECIFIER=${profile}`,
  ]);
  assert.match(signing.exportOptions, /<key>method<\/key><string>app-store-connect<\/string>/);
  assert.match(signing.exportOptions, /<key>signingStyle<\/key><string>manual<\/string>/);
  assert.ok(signing.exportOptions.includes(`<key>app.gostone</key><string>${profile}</string>`));
  assert.ok(signing.exportOptions.includes(`<key>teamID</key><string>${team}</string>`));
});

test("signing rejects missing or malformed team and profile values before building", () => {
  for (const invalid of ["", "ABCDE", "ABCDEFGHIJ<string>", "abcdefghij"]) {
    assert.throws(() => iosReleaseSigning(invalid, profile), /GOSTONE_APPLE_TEAM_ID/);
  }
  for (const invalid of ["", "Development profile", "<string>", "12345678-1234-1234-1234-123456789abz"]) {
    assert.throws(() => iosReleaseSigning(team, invalid), /GOSTONE_IOS_PROFILE_UUID/);
  }
});
