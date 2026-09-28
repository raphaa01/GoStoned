import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

function source(...parts: string[]) {
  return readFileSync(join(process.cwd(), ...parts), "utf8");
}

test("the native bundle uses its app shell instead of the website chrome", () => {
  const app = source("mobile", "src", "MobileApp.tsx");
  const shell = source("mobile", "src", "MobileShell.tsx");

  assert.doesNotMatch(app, /AppShell|Navbar|Footer|Hero/);
  for (const route of ["/", "/puzzles", "/learn", "/review", "/leaderboard"]) {
    assert.match(shell, new RegExp(`route: \"${route.replaceAll("/", "\\/")}\"`));
  }
  assert.match(shell, /showPlayAction/);
  assert.match(shell, /mobile-play-dock/);
});

test("mobile chrome is fixed, inset-safe, responsive, and only glassy on iOS", () => {
  const css = source("mobile", "src", "mobile.css");

  assert.match(css, /\.mobile-tab-bar\s*\{[\s\S]*?position:\s*fixed/);
  assert.match(css, /env\(safe-area-inset-bottom/);
  assert.match(css, /@media\s*\(min-width:\s*760px\)/);
  assert.match(css, /@media\s*\(max-width:\s*370px\)/);
  assert.match(css, /data-mobile-platform="ios"[\s\S]*?backdrop-filter/);
  assert.doesNotMatch(css, /data-mobile-platform="android"[\s\S]*?backdrop-filter/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
});

test("mobile theme and splash expose the required native states", () => {
  const theme = source("mobile", "src", "theme.tsx");
  const splash = source("mobile", "src", "MobileSplash.tsx");
  const main = source("mobile", "src", "main.tsx");

  assert.match(theme, /"system" \| "light" \| "dark"/);
  assert.match(theme, /prefers-color-scheme:\s*dark/);
  assert.match(theme, /SystemBars\.setStyle/);
  assert.match(splash, /mobile-splash__mark/);
  assert.match(splash, /2_400/);
  assert.match(main, /Capacitor\.getPlatform\(\)/);
});
