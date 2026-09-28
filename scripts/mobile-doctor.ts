import { existsSync } from "node:fs";
import { platform } from "node:os";
import { join } from "node:path";

const root = process.cwd();
const checks = [
  ["Capacitor config", existsSync(join(root, "capacitor.config.ts"))],
  ["Bundled mobile entry", existsSync(join(root, "mobile", "index.html"))],
  ["GoStone v8 model", existsSync(join(root, "public", "bot-models", "gostone-japanese-v8.onnx"))],
  ["Cached KataGo model", existsSync(join(root, ".mobile-cache", "katago", "b10c384h6nbttflrs.bin.gz"))],
] as const;

for (const [name, ready] of checks) console.log(`${ready ? "OK" : "MISSING"}  ${name}`);
if (platform() !== "darwin") {
  console.log("HOST     iOS compile/simulator unavailable: Xcode requires macOS.");
  console.log("HOST     Web bundle and Android project can still be built on this machine.");
} else {
  console.log("HOST     macOS detected; run npm run mobile:sync and build the iOS scheme in Xcode.");
}

if (checks.some(([, ready]) => !ready)) process.exitCode = 1;
