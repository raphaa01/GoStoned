"use client";

import { useI18n } from "@/components/i18n/I18nProvider";
import { developerCopy } from "@/lib/i18n/developer";

export function DeveloperTag() {
  const { locale } = useI18n();
  const copy = developerCopy(locale);
  return <span aria-label={copy.account} className="developer-tag" title={copy.account}>{copy.tag}</span>;
}
