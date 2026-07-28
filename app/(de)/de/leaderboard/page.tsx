import { LeaderboardView } from "@/components/leaderboard/LeaderboardView";
import { AppShell } from "@/components/layout/AppShell";
import { pageMetadata } from "@/lib/i18n/metadata";

export const metadata = pageMetadata("de", "leaderboard", "/leaderboard");

export default function GermanLeaderboardPage() {
  return <AppShell><LeaderboardView /></AppShell>;
}
