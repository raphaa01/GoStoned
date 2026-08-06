import { useId } from "react";
import { useI18n } from "@/components/i18n/I18nProvider";
import {
  BOARD_PREVIEW_CENTER,
  boardPreviewCoordinates,
  boardPreviewStarPoints,
  boardPreviewStoneRadius,
} from "@/lib/game/boardPreview";
import type { BoardSize } from "@/lib/game/types";

type BoardGridProps = {
  boardSize: BoardSize;
  className?: string;
  showStone?: boolean;
};

function BoardGrid({ boardSize, className = "", showStone = false }: BoardGridProps) {
  const gradientId = useId().replaceAll(":", "");
  const coordinates = boardPreviewCoordinates(boardSize);
  const stars = boardPreviewStarPoints(boardSize);
  const stoneRadius = boardPreviewStoneRadius(boardSize);
  const lineWidth = boardSize === 19 ? 0.26 : boardSize === 13 ? 0.34 : 0.42;

  return (
    <svg
      aria-hidden="true"
      className={className}
      data-board-size={boardSize}
      preserveAspectRatio="xMidYMid meet"
      viewBox="0 0 100 100"
    >
      <defs>
        <radialGradient cx="32%" cy="25%" id={gradientId} r="72%">
          <stop offset="0" stopColor="#50524f" />
          <stop offset="0.42" stopColor="#171916" />
          <stop offset="1" stopColor="#050605" />
        </radialGradient>
        <filter height="180%" id={`${gradientId}-shadow`} width="180%" x="-40%" y="-40%">
          <feDropShadow dx="0.8" dy="1.3" floodColor="#2f2114" floodOpacity="0.34" stdDeviation="0.9" />
        </filter>
      </defs>

      <g className="play-board-grid-lines">
        {coordinates.map((coordinate, index) => (
          <line
            data-axis="vertical"
            key={`vertical-${index}`}
            strokeWidth={lineWidth}
            x1={coordinate}
            x2={coordinate}
            y1={coordinates[0]}
            y2={coordinates.at(-1)}
          />
        ))}
        {coordinates.map((coordinate, index) => (
          <line
            data-axis="horizontal"
            key={`horizontal-${index}`}
            strokeWidth={lineWidth}
            x1={coordinates[0]}
            x2={coordinates.at(-1)}
            y1={coordinate}
            y2={coordinate}
          />
        ))}
      </g>

      <g className="play-board-star-points">
        {stars.map((point) => (
          <circle
            cx={coordinates[point.x]}
            cy={coordinates[point.y]}
            key={`${point.x}-${point.y}`}
            r={boardSize === 19 ? 0.72 : boardSize === 13 ? 0.82 : 0.94}
          />
        ))}
      </g>

      {showStone ? (
        <circle
          className="play-board-center-stone"
          cx={BOARD_PREVIEW_CENTER}
          cy={BOARD_PREVIEW_CENTER}
          fill={`url(#${gradientId})`}
          filter={`url(#${gradientId}-shadow)`}
          r={stoneRadius}
        />
      ) : null}
    </svg>
  );
}

export function BoardPreview({ boardSize }: { boardSize: BoardSize }) {
  const { dictionary } = useI18n();
  return (
    <div
      aria-label={dictionary.play.boardPreviewLabel.replaceAll("{size}", String(boardSize))}
      className="play-board-preview"
      role="img"
    >
      <BoardGrid
        boardSize={boardSize}
        className="play-board-preview-grid"
        key={boardSize}
        showStone
      />
    </div>
  );
}

export function BoardSizeGlyph({ boardSize }: { boardSize: BoardSize }) {
  return <BoardGrid boardSize={boardSize} className="board-size-glyph" />;
}
