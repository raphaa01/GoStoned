import { AppShell } from "@/components/layout/AppShell";
import { requireAccountPage } from "@/lib/auth/pageAccess";
import type { Locale } from "@/lib/i18n/config";
import { TournamentHub } from "./TournamentHub";
import { notFound } from "next/navigation";

export async function TournamentPage({
  locale,
  id,
}: {
  locale: Locale;
  id?: string;
}) {
  if (
    id &&
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      id,
    )
  )
    notFound();
  await requireAccountPage(id ? `/tournaments/${id}` : "/tournaments", locale);
  return (
    <AppShell>
      <TournamentHub key={id ?? "index"} id={id} />
    </AppShell>
  );
}
