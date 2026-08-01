import { AppShell } from "@/components/layout/AppShell";
import { PuzzleWorkspace } from "@/components/puzzles/PuzzleWorkspace";
import { pageMetadata } from "@/lib/i18n/metadata";
import type { PuzzleKind } from "@/lib/puzzles/types";

export const metadata = pageMetadata("en", "puzzles", "/puzzles");

export default async function PuzzlesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const parameters = await searchParams;
  const initialMode: PuzzleKind = parameters.mode === "practice" ? "practice" : "daily";
  return <AppShell><PuzzleWorkspace initialMode={initialMode} /></AppShell>;
}
