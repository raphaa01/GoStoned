"use client";

import Link from "next/link";
import { useI18n } from "@/components/i18n/I18nProvider";
import { getPrivacyCopy } from "@/lib/i18n/privacy";

export function AppFooter() {
  const { dictionary, href, locale } = useI18n();
  const privacy = getPrivacyCopy(locale);
  return (
    <footer className="app-footer">
      <span>© {new Date().getFullYear()} GoStone</span>
      <nav aria-label={dictionary.nav.legalNavigation}>
        <Link href={href("/impressum")}>{dictionary.nav.legal}</Link>
        <Link href={href("/privacy")}>{privacy.navLabel}</Link>
      </nav>
    </footer>
  );
}
