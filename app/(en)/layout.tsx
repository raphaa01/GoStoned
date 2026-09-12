import type { Metadata } from "next";
import { WebAnalytics } from "@/components/analytics/WebAnalytics";
import { AuthProvider } from "@/components/auth/AuthProvider";
import { I18nProvider } from "@/components/i18n/I18nProvider";
import { getDictionary } from "@/lib/i18n/dictionary";
import { rootMetadata } from "@/lib/i18n/metadata";
import "../globals.css";
import "../redesign.css";

export const metadata: Metadata = rootMetadata("en");

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html data-scroll-behavior="smooth" lang="en">
      <body>
        <I18nProvider dictionary={getDictionary("en")} locale="en">
          <AuthProvider>{children}</AuthProvider>
        </I18nProvider>
        <WebAnalytics />
      </body>
    </html>
  );
}
