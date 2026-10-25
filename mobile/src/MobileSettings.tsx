import { LogOut } from "lucide-react";
import { useRef, useState } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { LanguageSwitcher } from "@/components/i18n/LanguageSwitcher";
import { useI18n } from "@/components/i18n/I18nProvider";
import { getMobileCopy } from "@/lib/i18n/mobile";
import { getPrivacyCopy } from "@/lib/i18n/privacy";
import { useRouter } from "./next-navigation";
import { SettingsView } from "@/components/settings/SettingsView";
import { MobileLegalLink } from "./MobileLegalLink";

export function MobileSettings() {
  const { logout } = useAuth();
  const { dictionary, href, locale } = useI18n();
  const router = useRouter();
  const copy = getMobileCopy(locale);
  const privacy = getPrivacyCopy(locale);
  const [signingOut, setSigningOut] = useState(false);
  const [logoutError, setLogoutError] = useState<string | null>(null);
  const logoutPending = useRef(false);
  const signOut = async () => {
    if (logoutPending.current) return;
    logoutPending.current = true;
    setSigningOut(true);
    setLogoutError(null);
    try {
      await logout();
      router.replace(href("/"));
    } catch {
      setLogoutError(dictionary.auth.errors.logout_failed);
    } finally {
      logoutPending.current = false;
      setSigningOut(false);
    }
  };

  return (
    <SettingsView>
      <section className="mobile-settings" aria-label={copy.settings}>
        <LanguageSwitcher />
        <nav aria-label={copy.legal} className="mobile-legal-links">
          <MobileLegalLink pathname="/privacy">{privacy.navLabel}</MobileLegalLink>
          <MobileLegalLink pathname="/impressum">{dictionary.nav.legal}</MobileLegalLink>
        </nav>
        {logoutError ? <p className="local-error" role="alert">{logoutError}</p> : null}
        <button className="mobile-logout" disabled={signingOut} onClick={() => void signOut()} type="button"><LogOut aria-hidden="true" size={19} />{dictionary.nav.logout}</button>
      </section>
    </SettingsView>
  );
}
