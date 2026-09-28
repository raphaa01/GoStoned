import { LogOut, Moon, Smartphone, Sun } from "lucide-react";
import Link from "next/link";
import { useAuth } from "@/components/auth/AuthProvider";
import { LanguageSwitcher } from "@/components/i18n/LanguageSwitcher";
import { useI18n } from "@/components/i18n/I18nProvider";
import { ProfileView } from "@/components/profile/ProfileView";
import { getMobileCopy } from "@/lib/i18n/mobile";
import { getPrivacyCopy } from "@/lib/i18n/privacy";
import { useRouter } from "./next-navigation";
import { useMobileTheme, type MobileThemePreference } from "./theme";

export function MobileProfile() {
  const { logout } = useAuth();
  const { dictionary, href, locale } = useI18n();
  const router = useRouter();
  const copy = getMobileCopy(locale);
  const privacy = getPrivacyCopy(locale);
  const { preference, setPreference } = useMobileTheme();
  const choices: Array<{ value: MobileThemePreference; label: string; icon: typeof Smartphone }> = [
    { value: "system", label: copy.system, icon: Smartphone },
    { value: "light", label: copy.light, icon: Sun },
    { value: "dark", label: copy.dark, icon: Moon },
  ];

  const signOut = async () => {
    await logout();
    router.replace(href("/"));
  };

  return (
    <div className="mobile-profile-screen">
      <ProfileView />
      <section className="mobile-settings" aria-labelledby="mobile-settings-title">
        <header><small>{copy.settings}</small><h2 id="mobile-settings-title">{copy.appearance}</h2><p>{copy.appearanceBody}</p></header>
        <div className="mobile-theme-picker">
          {choices.map(({ value, label, icon: Icon }) => (
            <button aria-pressed={preference === value} key={value} onClick={() => setPreference(value)} type="button">
              <Icon aria-hidden="true" size={19} />
              {label}
            </button>
          ))}
        </div>
        <LanguageSwitcher />
        <nav aria-label={copy.legal} className="mobile-legal-links">
          <Link href={href("/privacy")}>{privacy.navLabel}</Link>
          <Link href={href("/impressum")}>{dictionary.nav.legal}</Link>
        </nav>
        <button className="mobile-logout" onClick={() => void signOut()} type="button"><LogOut aria-hidden="true" size={19} />{dictionary.nav.logout}</button>
      </section>
    </div>
  );
}
