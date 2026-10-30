import Link from "next/link";
import { AppShell } from "@/components/layout/AppShell";
import type { Locale } from "@/lib/i18n/config";
import { accountDeletionLanguage, getAccountDeletionCopy } from "@/lib/i18n/accountDeletion";
import { localizeHref } from "@/lib/i18n/routing";
import { AccountDeletionRequest } from "./AccountDeletionRequest";

export function AccountDeletion({ locale }: { locale: Locale }) {
  const copy = getAccountDeletionCopy(locale);
  return <AppShell>
    <article className="legal-page" lang={accountDeletionLanguage(locale)}>
      <h1>{copy.title}</h1>
      <AccountDeletionRequest />
      <div className="legal-sections">
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
