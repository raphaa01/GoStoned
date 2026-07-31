import type { Metadata } from "next";
import { AuthProvider } from "@/components/auth/AuthProvider";
import { I18nProvider } from "@/components/i18n/I18nProvider";
import { LOCALES } from "@/lib/i18n/config";
import { getDictionary } from "@/lib/i18n/dictionary";
import { rootMetadata } from "@/lib/i18n/metadata";
import { prefixedLocaleOrNotFound } from "@/lib/i18n/serverLocale";
import "../globals.css";
import "../redesign.css";

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
    <html data-scroll-behavior="smooth" lang={locale}>
      <body>
        <I18nProvider dictionary={getDictionary(locale)} locale={locale}>
          <AuthProvider>{children}</AuthProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
