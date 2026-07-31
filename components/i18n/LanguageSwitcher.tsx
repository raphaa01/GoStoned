"use client";

import { Check, ChevronDown, Globe2 } from "lucide-react";
import { usePathname } from "next/navigation";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { LOCALES, localeDetails, type Locale } from "@/lib/i18n/config";
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

export function LanguageSwitcher() {
  const { dictionary, locale } = useI18n();
  const { busy, error, switchLocale } = useLocaleSwitch();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const menuId = useId();
  const activeIndex = LOCALES.findIndex(({ code }) => code === locale);
  const currentLocale = localeDetails(locale);

  useEffect(() => {
    if (!open) return;
    itemRefs.current[activeIndex]?.focus();

    function closeOnOutsidePointer(event: PointerEvent) {
      if (event.target instanceof Node && !containerRef.current?.contains(event.target)) {
        setOpen(false);
      }
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    }

    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [activeIndex, open]);

  function moveFocus(currentIndex: number, direction: 1 | -1) {
    const nextIndex = (currentIndex + direction + LOCALES.length) % LOCALES.length;
    itemRefs.current[nextIndex]?.focus();
  }

  return (
    <div className="language-menu" ref={containerRef}>
      <button
        aria-controls={menuId}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`${dictionary.language.switcherLabel}: ${currentLocale.nativeName}`}
        className="language-menu-trigger"
        disabled={busy}
        onClick={() => setOpen((current) => !current)}
        ref={triggerRef}
        type="button"
      >
        <Globe2 aria-hidden="true" size={17} strokeWidth={1.8} />
        <span>{currentLocale.nativeName}</span>
        <ChevronDown aria-hidden="true" className="language-menu-chevron" size={14} />
      </button>

      {open ? (
        <div
          aria-label={dictionary.language.switcherLabel}
          className="language-menu-popover"
          id={menuId}
          role="menu"
        >
          <p className="language-menu-heading">{dictionary.language.switcherLabel}</p>
          <div className="language-menu-options">
            {LOCALES.map((option, index) => (
              <button
                aria-checked={locale === option.code}
                className="language-menu-option"
                disabled={busy}
                key={option.code}
                lang={option.code}
                onClick={() => {
                  if (locale === option.code) {
                    setOpen(false);
                    triggerRef.current?.focus();
                    return;
                  }
                  void switchLocale(option.code);
                }}
                onKeyDown={(event) => {
                  if (event.key === "ArrowDown") {
                    event.preventDefault();
                    moveFocus(index, 1);
                  } else if (event.key === "ArrowUp") {
                    event.preventDefault();
                    moveFocus(index, -1);
                  } else if (event.key === "Home") {
                    event.preventDefault();
                    itemRefs.current[0]?.focus();
                  } else if (event.key === "End") {
                    event.preventDefault();
                    itemRefs.current[LOCALES.length - 1]?.focus();
                  }
                }}
                ref={(element) => { itemRefs.current[index] = element; }}
                role="menuitemradio"
                type="button"
              >
                <span>{option.nativeName}</span>
                {locale === option.code ? <Check aria-hidden="true" size={16} /> : null}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {error ? <span className="language-switch-error" role="alert">{error}</span> : null}
    </div>
  );
}
