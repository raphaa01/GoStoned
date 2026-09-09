import { spawnSync } from "node:child_process";

function runNpmScript(script: string): void {
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const result = spawnSync(npm, ["run", script], {
    stdio: "inherit",
    env: process.env,
  });

  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

if (process.env.VERCEL_ENV === "production") {
  runNpmScript("check:production-schema");
} else {
  console.log("Skipping production schema check outside a production deployment.");
}

runNpmScript("build");
