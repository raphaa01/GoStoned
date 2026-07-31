import { PrivacyPolicy } from "@/components/legal/PrivacyPolicy";
import { privacyPageMetadata } from "@/lib/i18n/metadata";
import { prefixedLocaleOrNotFound } from "@/lib/i18n/serverLocale";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return privacyPageMetadata(prefixedLocaleOrNotFound(locale));
}

export default async function LocalizedPrivacyPolicyPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  return <PrivacyPolicy locale={prefixedLocaleOrNotFound(locale)} />;
}
