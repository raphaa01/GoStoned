import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { MOBILE_KATAGO } from "./katagoContract";

function source(...parts: string[]) {
  return readFileSync(join(process.cwd(), ...parts), "utf8");
}

test("iOS and Android plugins pin the shared KataGo model identity", () => {
  const ios = source(
    "native", "gostone-katago", "ios", "Sources", "GoStoneKataGoPlugin", "GoStoneKataGoPlugin.swift",
  );
  const android = source(
    "native", "gostone-katago", "android", "src", "main", "java", "com", "gostone", "katago",
    "GoStoneKataGoPlugin.java",
  );
  for (const nativeSource of [ios, android]) {
    assert.match(nativeSource, new RegExp(MOBILE_KATAGO.engineVersion.replaceAll(".", "\\.")));
    assert.match(nativeSource, new RegExp(MOBILE_KATAGO.modelSha256));
  }
  assert.match(ios, /forResource: "b10c384h6nbttflrs"/);
  assert.match(ios, /withExtension: "katago"/);
  assert.match(android, /b10c384h6nbttflrs\.katago/);
});

test("Android preserves signed model payloads without recompression", () => {
  const gradle = source("android", "app", "build.gradle");
  assert.match(gradle, /noCompress 'katago', 'onnx', 'wasm'/);
});

test("Android runs the pinned local engine while iOS remains an explicit separate gate", () => {
  const android = source(
    "native", "gostone-katago", "android", "src", "main", "java", "com", "gostone", "katago",
    "GoStoneKataGoPlugin.java",
  );
  const ios = source(
    "native", "gostone-katago", "ios", "Sources", "GoStoneKataGoPlugin", "GoStoneKataGoPlugin.swift",
  );
  const build = source("scripts", "build-katago-android.ts");

  assert.match(android, /new ProcessBuilder\(/);
  assert.match(android, /MAX_VISITS = 80/);
  assert.match(android, /THERMAL_STATUS_SEVERE/);
  assert.match(android, /notifyListeners\("progress"/);
  assert.match(build, /USE_BACKEND=EIGEN/);
  assert.match(build, /arm64-v8a/);
  assert.match(build, /x86_64/);
  assert.match(build, /fd0723fdbc0e9d82cf269c9630af8c27c57c07c4/);
  assert.match(ios, /available: false/);
  assert.match(ios, /KataGo Metal core has not been linked/);
});
