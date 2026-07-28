"use client";

import { useI18n } from "@/components/i18n/I18nProvider";

export function SkipLink() {
  const { dictionary } = useI18n();
  return <a className="skip-link" href="#main-content">{dictionary.common.skipToContent}</a>;
}
