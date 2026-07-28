"use client";

import { usePathname } from "next/navigation";
import { useCallback, useState } from "react";
import type { Locale } from "@/lib/i18n/config";
import { buildLocaleSwitchHref } from "@/lib/i18n/routing";
import { useI18n } from "./I18nProvider";

export function useLocaleSwitch() {
  const pathname = usePathname();
  const { dictionary } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const switchLocale = useCallback(async (locale: Locale) => {
    setBusy(true);
    setError(null);
    const destination = buildLocaleSwitchHref(
      pathname,
      window.location.search,
      window.location.hash,
      locale,
    );
    try {
      const response = await fetch("/api/locale", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locale }),
      });
      if (!response.ok) throw new Error("Locale preference was not saved.");
      window.location.assign(destination);
    } catch {
      setBusy(false);
      setError(dictionary.language.switchFailed);
    }
  }, [dictionary.language.switchFailed, pathname]);

  return { busy, error, switchLocale };
}

export function LanguageSwitcher({ compact = false }: { compact?: boolean }) {
  const { dictionary, locale } = useI18n();
  const { busy, error, switchLocale } = useLocaleSwitch();
  return (
    <div
      aria-label={dictionary.language.switcherLabel}
      className={`language-switcher ${compact ? "language-switcher--compact" : ""}`}
      role="group"
    >
      {(["en", "de"] as const).map((option) => (
        <button
          aria-label={option === "en" ? dictionary.language.english : dictionary.language.german}
          aria-pressed={locale === option}
          disabled={busy || locale === option}
          key={option}
          lang={option}
          onClick={() => void switchLocale(option)}
          type="button"
        >
          {option.toUpperCase()}
        </button>
      ))}
      {error ? <span className="language-switch-error" role="alert">{error}</span> : null}
    </div>
  );
}

export function GermanLanguageHint() {
  const { dictionary } = useI18n();
  const { busy, error, switchLocale } = useLocaleSwitch();
  return (
    <div className="language-hint" role="status">
      <span>{dictionary.language.hint}</span>
      <button disabled={busy} lang="de" onClick={() => void switchLocale("de")} type="button">
        {dictionary.language.useGerman}
      </button>
      {error ? <span className="language-switch-error" role="alert">{error}</span> : null}
    </div>
  );
}
