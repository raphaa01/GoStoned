import { Capacitor, SystemBars, SystemBarsStyle } from "@capacitor/core";
import { createContext, useContext, useEffect, useMemo, useState } from "react";

export type MobileThemePreference = "system" | "light" | "dark";

type MobileThemeContextValue = {
  preference: MobileThemePreference;
  setPreference: (preference: MobileThemePreference) => void;
};

const STORAGE_KEY = "gostone.mobile.theme.v1";
const MobileThemeContext = createContext<MobileThemeContextValue | null>(null);

function storedPreference(): MobileThemePreference {
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return stored === "light" || stored === "dark" ? stored : "system";
}

export function MobileThemeProvider({ children }: { children: React.ReactNode }) {
  const [preference, setPreferenceState] = useState<MobileThemePreference>(storedPreference);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const resolved = preference === "system"
        ? media.matches ? "dark" : "light"
        : preference;
      document.documentElement.dataset.mobileTheme = resolved;
      document.documentElement.style.colorScheme = resolved;
      if (Capacitor.isNativePlatform()) {
        void SystemBars.setStyle({
          style: resolved === "dark" ? SystemBarsStyle.Dark : SystemBarsStyle.Light,
        }).catch(() => undefined);
      }
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [preference]);

  const setPreference = (next: MobileThemePreference) => {
    setPreferenceState(next);
    if (next === "system") window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, next);
  };
  const value = useMemo(() => ({ preference, setPreference }), [preference]);
  return <MobileThemeContext.Provider value={value}>{children}</MobileThemeContext.Provider>;
}

export function useMobileTheme() {
  const context = useContext(MobileThemeContext);
  if (!context) throw new Error("useMobileTheme must be used inside MobileThemeProvider.");
  return context;
}
