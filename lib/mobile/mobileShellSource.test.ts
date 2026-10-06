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
  assert.match(app, /case "\/profile":[\s\S]*?<MobileProfile/);
  assert.match(app, /case "\/review":[\s\S]*?<ReviewGuide/);
  assert.match(app, /case "\/puzzles":[\s\S]*?<PuzzleWorkspace/);
});

test("web and native review distinguish a service failure from an empty history", () => {
  const review = source("components", "review", "ReviewGuide.tsx");

  assert.match(review, /localizedApiError/);
  assert.match(review, /role="alert"/);
  assert.match(review, /setRetryRevision/);
  assert.doesNotMatch(review, /\.catch\(\(\) => undefined\)/);
});

test("mobile chrome is inset-safe, responsive, and delegates iOS glass to UIKit", () => {
  const css = source("mobile", "src", "mobile.css");
  const sceneDelegate = source("ios", "App", "App", "SceneDelegate.swift");

  assert.match(css, /\.mobile-tab-bar\s*\{[\s\S]*?position:\s*fixed/);
  assert.match(css, /env\(safe-area-inset-bottom/);
  assert.match(css, /@media\s*\(min-width:\s*760px\)/);
  assert.match(css, /@media\s*\(max-width:\s*370px\)/);
  assert.match(css, /data-native-tab-bar="true"[\s\S]*?display:\s*none/);
  assert.doesNotMatch(css, /backdrop-filter/);
  assert.match(sceneDelegate, /UITabBar\(\)/);
  assert.match(sceneDelegate, /nativeTabBar\.isTranslucent = true/);
  assert.match(sceneDelegate, /GoStoneBridgeViewController\(\)/);
  assert.doesNotMatch(sceneDelegate, /UIGlassEffect|UIBlurEffect/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
});

test("mobile theme and splash expose the required native states", () => {
  const theme = source("mobile", "src", "theme.tsx");
  const splash = source("mobile", "src", "MobileSplash.tsx");
  const main = source("mobile", "src", "main.tsx");
  const themeContract = source("lib", "theme.ts");

  assert.match(themeContract, /"system" \| "light" \| "dark"/);
  assert.match(theme, /<ThemeProvider attribute="data-mobile-theme" storageKey="gostone.mobile.theme.v1"/);
  assert.match(theme, /prefers-color-scheme:\s*dark/);
  assert.match(theme, /SystemBars\.setStyle/);
  assert.match(splash, /mobile-splash__mark/);
  assert.match(splash, /2_400/);
  assert.match(main, /Capacitor\.getPlatform\(\)/);
});

test("approved light and dark branding is included in both native and web surfaces", () => {
  const assets = source("scripts", "prepare-mobile-assets.ts");
  const mark = source("components", "layout", "BrandMark.tsx");
  const splash = source("mobile", "src", "MobileSplash.tsx");
  const launch = source("scripts", "generate-mobile-splash.mjs");
  const icons = JSON.parse(source("ios", "App", "App", "Assets.xcassets", "AppIcon.appiconset", "Contents.json"));

  assert.match(assets, /cp\(join\(repository, "public", "branding"\), join\(output, "branding"\), \{ recursive: true \}\)/);
  assert.match(splash, /<BrandMark/);
  assert.match(launch, /join\(root, "public", "branding"/);
  assert.match(launch, /\.composite\(/);
  for (const appearance of ["light", "dark"]) {
    assert.ok(mark.includes(`/branding/gostone-${appearance}.svg`));
    assert.match(source("public", "branding", `gostone-${appearance}.svg`), /<svg/);
  }
  assert.equal(icons.images.length, 2);
  const dark = icons.images.find((icon: { appearances?: { value: string }[] }) =>
    icon.appearances?.some((appearance) => appearance.value === "dark"));
  assert.equal(dark?.filename, "AppIcon-dark.png");
  assert.ok(icons.images.some((icon: { filename: string; appearances?: unknown[] }) =>
    icon.filename === "AppIcon-512@2x.png" && !icon.appearances));
});
