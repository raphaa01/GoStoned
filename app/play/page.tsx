import type { Metadata } from "next";
import { PlayWorkspace } from "@/components/game/PlayWorkspace";
import { AppShell } from "@/components/layout/AppShell";
import type { BoardSize } from "@/lib/game/types";

export const metadata: Metadata = {
  title: "Play online",
};

export default async function PlayPage({
  searchParams,
}: {
  searchParams: Promise<{ size?: string }>;
}) {
  const { size } = await searchParams;
  const numericSize = Number(size);
  const initialSize: BoardSize =
    numericSize === 13 || numericSize === 19 ? numericSize : 9;

  return (
    <AppShell>
      <PlayWorkspace initialSize={initialSize} />
    </AppShell>
  );
}
