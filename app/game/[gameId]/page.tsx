import type { Metadata } from "next";
import { GameRoom } from "@/components/game/GameRoom";

export const metadata: Metadata = {
  title: "Live game",
  robots: { index: false, follow: false },
};

export default async function GamePage({
  params,
}: {
  params: Promise<{ gameId: string }>;
}) {
  const { gameId } = await params;
  return <GameRoom gameId={gameId} />;
}
