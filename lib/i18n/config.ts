export const LOCALES = [
  { code: "en", nativeName: "English", openGraphLocale: "en_US" },
  { code: "de", nativeName: "Deutsch", openGraphLocale: "de_DE" },
  { code: "fr", nativeName: "Français", openGraphLocale: "fr_FR" },
  { code: "es", nativeName: "Español", openGraphLocale: "es_ES" },
  { code: "zh", nativeName: "简体中文", openGraphLocale: "zh_CN" },
  { code: "ja", nativeName: "日本語", openGraphLocale: "ja_JP" },
  { code: "ko", nativeName: "한국어", openGraphLocale: "ko_KR" },
] as const;

export type Locale = (typeof LOCALES)[number]["code"];
export type LocalizedText = Record<Locale, string>;

export const SUPPORTED_LOCALES = LOCALES.map(({ code }) => code) as Locale[];
export const DEFAULT_LOCALE: Locale = "en";
export const LOCALE_COOKIE = "gostone_locale";
export const LOCALE_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && SUPPORTED_LOCALES.includes(value as Locale);
}

export function isPrefixedLocale(value: unknown): value is Exclude<Locale, "en"> {
  return isLocale(value) && value !== DEFAULT_LOCALE;
}

export function localeDetails(locale: Locale) {
  return LOCALES.find(({ code }) => code === locale) ?? LOCALES[0];
}

export function preferredLocale(acceptLanguage: string | null): Locale {
  if (!acceptLanguage) return DEFAULT_LOCALE;

  const preferences = acceptLanguage
    .split(",")
    .map((entry, index) => {
      const [range, ...parameters] = entry.trim().split(";");
      const qualityParameter = parameters.find((parameter) => parameter.trim().startsWith("q="));
      const parsedQuality = qualityParameter
        ? Number.parseFloat(qualityParameter.trim().slice(2))
        : 1;
      return {
        index,
        language: range.trim().toLowerCase().split("-")[0],
        quality: Number.isFinite(parsedQuality)
          ? Math.min(1, Math.max(0, parsedQuality))
          : 0,
      };
    })
    .filter(({ quality }) => quality > 0)
    .sort((left, right) => right.quality - left.quality || left.index - right.index);

  for (const preference of preferences) {
    if (isLocale(preference.language)) return preference.language;
  }
  return DEFAULT_LOCALE;
}
