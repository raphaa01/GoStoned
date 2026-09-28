import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { homedir, platform } from "node:os";
import { delimiter, join } from "node:path";

const repository = process.cwd();

function firstExisting(candidates: Array<string | undefined>): string | undefined {
  return candidates.find((candidate): candidate is string => Boolean(candidate && existsSync(candidate)));
}

function windowsJdk(): string | undefined {
  const microsoft = "C:\\Program Files\\Microsoft";
  if (!existsSync(microsoft)) return undefined;
  const releases = readdirSync(microsoft)
    .filter((name) => name.startsWith("jdk-21"))
    .sort()
    .reverse()
    .map((name) => join(microsoft, name));
  return firstExisting(releases);
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

if (!androidHome) throw new Error("Android SDK not found. Run npm run mobile:doctor for setup guidance.");
if (!javaHome) throw new Error("JDK 21 not found. Run npm run mobile:doctor for setup guidance.");

const environment = {
  ...process.env,
  ANDROID_HOME: androidHome,
  ANDROID_SDK_ROOT: androidHome,
  JAVA_HOME: javaHome,
  PATH: [
    join(javaHome, "bin"),
    join(androidHome, "platform-tools"),
    process.env.PATH ?? "",
  ].join(delimiter),
};

function run(command: string, args: string[], cwd = repository): void {
  const result = spawnSync(command, args, { cwd, env: environment, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

if (platform() === "win32") {
  const npmCli = process.env.npm_execpath;
  if (!npmCli) throw new Error("npm CLI path is unavailable.");
  run(process.execPath, [npmCli, "run", "mobile:katago:android"]);
  run(process.execPath, [npmCli, "run", "mobile:sync"]);
  run("cmd.exe", ["/d", "/s", "/c", "gradlew.bat assembleDebug"], join(repository, "android"));
} else {
  run("npm", ["run", "mobile:katago:android"]);
  run("npm", ["run", "mobile:sync"]);
  run("./gradlew", ["assembleDebug"], join(repository, "android"));
}
