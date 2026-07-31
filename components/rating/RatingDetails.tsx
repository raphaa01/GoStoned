import type { GlobalRatingSummary } from "@/lib/stats/statsService";

export function RatingDetails({
  labels,
  rating,
  summary,
}: {
  labels: {
    algorithm: string;
    ratingDeviation: string;
    ratedGames: string;
    volatility: string;
  };
  rating: GlobalRatingSummary;
  summary: string;
}) {
  return (
    <details className="rating-details">
      <summary>{summary}</summary>
      <dl>
        <div><dt>{labels.ratingDeviation}</dt><dd>{Math.round(rating.ratingDeviation)}</dd></div>
        <div><dt>{labels.volatility}</dt><dd>{rating.volatility.toFixed(4)}</dd></div>
        <div><dt>{labels.ratedGames}</dt><dd>{rating.ratedGameCount}</dd></div>
        <div><dt>{labels.algorithm}</dt><dd>{rating.algorithmVersion}</dd></div>
      </dl>
    </details>
  );
}
