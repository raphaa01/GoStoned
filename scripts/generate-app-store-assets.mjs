import sharp from "sharp";
import { readFile, mkdir, access } from "node:fs/promises";
import { resolve, join } from "node:path";

// Compose actual native captures without repainting or distorting app UI.
// Capture names: raw/{iphone,ipad}-{en,de}-{play,learn,puzzles,dark}.png
const directory = resolve(process.argv[2] ?? "artifacts/release/1.0-2/store-assets");
await mkdir(directory, { recursive: true });
const escape = (value) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;");
const copy = {
  en: {
    header: ["Your next good move", "starts here."],
    tagline: "PLAY. LEARN. DISCOVER GO.",
    play: ["Small board.", "Big possibilities.", "AI, friends and online opponents · 9×9 to 19×19"],
    learn: ["Learn Go.", "One move at a time.", "Interactive lessons. A path you can follow."],
    puzzles: ["Find the move", "that changes everything.", "Daily challenges and practice at your level."],
    dark: ["Your board.", "Your kind of calm.", "Light and dark. Make GoStone yours."],
  },
  de: {
    header: ["Dein nächster guter Zug", "beginnt hier."],
    tagline: "SPIELEN. LERNEN. GO ENTDECKEN.",
    play: ["Kleines Brett.", "Große Möglichkeiten.", "KI, Freunde und Online-Gegner · 9×9 bis 19×19"],
    learn: ["Lerne Go.", "Zug für Zug.", "Interaktive Lektionen. Dein Weg durchs Spiel."],
    puzzles: ["Finde den Zug,", "der alles verändert.", "Tägliche Aufgaben und Übungen auf deinem Niveau."],
    dark: ["Dein Brett.", "Dein Ruhepol.", "Hell oder dunkel. Mach GoStone zu deinem Spiel."],
  },
};
const svg = (width, height, content) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${content}</svg>`);
const text = (x, y, size, color, value, weight = 600) => `<text x="${x}" y="${y}" fill="${color}" font-family="Helvetica Neue,Arial,sans-serif" font-size="${size}" font-weight="${weight}">${escape(value)}</text>`;
const rendered = [];
for (const [locale, language] of Object.entries(copy)) {
  for (const dark of [false, true]) {
    const bg = dark ? "#111310" : "#e6e1d6";
    const fg = dark ? "#f3eee3" : "#252820";
    const tone = dark ? "dark" : "light";
    const logo = await sharp(await readFile(`app/icons/gostone-sculpted-${tone}.svg`)).resize(1520, 1520).png().toBuffer();
    const backdrop = svg(3840, 1646,
      `<rect width="3840" height="1646" fill="${bg}"/>` +
      `<path d="M2270 0V1646M2500 0V1646M2730 0V1646M2960 0V1646M3190 0V1646M3420 0V1646M3650 0V1646M2160 250H3840M2160 480H3840M2160 710H3840M2160 940H3840M2160 1170H3840M2160 1400H3840" stroke="${fg}" stroke-opacity=".08" stroke-width="3"/>` +
      text(180, 285, 66, fg, "GoStone") +
      text(180, 485, 38, "#9b6555", language.tagline) +
      text(180, 785, locale === "de" ? 126 : 144, fg, language.header[0]) +
      text(180, 970, 144, fg, language.header[1]) +
      `<rect x="180" y="1115" width="132" height="8" rx="4" fill="#b36e56"/>`);
    const name = `header-${locale}-${tone}.png`;
    await sharp(backdrop).composite([{ input: logo, left: 2180, top: 70 }]).flatten({ background: bg }).png().toFile(join(directory, name));
  }
  for (const device of ["iphone", "ipad"]) {
    for (const scene of ["play", "learn", "puzzles", "dark"]) {
      const source = join(directory, "raw", `${device}-${locale}-${scene}.png`);
      try { await access(source); } catch { continue; }
      const { width: sw, height: sh } = await sharp(source).metadata();
      const width = device === "iphone" ? 1206 : 2064;
      const height = device === "iphone" ? 2622 : 2752;
      const dark = scene === "dark";
      const bg = dark ? "#111310" : "#e6e1d6";
      const fg = dark ? "#f3eee3" : "#252820";
      const scale = width / 1206;
      const [line1, line2, subtitle] = language[scene];
      const top = Math.round(435 * scale);
      const margin = Math.round(70 * scale);
      const fit = Math.min((width - margin * 2) / sw, (height - top - margin) / sh);
      const cw = Math.round(sw * fit), ch = Math.round(sh * fit);
      const left = Math.round((width - cw) / 2);
      const font = (scene === "puzzles" && locale === "en" ? 69 : 83) * scale;
      const backdrop = svg(width, height,
        `<rect width="${width}" height="${height}" fill="${bg}"/>` +
        text(margin, 72 * scale, 27 * scale, "#9b6555", "GoStone") +
        text(margin, 193 * scale, font, fg, line1) +
        text(margin, 285 * scale, font, fg, line2) +
        text(margin, 365 * scale, 31 * scale, fg, subtitle, 400) +
        `<rect x="${left - 9}" y="${top - 9}" width="${cw + 18}" height="${ch + 18}" rx="${46 * scale}" fill="#242722"/>`);
      const capture = await sharp(source).resize(cw, ch).png().toBuffer();
      const name = `${device}-${locale}-${scene}.png`;
      await sharp(backdrop).composite([{ input: capture, left, top }]).flatten({ background: bg }).png().toFile(join(directory, name));
      rendered.push(name);
    }
  }
}
for (const locale of ["de", "en"]) {
  const names = rendered.filter((name) => name.startsWith(`iphone-${locale}-`));
  if (!names.length) continue;
  const tiles = await Promise.all(names.map(async (name, index) => ({ input: await sharp(join(directory, name)).resize(302, 656).png().toBuffer(), left: index * 318, top: 0 })));
  await sharp({ create: { width: names.length * 318 - 16, height: 656, channels: 3, background: "#d3cfc5" } }).composite(tiles).png().toFile(join(directory, `preview-${locale}.png`));
}
console.log(`Generated headers and ${rendered.length} screenshots in ${directory}`);
