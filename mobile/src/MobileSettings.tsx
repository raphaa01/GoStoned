import { LogOut } from "lucide-react";
import Link from "next/link";
import { useAuth } from "@/components/auth/AuthProvider";
import { LanguageSwitcher } from "@/components/i18n/LanguageSwitcher";
import { useI18n } from "@/components/i18n/I18nProvider";
import { getMobileCopy } from "@/lib/i18n/mobile";
import { getPrivacyCopy } from "@/lib/i18n/privacy";
import { useRouter } from "./next-navigation";
import { SettingsView } from "@/components/settings/SettingsView";

export function MobileSettings() {
  const { logout } = useAuth();
  const { dictionary, href, locale } = useI18n();
  const router = useRouter();
  const copy = getMobileCopy(locale);
  const privacy = getPrivacyCopy(locale);
  const signOut = async () => {
    await logout();
    router.replace(href("/"));
  };

  return (
    <SettingsView>
      <section className="mobile-settings" aria-label={copy.settings}>
        <LanguageSwitcher />
        <nav aria-label={copy.legal} className="mobile-legal-links">
          <Link href={href("/privacy")}>{privacy.navLabel}</Link>
          <Link href={href("/impressum")}>{dictionary.nav.legal}</Link>
        </nav>
        <button className="mobile-logout" onClick={() => void signOut()} type="button"><LogOut aria-hidden="true" size={19} />{dictionary.nav.logout}</button>
      </section>
    </SettingsView>
  );
}
