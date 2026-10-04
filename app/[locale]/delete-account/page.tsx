import { AccountDeletion } from "@/components/legal/AccountDeletion";
import { getAccountDeletionCopy } from "@/lib/i18n/accountDeletion";
import { prefixedLocaleOrNotFound } from "@/lib/i18n/serverLocale";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return { title: getAccountDeletionCopy(prefixedLocaleOrNotFound(locale)).title };
}

export default async function AccountDeletionPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return <AccountDeletion locale={prefixedLocaleOrNotFound(locale)} />;
}
