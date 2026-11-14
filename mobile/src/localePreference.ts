import { isLocale, type Locale } from "@/lib/i18n/config";
import { localizeHref } from "@/lib/i18n/routing";

const STORAGE_KEY = "gostone-mobile-locale";
let localePreference: Locale | undefined;

export function getMobileLocalePreference(): Locale | undefined {
  if (localePreference) return localePreference;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (isLocale(stored)) localePreference = stored;
  } catch {
    // The current app session can still use the preference in memory.
  }
  return localePreference;
}

export function restoreMobileLocale(): void {
  const locale = getMobileLocalePreference();
  if (!locale) return;
  const current = window.location.pathname + window.location.search + window.location.hash;
  const destination = localizeHref(current, locale);
  if (destination !== current) window.history.replaceState(window.history.state, "", destination);
}

export function setMobileLocale(locale: Locale): void {
  localePreference = locale;
  try {
    window.localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    // The preference still applies until the app closes.
  }
  restoreMobileLocale();
  window.dispatchEvent(new Event("gostone:navigation"));
}
