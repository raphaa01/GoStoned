import { Capacitor, SystemBars, SystemBarsStyle } from "@capacitor/core";
import { useEffect } from "react";
import { ThemeProvider, useTheme } from "@/components/settings/ThemeProvider";
import { resolveTheme } from "@/lib/theme";
import { updateNativeChrome } from "./nativeChrome";

function NativeThemeChrome() {
  const { preference } = useTheme();
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const resolved = resolveTheme(preference, media.matches);
      document.documentElement.style.backgroundColor = resolved === "dark" ? "#111310" : "#f5f2eb";
      updateNativeChrome({ type: "theme", dark: resolved === "dark" });
      document.querySelector('meta[name="theme-color"]')?.setAttribute("content", resolved === "dark" ? "#111310" : "#f5f2eb");
      if (Capacitor.isNativePlatform()) void SystemBars.setStyle({
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
