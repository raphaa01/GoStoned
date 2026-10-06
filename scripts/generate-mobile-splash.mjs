import { mkdir, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import sharp from "sharp";

const root = process.cwd();

function splashSvg(width, height, dark) {
  const background = dark ? "#111310" : "#f5f2eb";
  const text = dark ? "#f3f2ec" : "#171816";
  const logoSize = Math.max(72, Math.round(Math.min(width, height) * 0.2));
  const centerX = Math.round(width / 2);
  const centerY = Math.round(height / 2 - Math.min(width, height) * 0.025);
  const labelY = centerY + logoSize * 0.61;
  return `
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${width}" height="${height}" fill="${background}"/>
      <text x="${centerX}" y="${labelY}" fill="${text}" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="${Math.max(14, logoSize * 0.15)}" font-weight="650">GoStone</text>
    </svg>`;
}

async function render(path, width, height, dark) {
  await mkdir(dirname(path), { recursive: true });
  const logoSize = Math.max(72, Math.round(Math.min(width, height) * 0.2));
  const logo = await sharp(join(root, "public", "branding", `gostone-${dark ? "dark" : "light"}.svg`))
    .resize(logoSize, logoSize).png().toBuffer();
  await sharp(Buffer.from(splashSvg(width, height, dark))).composite([{
    input: logo,
    left: Math.round((width - logoSize) / 2),
    top: Math.round(height / 2 - Math.min(width, height) * 0.025 - logoSize / 2),
  }]).png().toFile(path);
}

if (!process.argv.includes("--ios")) {
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
}

const iosSplash = join(root, "ios", "App", "App", "Assets.xcassets", "Splash.imageset");
for (const name of ["splash-2732x2732-2.png", "splash-2732x2732-1.png", "splash-2732x2732.png"]) {
  await render(join(iosSplash, name), 2732, 2732, false);
  await render(join(iosSplash, name.replace("splash-", "splash-dark-")), 2732, 2732, true);
}

console.log(`Generated light and dark GoStone launch assets for ${process.argv.includes("--ios") ? "iOS" : "Android and iOS"}.`);
