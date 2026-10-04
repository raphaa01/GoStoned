"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useAuth } from "@/components/auth/AuthProvider";
import { useI18n } from "@/components/i18n/I18nProvider";
import { getSettingsCopy } from "@/lib/i18n/settings";
import { accountDeletionLanguage, getAccountDeletionCopy } from "@/lib/i18n/accountDeletion";
import { AppearanceSettings } from "./AppearanceSettings";
import { BoardPlacementSettings } from "./BoardPlacementSettings";

export function SettingsView({ children, deletionAction }: { children?: React.ReactNode; deletionAction?: React.ReactNode }) {
  const { user } = useAuth();
  const { href, locale } = useI18n();
  const copy = getSettingsCopy(locale);
  const deletion = getAccountDeletionCopy(locale);
  return <div className="settings-page">
    <header className="settings-page__header">
      <Link className="settings-back" href={href("/profile")}><ArrowLeft aria-hidden="true" size={18} />{copy.back}</Link>
      <h1>{copy.title}</h1>
    </header>
    <BoardPlacementSettings key={user?.playerKey} />
    <AppearanceSettings />
    <section className="settings-section" lang={accountDeletionLanguage(locale)}>
      <h2>{deletion.settingsTitle}</h2>
      {deletionAction ?? <Link className="button button--secondary" href={href("/delete-account")}>{deletion.action}</Link>}
    </section>
    {children}
  </div>;
}
