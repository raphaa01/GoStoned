import { AccountGameReviewPage } from "@/components/auth/AccountPages";
import { prefixedLocaleOrNotFound } from "@/lib/i18n/serverLocale";

export default async function LocalizedGameReviewPage({
  params,
}: {
  params: Promise<{ gameId: string; locale: string }>;
}) {
  const { gameId, locale } = await params;
  return (
    <AccountGameReviewPage
      gameId={gameId}
      locale={prefixedLocaleOrNotFound(locale)}
    />
  );
}
