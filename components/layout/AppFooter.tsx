"use client";

import Link from "next/link";
import { useI18n } from "@/components/i18n/I18nProvider";

export function AppFooter() {
  const { dictionary, href } = useI18n();
  return (
    <footer className="app-footer">
      <span>© {new Date().getFullYear()} GoStone</span>
      <nav aria-label={dictionary.nav.legalNavigation}>
        <Link href={href("/impressum")}>{dictionary.nav.legal}</Link>
      </nav>
    </footer>
  );
}
