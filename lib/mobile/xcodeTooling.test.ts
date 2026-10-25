import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { join } from "node:path";
import test from "node:test";

const require = createRequire(import.meta.url);
type ParsedProject = { project: { objects: Record<string, unknown> } };

test("the patched Capacitor Xcode parser preserves native targets and build settings", () => {
  const xcode = require("xcode") as { project(path: string): {
    parseSync(): void;
    writeSync(): string;
    generateUuid(): string;
    hash: ParsedProject;
  } };
  const parser = require("xcode/lib/parser/pbxproj") as { parse(source: string): ParsedProject };
  const project = xcode.project(join(process.cwd(), "ios/App/App.xcodeproj/project.pbxproj"));
  project.parseSync();
  const roundTrip = parser.parse(project.writeSync());
  for (const section of ["PBXNativeTarget", "XCBuildConfiguration", "XCConfigurationList"]) {
    assert.deepEqual(roundTrip.project.objects[section], project.hash.project.objects[section]);
  }
  assert.match(project.generateUuid(), /^[A-F0-9]{24}$/);
});
