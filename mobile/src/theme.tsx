import { Capacitor, SystemBars, SystemBarsStyle } from "@capacitor/core";
import { useEffect } from "react";
import { ThemeProvider, useTheme } from "@/components/settings/ThemeProvider";
import { resolveTheme } from "@/lib/theme";

function NativeThemeChrome() {
  const { preference } = useTheme();
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const resolved = resolveTheme(preference, media.matches);
      void SystemBars.setStyle({
        style: resolved === "dark" ? SystemBarsStyle.Dark : SystemBarsStyle.Light,
      }).catch(() => undefined);
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [preference]);
  return null;
}

export function MobileThemeProvider({ children }: { children: React.ReactNode }) {
  return <ThemeProvider attribute="data-mobile-theme" storageKey="gostone.mobile.theme.v1">
    <NativeThemeChrome />
    {children}
  </ThemeProvider>;
}
