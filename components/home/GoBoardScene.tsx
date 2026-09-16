import type { ReactNode } from "react";

type Scene = "play" | "learn" | "puzzles" | "review";
type Stone = {
  color: "black" | "white";
  x: number;
  y: number;
  label?: string;
  last?: boolean;
  ghost?: boolean;
};

const intersections = Array.from({ length: 9 }, (_, index) => 80 + index * 60);
const coordinates = ["A", "B", "C", "D", "E", "F", "G", "H", "J"];

const stones: Record<Scene, Stone[]> = {
  play: [
    { color: "black", x: 200, y: 200 },
    { color: "white", x: 440, y: 440 },
    { color: "black", x: 440, y: 200 },
    { color: "white", x: 200, y: 440 },
    { color: "black", x: 320, y: 440 },
    { color: "white", x: 320, y: 200 },
    { color: "black", x: 380, y: 320 },
    { color: "white", x: 260, y: 320, last: true },
  ],
  learn: [
    { color: "black", x: 260, y: 260 },
    { color: "black", x: 320, y: 200 },
    { color: "black", x: 380, y: 260 },
    { color: "white", x: 320, y: 260, last: true },
  ],
  puzzles: [
    { color: "black", x: 380, y: 380 },
    { color: "black", x: 440, y: 380 },
    { color: "black", x: 500, y: 380 },
    { color: "black", x: 380, y: 440 },
    { color: "white", x: 440, y: 440 },
    { color: "white", x: 500, y: 440 },
    { color: "black", x: 380, y: 500 },
    { color: "white", x: 440, y: 500 },
    { color: "white", x: 500, y: 500 },
    { color: "black", x: 560, y: 440 },
    { color: "black", x: 560, y: 500 },
    { color: "white", x: 500, y: 560 },
  ],
  review: [
    { color: "black", x: 200, y: 200 },
    { color: "white", x: 440, y: 440 },
    { color: "black", x: 440, y: 200 },
    { color: "white", x: 200, y: 440 },
    { color: "black", x: 320, y: 320 },
    { color: "white", x: 260, y: 320 },
    { color: "black", x: 380, y: 320 },
    { color: "white", x: 320, y: 260, last: true },
    { color: "black", x: 320, y: 380, label: "1", ghost: true },
    { color: "white", x: 380, y: 380, label: "2", ghost: true },
    { color: "black", x: 440, y: 380, label: "3", ghost: true },
  ],
};

function StonePiece({ scene, stone }: { scene: Scene; stone: Stone }) {
  const fill = stone.color === "black" ? `url(#${scene}-black)` : `url(#${scene}-white)`;
  return (
    <g className={stone.ghost ? "board-stone board-stone--ghost" : "board-stone"}>
      <circle
        cx={stone.x}
        cy={stone.y}
        fill={fill}
        filter={`url(#${scene}-shadow)`}
        r="24"
      />
      {stone.last ? <circle className="board-last-move" cx={stone.x} cy={stone.y} r="6" /> : null}
      {stone.label ? (
        <text
          className={`board-move-label board-move-label--${stone.color}`}
          dominantBaseline="central"
          textAnchor="middle"
          x={stone.x}
          y={stone.y}
        >
          {stone.label}
        </text>
      ) : null}
    </g>
  );
}

function SceneOverlay({ scene }: { scene: Scene }) {
  if (scene === "play") {
    return (
      <>
        <path className="board-territory board-territory--black" d="M122 122H258V258H122Z" />
        <path className="board-territory board-territory--white" d="M382 382H518V518H382Z" />
      </>
    );
  }

  if (scene === "learn") {
    return (
      <>
        <path className="board-guide-line" d="M320 260V320M320 260H260M320 260H380" />
        {[
          [320, 320],
          [260, 260],
          [380, 260],
          [320, 140],
        ].map(([x, y]) => <circle className="board-liberty" cx={x} cy={y} key={`${x}-${y}`} r="11" />)}
      </>
    );
  }

  if (scene === "puzzles") {
    return (
      <>
        <path className="board-puzzle-zone" d="M410 410H530V530H410Z" />
        <circle className="board-vital-point" cx="440" cy="560" r="14" />
        <path className="board-puzzle-arrow" d="M397 525C413 543 422 551 440 560" />
      </>
    );
  }

  return (
    <>
      <path className="board-review-path" d="M320 380L380 380L440 380" />
      <circle className="board-suggestion" cx="440" cy="320" r="14" />
    </>
  );
}

