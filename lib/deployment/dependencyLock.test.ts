import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("Windows dependency updates retain pinned root optional packages for clean Linux installs", () => {
  const manifest = JSON.parse(readFileSync("package.json", "utf8")) as { optionalDependencies: Record<string, string> };
  const lock = JSON.parse(readFileSync("package-lock.json", "utf8")) as {
    packages: Record<string, { version?: string; optionalDependencies?: Record<string, string> }>;
  };
  assert.deepEqual(lock.packages[""].optionalDependencies, manifest.optionalDependencies);
  for (const [name, version] of Object.entries(manifest.optionalDependencies)) {
    assert.equal(lock.packages[`node_modules/${name}`]?.version, version, `${name} must remain locked for npm ci on Linux`);
  }
});
