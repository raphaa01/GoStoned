import { AnalysisReview } from "@/components/review/AnalysisReview";

export default async function GermanGameReviewPage({ params }: { params: Promise<{ gameId: string }> }) {
  const { gameId } = await params;
  return <AnalysisReview gameId={gameId} />;
}
