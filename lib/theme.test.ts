import assert from "node:assert/strict";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { parseThemePreference, resolveTheme, THEME_BOOTSTRAP } from "./theme";

test("explicit themes override system changes; invalid preferences follow the system", () => {
  for (const systemDark of [false, true]) {
    assert.equal(resolveTheme("light", systemDark), "light");
    assert.equal(resolveTheme("dark", systemDark), "dark");
    assert.equal(resolveTheme("system", systemDark), systemDark ? "dark" : "light");
  }
  for (const value of [null, undefined, "unknown", {}, "system"]) {
    assert.equal(parseThemePreference(value), "system");
  }
  assert.equal(parseThemePreference("dark"), "dark");
  assert.equal(parseThemePreference("light"), "light");
});

test("the initial document palette respects saved preferences and blocked storage", () => {
  for (const [stored, systemDark, expected] of [
    ["light", true, "light"], ["dark", false, "dark"],
    [null, true, "dark"], ["invalid", false, "light"],
    ["blocked", true, "dark"],
  ] as const) {
    const document = { documentElement: { dataset: { theme: "" }, style: { colorScheme: "" } } };
    runInNewContext(THEME_BOOTSTRAP, {
      document,
      localStorage: { getItem: () => {
        if (stored === "blocked") throw new Error("Storage disabled");
        return stored;
      } },
      matchMedia: () => ({ matches: systemDark }),
    });
    assert.equal(document.documentElement.dataset.theme, expected);
    assert.equal(document.documentElement.style.colorScheme, expected);
  }
});
