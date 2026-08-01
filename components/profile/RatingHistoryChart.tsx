"use client";

import { useI18n } from "@/components/i18n/I18nProvider";
import type { Locale } from "@/lib/i18n/config";
import { presentRating, type RatingDisplayPreference } from "@/lib/rating/rankPolicy";
import type { RatingHistoryEntry } from "@/lib/stats/statsService";

type ChartPoint = {
  rating: number;
  recordedAt: string;
  label: string;
};

function formatShortDate(value: string, locale: Locale) {
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
  }).format(new Date(value));
}

export function RatingHistoryChart({
  history,
  currentRating,
  preference,
}: {
  history: RatingHistoryEntry[];
  currentRating: number;
  preference: RatingDisplayPreference;
}) {
  const { dictionary, locale } = useI18n();
  const copy = dictionary.profile;
  const ratingLabel = (rating: number) => presentRating(
    rating,
    preference,
    locale === "de" ? "de" : "en",
  ).primaryLabel;
  if (history.length === 0) {
    return (
      <div className="rating-chart-empty">
        <span>{ratingLabel(currentRating)}</span>
        <strong>{copy.chartEmptyTitle}</strong>
        <p>{copy.chartEmptyDescription}</p>
      </div>
    );
  }

  const first = history[0];
  const points: ChartPoint[] = [
    {
      rating: first.ratingBefore,
      recordedAt: first.recordedAt,
      label: copy.startingRating,
    },
    ...history.map((entry) => ({
      rating: entry.ratingAfter,
      recordedAt: entry.recordedAt,
      label: entry.result === "win" ? copy.win : entry.result === "loss" ? copy.loss : entry.result === "draw" ? copy.draw : copy.noResult,
    })),
  ];
  const ratings = points.map((point) => point.rating);
  const lowest = Math.min(...ratings);
  const highest = Math.max(...ratings);
  const padding = Math.max(24, Math.ceil((highest - lowest) * 0.2));
  const minRating = lowest - padding;
  const maxRating = highest + padding;
  const chartLeft = 42;
  const chartRight = 758;
  const chartTop = 28;
  const chartBottom = 216;
  const width = chartRight - chartLeft;
  const height = chartBottom - chartTop;
  const range = Math.max(1, maxRating - minRating);
  const coordinates = points.map((point, index) => ({
    ...point,
    x: chartLeft + (points.length === 1 ? width / 2 : (index / (points.length - 1)) * width),
    y: chartBottom - ((point.rating - minRating) / range) * height,
  }));
  const path = coordinates.reduce((currentPath, point, index) => {
    if (index === 0) return `M ${point.x.toFixed(1)} ${point.y.toFixed(1)}`;
    const previous = coordinates[index - 1];
    const midpoint = (previous.x + point.x) / 2;
    return `${currentPath} C ${midpoint.toFixed(1)} ${previous.y.toFixed(1)}, ${midpoint.toFixed(1)} ${point.y.toFixed(1)}, ${point.x.toFixed(1)} ${point.y.toFixed(1)}`;
  }, "");
  const lastPoint = coordinates.at(-1)!;
  const areaPath = `${path} L ${lastPoint.x.toFixed(1)} ${chartBottom} L ${coordinates[0].x.toFixed(1)} ${chartBottom} Z`;
  const gridRatings = Array.from({ length: 4 }, (_, index) =>
    Math.round(maxRating - (index / 3) * range),
  );
  const accessibleSummary = `${copy.ratingDevelopment} ${ratingLabel(first.ratingBefore)} ${copy.to} ${ratingLabel(currentRating)}`;

  return (
    <figure className="rating-chart">
      <svg
        aria-label={accessibleSummary}
        role="img"
        viewBox="0 0 800 264"
      >
        <defs>
          <linearGradient id="rating-area" x1="0" x2="0" y1="0" y2="1">
            <stop className="rating-chart__area-start" offset="0%" />
            <stop className="rating-chart__area-end" offset="100%" />
          </linearGradient>
        </defs>
        {gridRatings.map((rating, index) => {
          const y = chartTop + (index / 3) * height;
          return (
            <g key={`${rating}-${index}`}>
              <line className="rating-chart__grid" x1={chartLeft} x2={chartRight} y1={y} y2={y} />
              <text className="rating-chart__axis" x={chartLeft - 9} y={y + 4}>
                {Math.round(rating)}
              </text>
            </g>
          );
        })}
        <path className="rating-chart__area" d={areaPath} />
        <path className="rating-chart__line" d={path} />
        {coordinates.length <= 26
          ? coordinates.map((point, index) => (
              <circle
                className={index === coordinates.length - 1 ? "rating-chart__point rating-chart__point--last" : "rating-chart__point"}
                cx={point.x}
                cy={point.y}
                key={`${point.recordedAt}-${index}`}
                r={index === coordinates.length - 1 ? 5 : 3}
              >
                <title>{`${point.label}: ${ratingLabel(point.rating)} · ${formatShortDate(point.recordedAt, locale)}`}</title>
              </circle>
            ))
          : null}
        {coordinates.length > 26 ? (
          <circle className="rating-chart__point rating-chart__point--last" cx={lastPoint.x} cy={lastPoint.y} r="5" />
        ) : null}
        <text className="rating-chart__current" textAnchor="end" x={lastPoint.x - 9} y={Math.max(chartTop + 12, lastPoint.y - 12)}>
          {ratingLabel(lastPoint.rating)}
        </text>
        <text className="rating-chart__date" x={chartLeft} y="253">
          {formatShortDate(points[0].recordedAt, locale)}
        </text>
        <text className="rating-chart__date" textAnchor="end" x={chartRight} y="253">
          {formatShortDate(points.at(-1)!.recordedAt, locale)}
        </text>
      </svg>
      <figcaption className="sr-only">{accessibleSummary}</figcaption>
    </figure>
  );
}
