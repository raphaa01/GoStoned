export type ThemePreference = "system" | "light" | "dark";

export const THEME_STORAGE_KEY = "gostone.theme.v1";

export function parseThemePreference(value: unknown): ThemePreference {
  return value === "light" || value === "dark" ? value : "system";
}

export function resolveTheme(preference: ThemePreference, systemDark: boolean): "light" | "dark" {
  return preference === "system" ? systemDark ? "dark" : "light" : preference;
}

// Apply the saved palette before the first paint, including full locale navigations.
export const THEME_BOOTSTRAP = `(() => {
  let preference = 'system';
  try { preference = localStorage.getItem('${THEME_STORAGE_KEY}'); } catch {}
  const theme = preference === 'light' || preference === 'dark'
    ? preference : matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
})();`;
