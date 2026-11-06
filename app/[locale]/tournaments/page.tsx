import { TournamentPage } from "@/components/tournaments/TournamentPages";
import { prefixedLocaleOrNotFound } from "@/lib/i18n/serverLocale";
export default async function Page({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  return (
    <TournamentPage locale={prefixedLocaleOrNotFound((await params).locale)} />
  );
}
