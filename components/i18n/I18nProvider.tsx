"use client";

import { createContext, useContext, useMemo } from "react";
import type { Locale } from "@/lib/i18n/config";
import type { Dictionary } from "@/lib/i18n/dictionary";
import { localizeHref } from "@/lib/i18n/routing";

type I18nContextValue = {
  locale: Locale;
  dictionary: Dictionary;
  href: (path: string) => string;
  changeLocale?: (locale: Locale) => void;
};

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({
  children,
  dictionary,
  locale,
  changeLocale,
}: {
  children: React.ReactNode;
  dictionary: Dictionary;
  locale: Locale;
  changeLocale?: (locale: Locale) => void;
}) {
  const value = useMemo<I18nContextValue>(
    () => ({ locale, dictionary, changeLocale, href: (path) => localizeHref(path, locale) }),
    [changeLocale, dictionary, locale],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) throw new Error("useI18n must be used inside I18nProvider.");
  return context;
}
