"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useSyncExternalStore } from "react";
import { parseThemePreference, resolveTheme, THEME_STORAGE_KEY, type ThemePreference } from "@/lib/theme";

type ThemeContextValue = {
  preference: ThemePreference;
  setPreference: (preference: ThemePreference) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);
const CHANGE_EVENT = "gostone:theme";
const memoryPreferences = new Map<string, ThemePreference>();
const serverPreference = () => "light" as const;

function subscribe(listener: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key) memoryPreferences.delete(event.key);
    else memoryPreferences.clear();
    listener();
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(CHANGE_EVENT, listener);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(CHANGE_EVENT, listener);
  };
}

export function ThemeProvider({
  children,
  storageKey = THEME_STORAGE_KEY,
  attribute = "data-theme",
}: {
  children: React.ReactNode;
  storageKey?: string;
  attribute?: "data-theme" | "data-mobile-theme";
}) {
  const snapshot = useCallback(() => {
    const memory = memoryPreferences.get(storageKey);
    if (memory) return memory;
    try {
      return parseThemePreference(window.localStorage.getItem(storageKey));
    } catch {
      return memoryPreferences.get(storageKey) ?? "light";
    }
  }, [storageKey]);
  const preference = useSyncExternalStore(subscribe, snapshot, serverPreference);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const resolved = resolveTheme(preference, media.matches);
      document.documentElement.setAttribute(attribute, resolved);
      document.documentElement.style.colorScheme = resolved;
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [attribute, preference]);

  const setPreference = useCallback((next: ThemePreference) => {
    memoryPreferences.set(storageKey, next);
    try {
      window.localStorage.setItem(storageKey, next);
    } catch {
      // The selected theme still works when browser storage is unavailable.
    }
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }, [storageKey]);
  const value = useMemo(() => ({ preference, setPreference }), [preference, setPreference]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used inside ThemeProvider.");
  return context;
}
