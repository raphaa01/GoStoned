import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const team = process.env.GOSTONE_APPLE_TEAM_ID?.trim();
if (!team || !/^[A-Z0-9]{10}$/.test(team)) throw new Error("A valid GOSTONE_APPLE_TEAM_ID is required for App Store signing.");
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
  "-allowProvisioningUpdates", `DEVELOPMENT_TEAM=${team}`,
  "CODE_SIGN_IDENTITY=Apple Distribution", "archive",
]);

const app = join(archive, "Products/Applications/App.app");
const executable = join(app, "App");
const profile = join(app, "embedded.mobileprovision");
const model = join(app, "public/katago/b10c384h6nbttflrs.katago");
const symbols = join(archive, "dSYMs/App.app.dSYM");
for (const required of [executable, profile, model, symbols]) {
  if (!existsSync(required)) throw new Error(`The signed archive is incomplete: ${required}.`);
}
run("codesign", ["--verify", "--deep", "--strict", app]);
const signedTeam = run("codesign", ["-dv", "--verbose=4", app], true);
if (!signedTeam.includes(`TeamIdentifier=${team}`)) throw new Error("The archive uses an unexpected signing team.");
const architectures = run("lipo", ["-archs", executable], true).trim();
if (architectures !== "arm64") throw new Error(`The device archive has unexpected architectures: ${architectures}`);
if (!readFileSync(executable).includes(Buffer.from("KataGo v1.18.2"))) {
  throw new Error("The archived app does not contain the linked KataGo device core.");
}
const hash = createHash("sha256").update(readFileSync(model)).digest("hex");
if (hash !== "0ba27eced5180b3e3d0b898b280c541112989765e789d1eb6cd0d31b2b2c1229") {
  throw new Error("The archived model failed SHA-256 verification.");
}
const profilePlist = join(directory, "provisioning-verification.plist");
run("security", ["cms", "-D", "-i", profile, "-o", profilePlist]);
const profileTeam = run("plutil", ["-extract", "TeamIdentifier.0", "raw", "-o", "-", profilePlist], true).trim();
const getTaskAllow = run("plutil", ["-extract", "Entitlements.get-task-allow", "raw", "-o", "-", profilePlist], true).trim();
if (profileTeam !== team || getTaskAllow !== "false") {
  throw new Error("The embedded provisioning profile is not a production profile for this team.");
}
const exportOptions = join(directory, "ExportOptions.plist");
writeFileSync(exportOptions, `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict><key>method</key><string>app-store-connect</string><key>destination</key><string>export</string><key>signingStyle</key><string>automatic</string><key>teamID</key><string>${team}</string></dict></plist>\n`);
run("xcodebuild", ["-exportArchive", "-archivePath", archive, "-exportPath", exportDirectory,
  "-exportOptionsPlist", exportOptions, "-allowProvisioningUpdates"]);
const exportedIpa = readdirSync(exportDirectory).find((name) => name.endsWith(".ipa"));
if (!exportedIpa) throw new Error("Xcode did not export an App Store IPA.");
const ipa = join(exportDirectory, "GoStone.ipa");
if (exportedIpa !== "GoStone.ipa") renameSync(join(exportDirectory, exportedIpa), ipa);
const ipaHash = createHash("sha256").update(readFileSync(ipa)).digest("hex");
writeFileSync(join(directory, "SHA256SUMS.txt"), `${ipaHash}  export/GoStone.ipa\n`);
console.log(`Signed archive: ${archive}`);
console.log(`Exported IPA: ${ipa}`);
console.log(`IPA SHA-256: ${ipaHash}`);
