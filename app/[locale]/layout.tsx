import type { Metadata } from "next";
import { WebAnalytics } from "@/components/analytics/WebAnalytics";
import { ThemeProvider } from "@/components/settings/ThemeProvider";
import { THEME_BOOTSTRAP } from "@/lib/theme";
import { AuthProvider } from "@/components/auth/AuthProvider";
import { BoardPlacementProvider } from "@/components/game/BoardPlacementProvider";
import { BoardDesignProvider } from "@/components/game/BoardDesignProvider";
import { I18nProvider } from "@/components/i18n/I18nProvider";
import { LOCALES } from "@/lib/i18n/config";
import { getDictionary } from "@/lib/i18n/dictionary";
import { rootMetadata } from "@/lib/i18n/metadata";
import { prefixedLocaleOrNotFound } from "@/lib/i18n/serverLocale";
import "../globals.css";
import "../redesign.css";
import "../settings.css";
import "../board-designs.css";

export function generateStaticParams() {
  return LOCALES.filter(({ code }) => code !== "en").map(({ code }) => ({ locale: code }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale: value } = await params;
  return rootMetadata(prefixedLocaleOrNotFound(value));
}

export default async function LocalizedRootLayout({
  children,
  params,
}: Readonly<{
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}>) {
  const { locale: value } = await params;
  const locale = prefixedLocaleOrNotFound(value);
  return (
    <html suppressHydrationWarning data-scroll-behavior="smooth" lang={locale}>
      <head><script id="gostone-theme">{THEME_BOOTSTRAP}</script></head>
      <body>
        <I18nProvider dictionary={getDictionary(locale)} locale={locale}>
          <ThemeProvider><AuthProvider><BoardDesignProvider><BoardPlacementProvider>{children}</BoardPlacementProvider></BoardDesignProvider></AuthProvider></ThemeProvider>
        </I18nProvider>
        {process.env.VERCEL === "1" ? <WebAnalytics /> : null}
      </body>
    </html>
  );
}
