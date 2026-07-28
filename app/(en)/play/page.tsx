import { PlayWorkspace } from "@/components/game/PlayWorkspace";
import { AppShell } from "@/components/layout/AppShell";
import type { BoardSize } from "@/lib/game/types";
import { pageMetadata } from "@/lib/i18n/metadata";

export const metadata = pageMetadata("en", "play", "/play");

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
