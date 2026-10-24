import assert from "node:assert/strict";
import test from "node:test";
import { normalizeMobileApiOrigin, resolveMobileRequestUrl } from "./apiOrigin";

test("normalizes the configured mobile API origin", () => {
  assert.equal(normalizeMobileApiOrigin(" https://play.gostone.example/ ", true), "https://play.gostone.example");
  assert.equal(normalizeMobileApiOrigin(undefined, true), "https://gostone.app");
  assert.equal(normalizeMobileApiOrigin(undefined, false), "https://gostone.app");
});

test("rejects unsafe or non-origin native API configuration", () => {
  assert.throws(() => normalizeMobileApiOrigin("http://play.gostone.example", true), /HTTPS/);
  assert.throws(() => normalizeMobileApiOrigin("https://play.gostone.example/api", true), /only the GoStone origin/);
  assert.throws(() => normalizeMobileApiOrigin("https://user:secret@play.gostone.example", true), /only the GoStone origin/);
});

test("routes only API requests to the remote production origin", () => {
  const origin = "https://play.gostone.example";
  assert.equal(resolveMobileRequestUrl("/api/matchmaking", origin), `${origin}/api/matchmaking`);
  assert.equal(resolveMobileRequestUrl("/api/games/123?after=7", origin), `${origin}/api/games/123?after=7`);
  assert.equal(resolveMobileRequestUrl("/models/gostone-v8.onnx", origin), "/models/gostone-v8.onnx");
  assert.equal(resolveMobileRequestUrl("https://cdn.example/model.bin", origin), "https://cdn.example/model.bin");
});

test("absolute Request URLs from both native asset schemes reach the API", () => {
  const origin = "https://gostone.app";
  for (const app of ["https://localhost", "capacitor://localhost", "http://127.0.0.1:4173"]) {
    assert.equal(resolveMobileRequestUrl(`${app}/api/profile?fresh=1`, origin, `${app}/de/profile`), `${origin}/api/profile?fresh=1`);
    assert.equal(resolveMobileRequestUrl(`${app}/assets/icon.svg`, origin, app), `${app}/assets/icon.svg`);
  }
  assert.equal(resolveMobileRequestUrl("https://external.test/api/profile", origin, "capacitor://localhost"), "https://external.test/api/profile");
});
