import { AccountReviewPage } from "@/components/auth/AccountPages";
import { pageMetadata } from "@/lib/i18n/metadata";
import { prefixedLocaleOrNotFound } from "@/lib/i18n/serverLocale";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return pageMetadata(prefixedLocaleOrNotFound(locale), "review", "/review");
}

export default async function LocalizedReviewPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return <AccountReviewPage locale={prefixedLocaleOrNotFound(locale)} />;
}
