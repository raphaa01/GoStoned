import type { Metadata } from "next";
import { WebAnalytics } from "@/components/analytics/WebAnalytics";
import { ThemeProvider } from "@/components/settings/ThemeProvider";
import { THEME_BOOTSTRAP } from "@/lib/theme";
import { AuthProvider } from "@/components/auth/AuthProvider";
import { BoardPlacementProvider } from "@/components/game/BoardPlacementProvider";
import { BoardDesignProvider } from "@/components/game/BoardDesignProvider";
import { I18nProvider } from "@/components/i18n/I18nProvider";
import { getDictionary } from "@/lib/i18n/dictionary";
import { rootMetadata } from "@/lib/i18n/metadata";
import "../globals.css";
import "../redesign.css";
import "../settings.css";
import "../board-designs.css";

export const metadata: Metadata = rootMetadata("en");

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html suppressHydrationWarning data-scroll-behavior="smooth" lang="en">
      <head><script id="gostone-theme">{THEME_BOOTSTRAP}</script></head>
      <body>
        <I18nProvider dictionary={getDictionary("en")} locale="en">
          <ThemeProvider><AuthProvider><BoardDesignProvider><BoardPlacementProvider>{children}</BoardPlacementProvider></BoardDesignProvider></AuthProvider></ThemeProvider>
        </I18nProvider>
        {process.env.VERCEL === "1" ? <WebAnalytics /> : null}
      </body>
    </html>
  );
}
