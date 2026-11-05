import { TournamentPage } from "@/components/tournaments/TournamentPages";
import { getTournamentsCopy } from "@/lib/i18n/tournaments";
export const metadata = { title: getTournamentsCopy("en").title };
export default function Page() {
  return <TournamentPage locale="en" />;
}
