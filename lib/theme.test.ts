import assert from "node:assert/strict";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { parseThemePreference, resolveTheme, THEME_BOOTSTRAP } from "./theme";

test("only an explicit system preference follows the device; new users default to light", () => {
  for (const systemDark of [false, true]) {
    assert.equal(resolveTheme("light", systemDark), "light");
    assert.equal(resolveTheme("dark", systemDark), "dark");
    assert.equal(resolveTheme("system", systemDark), systemDark ? "dark" : "light");
  }
  for (const value of [null, undefined, "unknown", {}]) {
    assert.equal(parseThemePreference(value), "light");
  }
  assert.equal(parseThemePreference("system"), "system");
  assert.equal(parseThemePreference("dark"), "dark");
  assert.equal(parseThemePreference("light"), "light");
});

test("the initial document palette respects saved preferences and blocked storage", () => {
  for (const [stored, systemDark, expected] of [
    ["light", true, "light"], ["dark", false, "dark"],
    [null, true, "light"], ["invalid", true, "light"],
    ["blocked", true, "light"], ["system", true, "dark"], ["system", false, "light"],
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
