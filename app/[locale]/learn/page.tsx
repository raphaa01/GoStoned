import { AccountLearnPage } from "@/components/auth/AccountPages";
import { pageMetadata } from "@/lib/i18n/metadata";
import { prefixedLocaleOrNotFound } from "@/lib/i18n/serverLocale";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return pageMetadata(prefixedLocaleOrNotFound(locale), "learn", "/learn");
}

export default async function LocalizedLearnPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return <AccountLearnPage locale={prefixedLocaleOrNotFound(locale)} />;
}
