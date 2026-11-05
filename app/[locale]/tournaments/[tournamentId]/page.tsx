import { TournamentPage } from "@/components/tournaments/TournamentPages";
import { prefixedLocaleOrNotFound } from "@/lib/i18n/serverLocale";
export default async function Page({
  params,
}: {
  params: Promise<{ locale: string; tournamentId: string }>;
}) {
  const { locale, tournamentId } = await params;
  return (
    <TournamentPage
      locale={prefixedLocaleOrNotFound(locale)}
      id={tournamentId}
    />
  );
}
