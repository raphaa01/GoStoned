import EnglishSharedGamePage from "@/app/(en)/shared-game/[token]/page";
import { pageMetadata } from "@/lib/i18n/metadata";
import { prefixedLocaleOrNotFound } from "@/lib/i18n/serverLocale";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return pageMetadata(prefixedLocaleOrNotFound(locale), "game", "/shared-game", { noIndex: true });
}

export default EnglishSharedGamePage;
