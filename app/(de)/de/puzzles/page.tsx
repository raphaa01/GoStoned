import { AppShell } from "@/components/layout/AppShell";
import { PuzzleWorkspace } from "@/components/puzzles/PuzzleWorkspace";
import { pageMetadata } from "@/lib/i18n/metadata";

export const metadata = pageMetadata("de", "puzzles", "/puzzles");

export default function GermanPuzzlesPage() {
  return <AppShell><PuzzleWorkspace /></AppShell>;
}
