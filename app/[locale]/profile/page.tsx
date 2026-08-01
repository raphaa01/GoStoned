import { AccountProfilePage } from "@/components/auth/AccountPages";
import { pageMetadata } from "@/lib/i18n/metadata";
import { prefixedLocaleOrNotFound } from "@/lib/i18n/serverLocale";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return pageMetadata(prefixedLocaleOrNotFound(locale), "profile", "/profile");
}

export default async function LocalizedProfilePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return <AccountProfilePage locale={prefixedLocaleOrNotFound(locale)} />;
}
