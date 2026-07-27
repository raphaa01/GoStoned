import type { Metadata } from "next";
import { LeaderboardView } from "@/components/leaderboard/LeaderboardView";
import { AppShell } from "@/components/layout/AppShell";

export const metadata: Metadata = { title: "Leaderboard" };

export default function LeaderboardPage() {
  return <AppShell><LeaderboardView /></AppShell>;
}
