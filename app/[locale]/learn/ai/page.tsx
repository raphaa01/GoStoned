import { AccountTrainingGamePage } from "@/components/auth/AccountPages";
import { pageMetadata } from "@/lib/i18n/metadata";
import { prefixedLocaleOrNotFound } from "@/lib/i18n/serverLocale";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return pageMetadata(prefixedLocaleOrNotFound(locale), "learn", "/learn/ai");
}

export default async function LocalizedTrainingGamePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  return <AccountTrainingGamePage locale={prefixedLocaleOrNotFound(locale)} />;
}
