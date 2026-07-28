import { GameRoom } from "@/components/game/GameRoom";
import { pageMetadata } from "@/lib/i18n/metadata";

export const metadata = pageMetadata("en", "game", "/game", { noIndex: true });

export default async function GamePage({
  params,
}: {
  params: Promise<{ gameId: string }>;
}) {
  const { gameId } = await params;
  return <GameRoom key={gameId} gameId={gameId} />;
}
