import { AppShell } from "@/components/layout/AppShell";
import { PuzzleWorkspace } from "@/components/puzzles/PuzzleWorkspace";
import { pageMetadata } from "@/lib/i18n/metadata";

export const metadata = pageMetadata("en", "puzzles", "/puzzles");

export default function PuzzlesPage() {
  return <AppShell><PuzzleWorkspace /></AppShell>;
}
