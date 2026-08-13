import type { Metadata } from "next";
import { AccountFriendsPage } from "@/components/auth/AccountPages";
import { getFriendsCopy } from "@/lib/i18n/friends";
import { prefixedLocaleOrNotFound } from "@/lib/i18n/serverLocale";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale: localeParam } = await params;
  const locale = prefixedLocaleOrNotFound(localeParam);
  const copy = getFriendsCopy(locale);
  return { title: copy.metadataTitle, description: copy.metadataDescription };
}

export default async function LocalizedFriendsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return <AccountFriendsPage locale={prefixedLocaleOrNotFound(locale)} />;
}
