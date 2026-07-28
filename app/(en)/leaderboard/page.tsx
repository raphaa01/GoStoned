import { LeaderboardView } from "@/components/leaderboard/LeaderboardView";
import { AppShell } from "@/components/layout/AppShell";
import { pageMetadata } from "@/lib/i18n/metadata";

export const metadata = pageMetadata("en", "leaderboard", "/leaderboard");

export default function LeaderboardPage() {
  return <AppShell><LeaderboardView /></AppShell>;
}
