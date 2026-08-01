import { AccountGameReviewPage } from "@/components/auth/AccountPages";

export default async function GameReviewPage({ params }: { params: Promise<{ gameId: string }> }) {
  const { gameId } = await params;
  return <AccountGameReviewPage gameId={gameId} locale="en" />;
}
