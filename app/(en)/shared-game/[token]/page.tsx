import { SharedGameView } from "@/components/game/SharedGameView";
import { pageMetadata } from "@/lib/i18n/metadata";

export const metadata = pageMetadata("en", "game", "/shared-game", { noIndex: true });

export default async function SharedGamePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <SharedGameView token={token} />;
}
