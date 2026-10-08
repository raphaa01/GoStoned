import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, delimiter, join, resolve, sep } from "node:path";

const root = process.cwd();
const signing = [
  "GOSTONE_ANDROID_KEYSTORE_FILE",
  "GOSTONE_ANDROID_KEYSTORE_PASSWORD",
  "GOSTONE_ANDROID_KEY_ALIAS",
  "GOSTONE_ANDROID_KEY_PASSWORD",
] as const;
const missing = signing.filter((name) => !process.env[name]);
if (missing.length) throw new Error(`Android release signing is unavailable: ${missing.join(", ")}.`);
if (!existsSync(process.env.GOSTONE_ANDROID_KEYSTORE_FILE!)) {
  throw new Error("The configured Android release keystore does not exist.");
}
if (process.env.VITE_GOSTONE_API_URL && process.env.VITE_GOSTONE_API_URL !== "https://gostone.app") {
  throw new Error("Store releases must use https://gostone.app.");
}

const windows = process.platform === "win32";
const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || (windows
  ? join(process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local"), "Android", "Sdk")
  : process.platform === "darwin" ? join(homedir(), "Library", "Android", "sdk") : join(homedir(), "Android", "Sdk"));
let detectedJavaHome: string | undefined;
if (process.platform === "darwin") {
  try {
    detectedJavaHome = execFileSync("/usr/libexec/java_home", ["-v", "21"], {
      encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch { /* JAVA_HOME can still provide a supported JDK. */ }
}
if (windows) {
  const microsoft = "C:\\Program Files\\Microsoft";
  if (existsSync(microsoft)) detectedJavaHome = readdirSync(microsoft).filter(name => name.startsWith("jdk-21"))
    .sort().reverse().map(name => join(microsoft, name)).find(path => existsSync(path));
  detectedJavaHome ||= "C:\\Program Files\\Android\\Android Studio\\jbr";
}
const javaHome = process.env.JAVA_HOME || detectedJavaHome;
if (!existsSync(sdk) || !javaHome || !existsSync(javaHome)) {
  throw new Error("Android SDK or JDK 21 is unavailable.");
}
const environment = {
  ...process.env,
  ANDROID_HOME: sdk,
  ANDROID_SDK_ROOT: sdk,
  JAVA_HOME: javaHome,
  PATH: [join(javaHome, "bin"), process.env.PATH || ""].join(delimiter),
  VITE_GOSTONE_API_URL: "https://gostone.app",
};

function run(command: string, args: string[], cwd = root, capture = false): string {
  const result = spawnSync(command, args, { cwd, env: environment, encoding: capture ? "utf8" : undefined,
    stdio: capture ? "pipe" : "inherit", maxBuffer: 100 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed with exit ${result.status}.`);
  return capture ? String(result.stdout) : "";
}

// The release contains the physical-device ABI only. The debug script continues
// to prepare both arm64-v8a and x86_64 for emulator tests.
const npmCli = process.env.npm_execpath;
if (windows && !npmCli) throw new Error("npm CLI path is unavailable. Run this script through npm.");
const npmCommand = windows ? process.execPath : "npm";
const npmPrefix = windows ? [npmCli!] : [];
run(npmCommand, [...npmPrefix, "run", "mobile:katago:android", "--", "--arm64-only"]);
run(npmCommand, [...npmPrefix, "run", "mobile:sync"]);
if (windows) run("cmd.exe", ["/d", "/s", "/c", "gradlew.bat bundleRelease"], join(root, "android"));
else run("./gradlew", ["bundleRelease"], join(root, "android"));

const gradle = readFileSync(join(root, "android/app/build.gradle"), "utf8");
const version = gradle.match(/versionName\s+"([^"]+)"/)?.[1];
const code = gradle.match(/versionCode\s+(\d+)/)?.[1];
if (!version || !code) throw new Error("Android release version is unavailable.");
const destination = join(root, "artifacts/release", `${version}-${code}`, "android");
mkdirSync(destination, { recursive: true });
const bundle = join(root, "android/app/build/outputs/bundle/release/app-release.aab");
const releaseBundle = join(destination, `GoStone-${version}-${code}.aab`);
if (!existsSync(bundle)) throw new Error("Gradle did not produce a release AAB.");
copyFileSync(bundle, releaseBundle);
const jar = join(javaHome, "bin", windows ? "jar.exe" : "jar");
const contents = run(jar, ["tf", releaseBundle], root, true).replaceAll("\r\n", "\n");
if (!/META-INF\/[^\n]+\.SF\n/i.test(contents) || !/META-INF\/[^\n]+\.(RSA|DSA|EC)\n/i.test(contents)) {
  throw new Error("The AAB has no JAR signing certificate and signature metadata.");
}
run(join(javaHome, "bin", windows ? "jarsigner.exe" : "jarsigner"), ["-verify", releaseBundle], root, true);
const model = "base/assets/public/katago/b10c384h6nbttflrs.katago";
if (!contents.includes(`${model}\n`)) throw new Error("The AAB does not contain the KataGo model.");
if (!contents.includes("base/lib/arm64-v8a/libgostone_katago_exec.so")) {
  throw new Error("The AAB does not contain the arm64 KataGo runtime.");
}
if (contents.includes("base/lib/x86_64/")) throw new Error("The release AAB unexpectedly contains x86_64.");
const verificationDirectory = mkdtempSync(join(tmpdir(), "gostone-aab-"));
let modelHash: string;
try {
  run(jar, ["xf", releaseBundle, model], verificationDirectory);
  modelHash = createHash("sha256").update(readFileSync(join(verificationDirectory, model))).digest("hex");
} finally {
  const target = resolve(verificationDirectory);
  if (!target.startsWith(resolve(tmpdir()) + sep) || !basename(target).startsWith("gostone-aab-")) {
    throw new Error("Unexpected AAB verification directory.");
  }
  rmSync(target, { recursive: true });
}
if (modelHash !== "0ba27eced5180b3e3d0b898b280c541112989765e789d1eb6cd0d31b2b2c1229") {
  throw new Error("The model hash inside the AAB does not match the pinned contract.");
}
const symbols = join(root, ".mobile-cache/katago-android/symbols/arm64-v8a/libgostone_katago_exec.so");
if (existsSync(symbols)) {
  const symbolsDirectory = join(root, ".mobile-cache/katago-android/symbols");
  run(jar, ["cfM", join(destination, "GoStone-native-debug-symbols.zip"), "arm64-v8a"], symbolsDirectory);
}
const hash = createHash("sha256").update(readFileSync(releaseBundle)).digest("hex");
writeFileSync(join(destination, "SHA256SUMS.txt"), `${hash}  ${basename(releaseBundle)}\n`);
console.log(`Signed AAB: ${releaseBundle}`);
console.log(`SHA-256: ${hash}`);
