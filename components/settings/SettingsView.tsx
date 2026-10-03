"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useAuth } from "@/components/auth/AuthProvider";
import { useI18n } from "@/components/i18n/I18nProvider";
import { getSettingsCopy } from "@/lib/i18n/settings";
import { AppearanceSettings } from "./AppearanceSettings";
import { BoardPlacementSettings } from "./BoardPlacementSettings";

export function SettingsView({ children }: { children?: React.ReactNode }) {
  const { user } = useAuth();
  const { href, locale } = useI18n();
  const copy = getSettingsCopy(locale);
  return <div className="settings-page">
    <header className="settings-page__header">
      <Link className="settings-back" href={href("/profile")}><ArrowLeft aria-hidden="true" size={18} />{copy.back}</Link>
      <h1>{copy.title}</h1>
    </header>
    <BoardPlacementSettings key={user?.playerKey} />
    <AppearanceSettings />
    {children}
  </div>;
}
