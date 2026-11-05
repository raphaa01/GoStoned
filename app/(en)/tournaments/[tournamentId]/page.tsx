import { TournamentPage } from "@/components/tournaments/TournamentPages";
import { getTournamentsCopy } from "@/lib/i18n/tournaments";
export const metadata = { title: getTournamentsCopy("en").title };
export default async function Page({
  params,
}: {
  params: Promise<{ tournamentId: string }>;
}) {
  const { tournamentId } = await params;
  return <TournamentPage locale="en" id={tournamentId} />;
}
