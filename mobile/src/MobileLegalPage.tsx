import { useI18n } from "@/components/i18n/I18nProvider";
import { getAccountDeletionCopy } from "@/lib/i18n/accountDeletion";
import { getPrivacyCopy } from "@/lib/i18n/privacy";
import { MobileLegalLink, type MobileLegalPath } from "./MobileLegalLink";

// Legal contact details are server-side runtime configuration. Open the live
// public pages instead of evaluating process.env in the bundled native client.
export function MobileLegalPage({ pathname }: { pathname: MobileLegalPath }) {
  const { dictionary, locale } = useI18n();
  const title = pathname === "/privacy" ? getPrivacyCopy(locale).title
    : pathname === "/delete-account" ? getAccountDeletionCopy(locale).title
      : dictionary.nav.legal;
  return <section className="settings-section">
    <h1>{title}</h1>
    <MobileLegalLink className="button button--secondary" pathname={pathname}>{title} ↗</MobileLegalLink>
  </section>;
}
