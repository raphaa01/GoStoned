import type { Board, BoardSize } from "@/lib/game/types";
import styles from "./review.module.css";

const COLUMNS = "ABCDEFGHJKLMNOPQRST";

function point(move: string, size: BoardSize) {
  const match = /^([A-HJ-T])(\d{1,2})$/i.exec(move);
  if (!match) return null;
  const x = COLUMNS.indexOf(match[1].toUpperCase());
  const y = size - Number(match[2]);
  return x >= 0 && y >= 0 && x < size && y < size ? { x, y } : null;
}

export function AnalysisBoard({ board, size, playedMove, bestMove, label }: { board: Board; size: BoardSize; playedMove?: string; bestMove?: string; label: string }) {
  const pad = 6;
  const span = 88;
  const position = (value: number) => pad + (value / (size - 1)) * span;
  const played = playedMove ? point(playedMove, size) : null;
  const best = bestMove ? point(bestMove, size) : null;
  const stoneRadius = Math.min(4.7, 42 / size);
  return (
    <svg aria-label={label} className={styles.board} role="img" viewBox="0 0 100 100">
      <rect className={styles.boardWood} height="100" rx="2.4" width="100" />
      {Array.from({ length: size }, (_, index) => (
        <g key={index}>
          <line className={styles.boardLine} x1={position(index)} x2={position(index)} y1={pad} y2={100 - pad} />
          <line className={styles.boardLine} x1={pad} x2={100 - pad} y1={position(index)} y2={position(index)} />
        </g>
      ))}
      {board.flatMap((row, y) => row.map((stone, x) => stone ? (
        <circle className={stone === "black" ? styles.blackStone : styles.whiteStone} cx={position(x)} cy={position(y)} key={`${x}:${y}`} r={stoneRadius} />
      ) : null))}
      {best && (best.x !== played?.x || best.y !== played?.y) ? (
        <circle className={styles.bestMarker} cx={position(best.x)} cy={position(best.y)} r={stoneRadius + 1} />
      ) : null}
      {played ? <circle className={styles.playedMarker} cx={position(played.x)} cy={position(played.y)} r={1.25} /> : null}
    </svg>
  );
}
