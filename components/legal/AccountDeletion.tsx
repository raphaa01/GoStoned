import Link from "next/link";
import { AppShell } from "@/components/layout/AppShell";
import type { Locale } from "@/lib/i18n/config";
import { accountDeletionLanguage, getAccountDeletionCopy } from "@/lib/i18n/accountDeletion";
import { localizeHref } from "@/lib/i18n/routing";
import { getLegalNotice } from "@/lib/legal";

export function AccountDeletion({ locale }: { locale: Locale }) {
  const copy = getAccountDeletionCopy(locale);
  const { email } = getLegalNotice();
  const subject = locale === "de" ? "GoStone-Kontolöschung" : "GoStone account deletion";
  return <AppShell>
    <article className="legal-page" lang={accountDeletionLanguage(locale)}>
      <h1>{copy.title}</h1>
      <div className="legal-sections">
        <section className="legal-section">
          <h2>{copy.instructionsTitle}</h2>
          <div className="legal-section__content privacy-copy">
            <p>{copy.intro}</p>
            <p>{copy.instructions}</p>
            {email ? <p><a className="legal-email" href={`mailto:${email}?subject=${encodeURIComponent(subject)}`}>{copy.action}: {email}</a></p> : <p role="status">{copy.unavailable}</p>}
            <p>{copy.confirmation}</p>
          </div>
        </section>
        <section className="legal-section">
          <h2>{copy.dataTitle}</h2>
          <div className="legal-section__content privacy-copy">
            <p>{copy.data}</p>
            <Link href={localizeHref("/privacy", locale)}>{copy.privacy}</Link>
          </div>
        </section>
      </div>
    </article>
  </AppShell>;
}
