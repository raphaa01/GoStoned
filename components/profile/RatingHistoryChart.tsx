"use client";

import { useI18n } from "@/components/i18n/I18nProvider";
import type { Locale } from "@/lib/i18n/config";
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
}: {
  history: RatingHistoryEntry[];
  currentRating: number;
}) {
  const { dictionary, locale } = useI18n();
  const copy = dictionary.profile;
  if (history.length === 0) {
    return (
      <div className="rating-chart-empty">
        <span>1200</span>
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
  const chartTop = 20;
  const chartBottom = 208;
  const width = chartRight - chartLeft;
  const height = chartBottom - chartTop;
  const range = Math.max(1, maxRating - minRating);
  const coordinates = points.map((point, index) => ({
    ...point,
    x: chartLeft + (points.length === 1 ? width / 2 : (index / (points.length - 1)) * width),
    y: chartBottom - ((point.rating - minRating) / range) * height,
  }));
  const path = coordinates
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`)
    .join(" ");
  const gridRatings = Array.from({ length: 4 }, (_, index) =>
    Math.round(maxRating - (index / 3) * range),
  );
  const lastPoint = coordinates.at(-1)!;

  return (
    <div className="rating-chart">
      <svg
        aria-label={`${copy.ratingDevelopment} ${first.ratingBefore} ${copy.to} ${currentRating}`}
        role="img"
        viewBox="0 0 800 250"
      >
        {gridRatings.map((rating, index) => {
          const y = chartTop + (index / 3) * height;
          return (
            <g key={`${rating}-${index}`}>
              <line className="rating-chart__grid" x1={chartLeft} x2={chartRight} y1={y} y2={y} />
              <text className="rating-chart__axis" x={chartLeft - 9} y={y + 4}>
                {rating}
              </text>
            </g>
          );
        })}
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
                <title>{`${point.label}: ${point.rating} · ${formatShortDate(point.recordedAt, locale)}`}</title>
              </circle>
            ))
          : null}
        {coordinates.length > 26 ? (
          <circle className="rating-chart__point rating-chart__point--last" cx={lastPoint.x} cy={lastPoint.y} r="5" />
        ) : null}
        <text className="rating-chart__date" x={chartLeft} y="239">
          {formatShortDate(points[0].recordedAt, locale)}
        </text>
        <text className="rating-chart__date" textAnchor="end" x={chartRight} y="239">
          {formatShortDate(points.at(-1)!.recordedAt, locale)}
        </text>
      </svg>
    </div>
  );
}
