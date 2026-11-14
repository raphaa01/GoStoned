import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { iosReleaseSigning } from "../lib/mobile/iosReleaseSigning";
import { GOSTONE_BOT_MODEL } from "../lib/bot/modelV1";
import { COACH_MODEL } from "../lib/learn/coachModel";
import { MOBILE_KATAGO } from "../lib/mobile/katagoContract";

const root = process.cwd();
const team = process.env.GOSTONE_APPLE_TEAM_ID?.trim();
const signing = iosReleaseSigning(team ?? "", process.env.GOSTONE_IOS_PROFILE_UUID?.trim() ?? "");
if (process.env.VITE_GOSTONE_API_URL && process.env.VITE_GOSTONE_API_URL !== "https://gostone.app") {
  throw new Error("Store releases must use https://gostone.app.");
}
const project = join(root, "ios/App/App.xcodeproj");
const settings = readFileSync(join(project, "project.pbxproj"), "utf8");
const version = settings.match(/MARKETING_VERSION = ([^;]+);/)?.[1];
const build = settings.match(/CURRENT_PROJECT_VERSION = ([^;]+);/)?.[1];
if (!version || !build) throw new Error("The iOS version or build number is unavailable.");
const directory = join(root, "artifacts/release", `${version}-${build}`, "ios");
const archive = join(directory, "GoStone.xcarchive");
const exportDirectory = join(directory, "export");
const environment = { ...process.env, VITE_GOSTONE_API_URL: "https://gostone.app" };

function run(command: string, args: string[], capture = false): string {
  const result = spawnSync(command, args, { cwd: root, env: environment, encoding: capture ? "utf8" : undefined,
    stdio: capture ? "pipe" : "inherit", maxBuffer: 100 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed with exit ${result.status}.`);
  return capture ? `${result.stdout ?? ""}${result.stderr ?? ""}` : "";
}

run("npm", ["run", "mobile:katago:ios"]);
run("npm", ["run", "mobile:sync"]);
mkdirSync(directory, { recursive: true });
run("xcodebuild", [
  "-project", project, "-scheme", "App", "-configuration", "Release",
  "-destination", "generic/platform=iOS", "-archivePath", archive,
  ...signing.archiveSettings, "archive",
]);

const app = join(archive, "Products/Applications/App.app");
const executable = join(app, "App");
const profile = join(app, "embedded.mobileprovision");
const publicDirectory = join(app, "public");
const capacitorConfig = join(app, "capacitor.config.json");
const symbols = join(archive, "dSYMs/App.app.dSYM");
for (const required of [executable, profile, capacitorConfig, symbols]) {
  if (!existsSync(required)) throw new Error(`The signed archive is incomplete: ${required}.`);
}
run("codesign", ["--verify", "--deep", "--strict", app]);
const signedTeam = run("codesign", ["-dv", "--verbose=4", app], true);
if (!signedTeam.includes(`TeamIdentifier=${team}`)) throw new Error("The archive uses an unexpected signing team.");
const architectures = run("lipo", ["-archs", executable], true).trim();
if (architectures !== "arm64") throw new Error(`The device archive has unexpected architectures: ${architectures}`);
if (!readFileSync(executable).includes(Buffer.from(`KataGo ${MOBILE_KATAGO.engineVersion}`))) {
  throw new Error("The archived app does not contain the linked KataGo device core.");
}
const config = JSON.parse(readFileSync(capacitorConfig, "utf8")) as { packageClassList?: string[] };
if (!config.packageClassList?.includes("GoStoneKataGoPlugin")) {
  throw new Error("The archived Capacitor configuration does not register GoStoneKataGoPlugin.");
}
const assetHashes = {
  [MOBILE_KATAGO.modelFile]: MOBILE_KATAGO.modelSha256,
  ...Object.fromEntries(Object.entries(COACH_MODEL.files).map(([file, hash]) => [`coach/${file}`, hash])),
};
for (const [path, hash] of Object.entries(assetHashes)) {
  const actual = createHash("sha256").update(readFileSync(join(publicDirectory, path))).digest("hex");
  if (actual !== hash) throw new Error(`Archived asset failed SHA-256 verification: ${path}.`);
}
const bundledFiles = {
  "katago/analysis-mobile.cfg": "mobile/katago/analysis-mobile.cfg",
  [`${GOSTONE_BOT_MODEL.runtimeBaseUrl.slice(1)}ort-wasm-simd-threaded.wasm`]:
    "node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm",
};
for (const [path, source] of Object.entries(bundledFiles)) {
  if (!readFileSync(join(publicDirectory, path)).equals(readFileSync(join(root, source)))) {
    throw new Error(`Archived asset does not match the build input: ${path}.`);
  }
}
const profilePlist = join(directory, "provisioning-verification.plist");
run("security", ["cms", "-D", "-i", profile, "-o", profilePlist]);
const profileTeam = run("plutil", ["-extract", "TeamIdentifier.0", "raw", "-o", "-", profilePlist], true).trim();
const getTaskAllow = run("plutil", ["-extract", "Entitlements.get-task-allow", "raw", "-o", "-", profilePlist], true).trim();
const applicationId = run("plutil", ["-extract", "Entitlements.application-identifier", "raw", "-o", "-", profilePlist], true).trim();
if (profileTeam !== team || getTaskAllow !== "false" || applicationId !== `${team}.app.gostone`) {
  throw new Error("The embedded provisioning profile is not a production profile for this team.");
}
const exportOptions = join(directory, "ExportOptions.plist");
writeFileSync(exportOptions, signing.exportOptions);
run("xcodebuild", ["-exportArchive", "-archivePath", archive, "-exportPath", exportDirectory,
  "-exportOptionsPlist", exportOptions]);
const exportedIpa = readdirSync(exportDirectory).find((name) => name.endsWith(".ipa"));
if (!exportedIpa) throw new Error("Xcode did not export an App Store IPA.");
const ipa = join(exportDirectory, "GoStone.ipa");
if (exportedIpa !== "GoStone.ipa") renameSync(join(exportDirectory, exportedIpa), ipa);
const ipaHash = createHash("sha256").update(readFileSync(ipa)).digest("hex");
writeFileSync(join(directory, "SHA256SUMS.txt"), `${ipaHash}  export/GoStone.ipa\n`);
console.log(`Signed archive: ${archive}`);
console.log(`Exported IPA: ${ipa}`);
console.log(`IPA SHA-256: ${ipaHash}`);
