import { mkdir, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import sharp from "sharp";

const root = process.cwd();

function splashSvg(width, height, dark) {
  const background = dark ? "#111310" : "#f5f2eb";
  const text = dark ? "#f3f2ec" : "#171816";
  const ring = dark ? "#ffffff" : "#171816";
  const radius = Math.max(28, Math.round(Math.min(width, height) * 0.075));
  const centerX = Math.round(width / 2);
  const centerY = Math.round(height / 2 - Math.min(width, height) * 0.025);
  const labelY = centerY + radius * 2.15;
  return `
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="stone" cx="35%" cy="28%" r="72%">
          <stop offset="0" stop-color="#3a3c39"/>
          <stop offset="0.36" stop-color="#171817"/>
          <stop offset="1" stop-color="#030403"/>
        </radialGradient>
        <filter id="shadow" x="-50%" y="-50%" width="200%" height="220%">
          <feDropShadow dx="0" dy="${Math.max(3, radius * 0.16)}" stdDeviation="${Math.max(4, radius * 0.19)}" flood-color="#000000" flood-opacity="${dark ? ".32" : ".18"}"/>
        </filter>
      </defs>
      <rect width="${width}" height="${height}" fill="${background}"/>
      <g fill="none" stroke="${ring}" stroke-opacity="${dark ? ".10" : ".09"}" stroke-width="${Math.max(1, radius * 0.025)}">
        <circle cx="${centerX}" cy="${centerY}" r="${radius * 1.55}"/>
        <circle cx="${centerX}" cy="${centerY}" r="${radius * 2.2}"/>
        <circle cx="${centerX}" cy="${centerY}" r="${radius * 2.85}"/>
      </g>
      <circle cx="${centerX}" cy="${centerY}" r="${radius}" fill="url(#stone)" stroke="#ffffff" stroke-opacity=".09" stroke-width="${Math.max(1, radius * 0.025)}" filter="url(#shadow)"/>
      <text x="${centerX}" y="${labelY}" fill="${text}" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="${Math.max(14, radius * 0.42)}" font-weight="650" letter-spacing="${radius * -0.015}">GoStone</text>
    </svg>`;
}

async function render(path, width, height, dark) {
  await mkdir(dirname(path), { recursive: true });
  await sharp(Buffer.from(splashSvg(width, height, dark))).png().toFile(path);
}

const androidRes = join(root, "android", "app", "src", "main", "res");
const androidDirectories = (await readdir(androidRes, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory() && /^drawable(?:-(?:land|port))?(?:-[^-]+dpi)?$/.test(entry.name));

for (const directory of androidDirectories) {
  const source = join(androidRes, directory.name, "splash.png");
  let metadata;
  try {
    metadata = await sharp(source).metadata();
  } catch {
    continue;
  }
  const width = metadata.width ?? 480;
  const height = metadata.height ?? 320;
  await render(source, width, height, false);
  const parts = directory.name.split("-");
  const nightName = [parts[0], ...parts.slice(1, -1), "night", ...(parts.length > 1 ? parts.slice(-1) : [])].join("-");
  await render(join(androidRes, nightName, "splash.png"), width, height, true);
}

const iosSplash = join(root, "ios", "App", "App", "Assets.xcassets", "Splash.imageset");
for (const name of ["splash-2732x2732-2.png", "splash-2732x2732-1.png", "splash-2732x2732.png"]) {
  await render(join(iosSplash, name), 2732, 2732, false);
  await render(join(iosSplash, name.replace("splash-", "splash-dark-")), 2732, 2732, true);
}

console.log("Generated light and dark GoStone launch assets for Android and iOS.");
