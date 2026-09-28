import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { cpus, homedir, platform } from "node:os";
import { basename, delimiter, join } from "node:path";

const KATAGO_VERSION = "v1.18.2";
const KATAGO_COMMIT = "fd0723fdbc0e9d82cf269c9630af8c27c57c07c4";
const EIGEN_VERSION = "3.4.0";
const EIGEN_COMMIT = "3147391d946bb4b6c68edd901f2add6ac1f31f8c";
const NDK_VERSION = "27.2.12479018";
const CMAKE_VERSION = "3.22.1";
const ABIS = process.argv.includes("--arm64-only")
  ? ["arm64-v8a"]
  : ["arm64-v8a", "x86_64"];

const repository = process.cwd();
const cache = join(repository, ".mobile-cache");
const kataGoSource = join(cache, `KataGo-${KATAGO_VERSION.slice(1)}`);
const eigenSource = join(cache, `eigen-${EIGEN_VERSION}`);

function firstExisting(candidates: Array<string | undefined>): string | undefined {
  return candidates.find((candidate): candidate is string => Boolean(candidate && existsSync(candidate)));
}

function run(command: string, args: string[], cwd = repository, environment = process.env): void {
  const result = spawnSync(command, args, { cwd, env: environment, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${basename(command)} exited with ${result.status ?? "no status"}.`);
}

function output(command: string, args: string[], cwd = repository): string {
  const result = spawnSync(command, args, { cwd, encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr || `${basename(command)} failed.`);
  return result.stdout.trim();
}

function ensureCheckout(path: string, repositoryUrl: string, tag: string, commit: string): void {
  if (!existsSync(join(path, ".git"))) {
    mkdirSync(cache, { recursive: true });
    run("git", ["clone", "--depth", "1", "--branch", tag, repositoryUrl, path]);
  }
  const actual = output("git", ["rev-parse", "HEAD"], path);
  if (actual !== commit) {
    throw new Error(`Pinned source mismatch in ${path}: expected ${commit}, found ${actual}.`);
  }
}

function windowsJdk(): string | undefined {
  const microsoft = "C:\\Program Files\\Microsoft";
  if (!existsSync(microsoft)) return undefined;
  return readdirSync(microsoft)
    .filter((name) => name.startsWith("jdk-21"))
    .sort()
    .reverse()
    .map((name) => join(microsoft, name))
    .find((path) => existsSync(path));
}

const androidHome = firstExisting([
  process.env.ANDROID_HOME,
  process.env.ANDROID_SDK_ROOT,
  platform() === "win32" && process.env.LOCALAPPDATA
    ? join(process.env.LOCALAPPDATA, "Android", "Sdk")
    : undefined,
  platform() === "darwin" ? join(homedir(), "Library", "Android", "sdk") : undefined,
  platform() === "linux" ? join(homedir(), "Android", "Sdk") : undefined,
]);
const javaHome = firstExisting([
  process.env.JAVA_HOME,
  platform() === "win32" ? windowsJdk() : undefined,
  platform() === "win32" ? "C:\\Program Files\\Android\\Android Studio\\jbr" : undefined,
]);

if (!androidHome) throw new Error("Android SDK not found.");
if (!javaHome) throw new Error("JDK 21 not found.");

const ndk = join(androidHome, "ndk", NDK_VERSION);
const cmakeRoot = join(androidHome, "cmake", CMAKE_VERSION);
const executableSuffix = platform() === "win32" ? ".exe" : "";
const cmake = join(cmakeRoot, "bin", `cmake${executableSuffix}`);
const ninja = join(cmakeRoot, "bin", `ninja${executableSuffix}`);
const strip = join(
  ndk,
  "toolchains",
  "llvm",
  "prebuilt",
  platform() === "win32" ? "windows-x86_64" : platform() === "darwin" ? "darwin-x86_64" : "linux-x86_64",
  "bin",
  `llvm-strip${executableSuffix}`,
);

for (const required of [cmake, ninja, strip, join(ndk, "build", "cmake", "android.toolchain.cmake")]) {
  if (!existsSync(required)) throw new Error(`Required Android native tool is missing: ${required}`);
}

ensureCheckout(kataGoSource, "https://github.com/lightvector/KataGo.git", KATAGO_VERSION, KATAGO_COMMIT);
ensureCheckout(eigenSource, "https://gitlab.com/libeigen/eigen.git", EIGEN_VERSION, EIGEN_COMMIT);

const environment = {
  ...process.env,
  ANDROID_HOME: androidHome,
  ANDROID_SDK_ROOT: androidHome,
  JAVA_HOME: javaHome,
  PATH: [join(javaHome, "bin"), join(androidHome, "platform-tools"), process.env.PATH ?? ""].join(delimiter),
};

for (const abi of ABIS) {
  const build = join(cache, "katago-android", abi);
  const destinationDirectory = join(
    repository,
    "native",
    "gostone-katago",
    "android",
    "src",
    "main",
    "jniLibs",
    abi,
  );
  mkdirSync(build, { recursive: true });
  mkdirSync(destinationDirectory, { recursive: true });

  run(cmake, [
    "-S", join(kataGoSource, "cpp"),
    "-B", build,
    "-G", "Ninja",
    `-DCMAKE_TOOLCHAIN_FILE=${join(ndk, "build", "cmake", "android.toolchain.cmake")}`,
    `-DCMAKE_MAKE_PROGRAM=${ninja}`,
    `-DANDROID_ABI=${abi}`,
    "-DANDROID_PLATFORM=android-26",
    "-DUSE_BACKEND=EIGEN",
    `-DEIGEN3_INCLUDE_DIRS=${eigenSource}`,
    "-DNO_GIT_REVISION=1",
    "-DBUILD_DISTRIBUTED=0",
    "-DCMAKE_BUILD_TYPE=Release",
    "-DCMAKE_CXX_FLAGS=-DLITTLE_ENDIAN=1234 -DBIG_ENDIAN=4321 -DBYTE_ORDER=1234",
    "-DCMAKE_EXE_LINKER_FLAGS=-Wl,--gc-sections",
  ], repository, environment);
  run(cmake, [
    "--build", build,
    "--target", "katago",
    "-j", String(Math.max(2, Math.min(8, cpus().length))),
  ], repository, environment);

  const destination = join(destinationDirectory, "libgostone_katago_exec.so");
  copyFileSync(join(build, "katago"), destination);
  run(strip, [destination], repository, environment);
  console.log(`Built KataGo ${KATAGO_VERSION} for ${abi}: ${destination}`);
}
