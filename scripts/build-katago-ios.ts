import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { cpus, platform } from "node:os";
import { basename, join } from "node:path";

const KATAGO_VERSION = "v1.18.2";
const KATAGO_COMMIT = "fd0723fdbc0e9d82cf269c9630af8c27c57c07c4";
const IOS_DEPLOYMENT_TARGET = "16.0";
const repository = process.cwd();
const cache = join(repository, ".mobile-cache");
const source = join(cache, `KataGo-${KATAGO_VERSION.slice(1)}-ios`);
const patch = join(repository, "native", "gostone-katago", "ios", "katago-ios.patch");
const bridge = join(repository, "native", "gostone-katago", "ios", "Core", "GoStoneKataGoCore.cpp");
const headers = join(repository, "native", "gostone-katago", "ios", "Core", "include");
const framework = join(
  repository,
  "native",
  "gostone-katago",
  "ios",
  "Frameworks",
  "GoStoneKataGoCore.xcframework",
);

function run(command: string, args: string[], cwd = repository): void {
  const result = spawnSync(command, args, { cwd, env: process.env, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${basename(command)} exited with ${result.status ?? "no status"}.`);
}

function output(command: string, args: string[], cwd = repository): string {
  const result = spawnSync(command, args, { cwd, env: process.env, encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr || `${basename(command)} failed.`);
  return result.stdout.trim();
}

function firstExecutable(name: string): string {
  const candidates = [
    process.env[name.toUpperCase()],
    join(cache, "ios-build-tools", "bin", name),
    join("/opt/homebrew/bin", name),
    join("/usr/local/bin", name),
  ];
  const found = candidates.find((candidate): candidate is string => Boolean(candidate && existsSync(candidate)));
  if (!found) throw new Error(`${name} is required. Install it with \`brew install ${name}\`.`);
  return found;
}

function patchSource(): void {
  const reverseCheck = spawnSync("git", ["apply", "--unidiff-zero", "--reverse", "--check", patch], { cwd: source });
  if (reverseCheck.status === 0) return;
  run("git", ["apply", "--unidiff-zero", "--check", patch], source);
  run("git", ["apply", "--unidiff-zero", patch], source);
}

type Slice = Readonly<{
  name: "device" | "simulator";
  sdk: "iphoneos" | "iphonesimulator";
  swiftTarget: string;
  minimumFlag: string;
}>;

if (platform() !== "darwin") throw new Error("The KataGo iOS core can only be built on macOS.");
const xcodeVersion = output("xcodebuild", ["-version"]);
const majorVersion = Number.parseInt(xcodeVersion.match(/Xcode (\d+)/)?.[1] ?? "0", 10);
if (majorVersion < 26) throw new Error(`Xcode 26 or newer is required; found ${xcodeVersion.split("\n")[0]}.`);

const cmake = firstExecutable("cmake");
const ninja = firstExecutable("ninja");
mkdirSync(cache, { recursive: true });
if (!existsSync(join(source, ".git"))) {
  run("git", ["clone", "--depth", "1", "--branch", KATAGO_VERSION, "https://github.com/lightvector/KataGo.git", source]);
}
const actualCommit = output("git", ["rev-parse", "HEAD"], source);
if (actualCommit !== KATAGO_COMMIT) {
  throw new Error(`Pinned KataGo source mismatch: expected ${KATAGO_COMMIT}, found ${actualCommit}.`);
}
patchSource();

const slices: Slice[] = [
  {
    name: "device",
    sdk: "iphoneos",
    swiftTarget: `arm64-apple-ios${IOS_DEPLOYMENT_TARGET}`,
    minimumFlag: `-miphoneos-version-min=${IOS_DEPLOYMENT_TARGET}`,
  },
  {
    name: "simulator",
    sdk: "iphonesimulator",
    swiftTarget: `arm64-apple-ios${IOS_DEPLOYMENT_TARGET}-simulator`,
    minimumFlag: `-mios-simulator-version-min=${IOS_DEPLOYMENT_TARGET}`,
  },
];

const libraries: string[] = [];
for (const slice of slices) {
  const build = join(cache, "katago-ios", slice.name);
  const sdkPath = output("xcrun", ["--sdk", slice.sdk, "--show-sdk-path"]);
  mkdirSync(build, { recursive: true });
  run(cmake, [
    "-S", join(source, "cpp"),
    "-B", build,
    "-G", "Ninja",
    `-DCMAKE_MAKE_PROGRAM=${ninja}`,
    "-DUSE_BACKEND=METAL",
    "-DBUILD_DISTRIBUTED=0",
    "-DNO_GIT_REVISION=1",
    "-DCMAKE_SYSTEM_NAME=iOS",
    `-DCMAKE_OSX_SYSROOT=${slice.sdk}`,
    "-DCMAKE_OSX_ARCHITECTURES=arm64",
    `-DCMAKE_OSX_DEPLOYMENT_TARGET=${IOS_DEPLOYMENT_TARGET}`,
    `-DCMAKE_Swift_FLAGS=-target ${slice.swiftTarget}`,
    "-DCMAKE_BUILD_TYPE=Release",
  ]);
  run(cmake, [
    "--build", build,
    "--target", "katago",
    "-j", String(Math.max(2, Math.min(8, cpus().length))),
  ]);

  const bridgeObject = join(build, "GoStoneKataGoCore.o");
  run("xcrun", [
    "--sdk", slice.sdk,
    "clang++",
    "-std=c++17",
    "-O3",
    "-fvisibility=hidden",
    "-arch", "arm64",
    "-isysroot", sdkPath,
    slice.minimumFlag,
    "-I", headers,
    "-I", join(source, "cpp"),
    "-c", bridge,
    "-o", bridgeObject,
  ]);
  const combined = join(build, "libGoStoneKataGoCore.a");
  rmSync(combined, { force: true });
  run("xcrun", [
    "libtool", "-static", "-o", combined,
    join(build, "libkatago.a"),
    join(build, "libKataGoSwift.a"),
    bridgeObject,
  ]);
  libraries.push(combined);
}

rmSync(framework, { recursive: true, force: true });
mkdirSync(join(framework, ".."), { recursive: true });
run("xcodebuild", [
  "-create-xcframework",
  "-library", libraries[0], "-headers", headers,
  "-library", libraries[1], "-headers", headers,
  "-output", framework,
]);
console.log(`Built KataGo ${KATAGO_VERSION} Metal core: ${framework}`);
