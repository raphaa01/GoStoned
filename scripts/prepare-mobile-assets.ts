import { createHash } from "node:crypto";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { GOSTONE_BOT_MODEL } from "@/lib/bot/modelV1";
import { MOBILE_KATAGO } from "@/lib/mobile/katagoContract";

const repository = join(dirname(fileURLToPath(import.meta.url)), "..");
const output = join(repository, ".mobile-assets");
const cache = join(repository, ".mobile-cache", "katago", "b10c384h6nbttflrs.bin.gz");
const withKataGo = process.argv.includes("--with-katago");

async function sha256(path: string) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

async function verifiedCopy(source: string, destination: string, expected: string) {
  const actual = await sha256(source);
  if (actual !== expected) throw new Error(`Asset hash mismatch for ${source}: ${actual}`);
  await mkdir(dirname(destination), { recursive: true });
  await cp(source, destination);
}

async function downloadKataGoModel() {
  await mkdir(dirname(cache), { recursive: true });
  try {
    if (await sha256(cache) === MOBILE_KATAGO.modelSha256) return;
  } catch {
    // Missing cache is downloaded below.
  }
  const response = await fetch(
    "https://github.com/lightvector/KataGo/releases/download/v1.17.0/b10c384h6nbttflrs.bin.gz",
  );
  if (!response.ok) throw new Error(`KataGo model download failed with HTTP ${response.status}.`);
  await writeFile(cache, new Uint8Array(await response.arrayBuffer()));
  if (await sha256(cache) !== MOBILE_KATAGO.modelSha256) {
    await rm(cache, { force: true });
    throw new Error("Downloaded KataGo model failed SHA-256 verification.");
  }
}

async function main() {
  await rm(output, { force: true, recursive: true });
  await mkdir(output, { recursive: true });
  await verifiedCopy(
    join(repository, "public", GOSTONE_BOT_MODEL.artifactUrl),
    join(output, GOSTONE_BOT_MODEL.artifactUrl),
    GOSTONE_BOT_MODEL.artifactSha256,
  );
  await cp(
    join(repository, "public", "bot-runtime"),
    join(output, "bot-runtime"),
    { recursive: true },
  );
  await cp(join(repository, "public", "images"), join(output, "images"), { recursive: true });
  await cp(join(repository, "public", "branding"), join(output, "branding"), { recursive: true });
  await cp(join(repository, "app", "icon.svg"), join(output, "icon.svg"));

  if (withKataGo) {
    await downloadKataGoModel();
    await verifiedCopy(cache, join(output, MOBILE_KATAGO.modelFile), MOBILE_KATAGO.modelSha256);
    await cp(
      join(repository, "mobile", "katago", "analysis-mobile.cfg"),
      join(output, "katago", "analysis-mobile.cfg"),
    );
  }

  await writeFile(join(output, "mobile-assets.json"), JSON.stringify({
    contractVersion: "gostone-mobile-assets-v1",
    bot: GOSTONE_BOT_MODEL,
    katago: withKataGo ? MOBILE_KATAGO : null,
  }, null, 2));
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
