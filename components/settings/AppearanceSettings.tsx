"use client";

import { Moon, Smartphone, Sun } from "lucide-react";
import { useI18n } from "@/components/i18n/I18nProvider";
import { getSettingsCopy } from "@/lib/i18n/settings";
import { useTheme } from "./ThemeProvider";

export function AppearanceSettings() {
  const { locale } = useI18n();
  const copy = getSettingsCopy(locale);
  const { preference, setPreference } = useTheme();
  const choices = [
    { value: "system", label: copy.system, icon: Smartphone },
    { value: "light", label: copy.light, icon: Sun },
    { value: "dark", label: copy.dark, icon: Moon },
  ] as const;

  return <section aria-labelledby="appearance-title" className="settings-section">
    <header><h2 id="appearance-title">{copy.appearance}</h2><p>{copy.appearanceBody}</p></header>
    <div aria-labelledby="appearance-title" className="settings-theme-picker" role="group">
      {choices.map(({ value, label, icon: Icon }) => <button
        aria-pressed={preference === value}
        key={value}
        onClick={() => setPreference(value)}
        type="button"
      ><Icon aria-hidden="true" size={19} />{label}</button>)}
    </div>
  </section>;
}