function BoardFrame({ children, scene }: { children: ReactNode; scene: Scene }) {
  return (
    <svg className="go-board-svg" role="presentation" viewBox="0 0 640 640">
      <defs>
        <linearGradient id={`${scene}-wood`} x1="0" x2="1" y1="0" y2="1">
          <stop offset="0" stopColor="#e2bd80" />
          <stop offset="0.52" stopColor="#c99551" />
          <stop offset="1" stopColor="#b97c3d" />
        </linearGradient>
        <radialGradient cx="31%" cy="23%" id={`${scene}-black`} r="75%">
          <stop offset="0" stopColor="#626862" />
          <stop offset="0.42" stopColor="#20231f" />
          <stop offset="1" stopColor="#050605" />
        </radialGradient>
        <radialGradient cx="31%" cy="23%" id={`${scene}-white`} r="75%">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.55" stopColor="#eeeae1" />
          <stop offset="1" stopColor="#b7afa2" />
        </radialGradient>
        <filter height="150%" id={`${scene}-shadow`} width="150%" x="-25%" y="-20%">
          <feDropShadow dx="0" dy="7" floodColor="#38240f" floodOpacity=".32" stdDeviation="5" />
        </filter>
        <filter height="140%" id={`${scene}-soft-shadow`} width="140%" x="-20%" y="-20%">
          <feDropShadow dx="0" dy="12" floodColor="#1b160f" floodOpacity=".25" stdDeviation="13" />
        </filter>
        <pattern height="19" id={`${scene}-grain`} patternUnits="userSpaceOnUse" width="140">
          <path d="M0 8C34 2 81 14 140 6" fill="none" stroke="#fff" strokeOpacity=".08" />
          <path d="M0 15C43 10 97 20 140 12" fill="none" stroke="#6f3f19" strokeOpacity=".08" />
        </pattern>
      </defs>

      <rect fill={`url(#${scene}-wood)`} filter={`url(#${scene}-soft-shadow)`} height="600" rx="20" width="600" x="20" y="20" />
      <rect fill={`url(#${scene}-grain)`} height="600" rx="20" width="600" x="20" y="20" />
      {intersections.map((value) => (
        <g className="board-grid-line" key={value}>
          <line x1="80" x2="560" y1={value} y2={value} />
          <line x1={value} x2={value} y1="80" y2="560" />
        </g>
      ))}
      {[
        [200, 200], [440, 200], [320, 320], [200, 440], [440, 440],
      ].map(([x, y]) => <circle className="board-star" cx={x} cy={y} key={`${x}-${y}`} r="4.5" />)}
      {coordinates.map((coordinate, index) => (
        <text className="board-coordinate" key={coordinate} textAnchor="middle" x={intersections[index]} y="48">{coordinate}</text>
      ))}
      {coordinates.map((_, index) => (
        <text className="board-coordinate" dominantBaseline="central" key={index} textAnchor="middle" x="48" y={intersections[index]}>{9 - index}</text>
      ))}
      <SceneOverlay scene={scene} />
      {children}
    </svg>
  );
}

export function GoBoardScene({ label, scene }: { label: string; scene: Scene }) {
  return (
    <figure className={`go-board-scene go-board-scene--${scene}`}>
      <div className="go-board-frame" role="img" aria-label={label}>
        <BoardFrame scene={scene}>
          {stones[scene].map((stone, index) => <StonePiece key={`${stone.x}-${stone.y}-${index}`} scene={scene} stone={stone} />)}
        </BoardFrame>
      </div>
      <div aria-hidden="true" className="board-scene-index">{scene === "play" ? "01" : scene === "learn" ? "02" : scene === "puzzles" ? "03" : "04"}</div>
      {scene === "play" ? (
        <div aria-hidden="true" className="board-match-strip">
          <span className="board-match-player"><i className="board-mini-stone board-mini-stone--black" /> 09:42</span>
          <span>9×9</span>
          <span className="board-match-player">09:18 <i className="board-mini-stone board-mini-stone--white" /></span>
        </div>
      ) : null}
      {scene === "review" ? (
        <div aria-hidden="true" className="board-evaluation">
          <span>42</span>
          <svg viewBox="0 0 160 44"><path d="M2 31C22 29 29 12 48 18S76 34 94 21s33-8 64-15" /></svg>
          <strong>+2.4</strong>
        </div>
      ) : null}
    </figure>
  );
}
