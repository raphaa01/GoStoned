import { AccountSettingsPage } from "@/components/auth/AccountPages";
import { getSettingsCopy } from "@/lib/i18n/settings";
import { prefixedLocaleOrNotFound } from "@/lib/i18n/serverLocale";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return { title: getSettingsCopy(prefixedLocaleOrNotFound(locale)).title, robots: { index: false, follow: false } };
}

export default async function LocalizedSettingsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return <AccountSettingsPage locale={prefixedLocaleOrNotFound(locale)} />;
}
