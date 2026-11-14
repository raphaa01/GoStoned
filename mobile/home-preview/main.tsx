import { useRef, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowRight, BarChart3, ChevronRight, GraduationCap, Home, Puzzle, Trophy, UsersRound, Wifi, X,
} from "lucide-react";
import darkLogo from "../../app/icons/gostone-sculpted-dark.svg?url";
import { ProfileAvatar } from "../../components/profile/ProfileAvatar";
import { getMobileCopy } from "../../lib/i18n/mobile";
import { presentRating } from "../../lib/rating/rankPolicy";
import "./styles.css";

const copy = getMobileCopy("en");
const learned = 36;
const total = 120;
const percentage = (learned / total) * 100;
const rating = presentRating(451);

const games = [
  { name: "CornerStudy", timeControl: "Blitz", change: "−11" },
  { name: "QuietHane", timeControl: "Blitz", change: "−12" },
  { name: "SenteLine", timeControl: "Classic", change: null },
] as const;

const tabs = [
  { label: copy.home, icon: Home, path: "/" },
  { label: "Puzzles", icon: Puzzle, path: "/puzzles" },
  { label: "Learn", icon: GraduationCap, path: "/learn" },
  { label: "Review", icon: BarChart3, path: "/review" },
  { label: "Leaderboard", icon: Trophy, path: "/leaderboard" },
] as const;

// The preview shows a corner position. The link opens the current puzzle hub.
const stones = [
  { x: 52, y: 23, white: false },
  { x: 80, y: 23, white: true },
  { x: 52, y: 51, white: false },
  { x: 80, y: 51, white: true },
  { x: 108, y: 51, white: true },
  { x: 80, y: 79, white: false },
  { x: 136, y: 79, white: false },
] as const;

function GoLink({ path, className, label, children }: {
  path: string;
  className?: string;
  label?: string;
  children: ReactNode;
}) {
  return <a aria-label={label} className={className} href={`https://gostone.app${path}`} target="_blank" rel="noreferrer">{children}</a>;
}

function StatusBar() {
  return (
    <div className="status-bar" aria-hidden="true">
      <span>12:39</span>
      <i className="dynamic-island" />
      <span className="status-symbols">
        <svg viewBox="0 0 19 13" width="17" height="13" fill="currentColor">
          <rect y="8" width="3.4" height="5" rx="1" />
          <rect x="5" y="5" width="3.4" height="8" rx="1" />
          <rect x="10" y="2.5" width="3.4" height="10.5" rx="1" />
          <rect x="15" width="3.4" height="13" rx="1" opacity=".45" />
        </svg>
        <Wifi size={16} strokeWidth={2.6} />
        <svg width="25" height="13" viewBox="0 0 25 13">
          <rect x=".5" y="1.5" width="21" height="10" rx="3" fill="none" stroke="currentColor" opacity=".48" />
          <rect x="2.5" y="3.5" width="12" height="6" rx="1.3" fill="currentColor" />
          <path d="M23 4.5a2 2 0 0 1 0 4z" fill="currentColor" opacity=".6" />
        </svg>
      </span>
    </div>
  );
}

function PuzzleBoard() {
  return (
    <svg className="puzzle-board" viewBox="0 0 180 112" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <linearGradient id="wood" x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="#a8845c" />
          <stop offset=".64" stopColor="#c19e72" />
          <stop offset="1" stopColor="#af895f" />
        </linearGradient>
      </defs>
      <rect width="180" height="112" fill="url(#wood)" />
      <g fill="none" stroke="#65492f" strokeOpacity=".62">
        <path d="M24 23H180M24 51H180M24 79H180M24 107H180M24 23V112M52 23V112M80 23V112M108 23V112M136 23V112M164 23V112" />
      </g>
      <circle cx="108" cy="79" r="2" fill="#65492f" />
      {stones.map(({ x, y, white }) => (
        <g key={`${x}-${y}`}>
          <circle cx={x} cy={y + 2} r="10.4" fill="#442a20" opacity=".25" />
          <circle cx={x} cy={y} r="10.3" fill={white ? "#f0e4ce" : "#302b25"} stroke={white ? "#f7ead1" : "#41362b"} />
        </g>
      ))}
      <circle cx="108" cy="79" r="8" fill="none" stroke="#553a2e" strokeWidth="1.2" strokeDasharray="2 2.2" />
    </svg>
  );
}

function LearningPath() {
  const path = "M22 77H56C77 77 72 36 94 36H155";
  return (
    <svg className="learning-path" viewBox="0 0 180 112" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <path className="learning-line" d={path} pathLength="100" />
      <path className="learning-line is-complete" d={path} pathLength="100" strokeDasharray={`${percentage} 100`} />
      <circle cx="22" cy="77" r="6" fill="#e3d7a5" />
      <circle cx="64" cy="74" r="6" fill="#e3d7a5" />
      <circle cx="108" cy="36" r="6" fill="#3d4232" stroke="#929676" strokeWidth="2" />
      <circle cx="155" cy="36" r="6" fill="#3d4232" stroke="#929676" strokeWidth="2" />
    </svg>
  );
}

function Practice() {
  return (
    <div className="practice">
      <GoLink className="practice-link" path="/puzzles">
        <span className="practice-art"><PuzzleBoard /></span>
        <span className="practice-details">
          <strong>{copy.dailyPuzzle}</strong>
          <span>Black to play</span>
        </span>
        <ChevronRight className="practice-chevron" size={18} aria-hidden="true" />
      </GoLink>
      <GoLink className="practice-link" path="/learn" label={`${copy.continueLearning}, ${learned} of ${total} lessons complete`}>
        <span className="practice-art learning-art"><LearningPath /></span>
        <span className="practice-details">
          <strong>{copy.continueLearning}</strong>
          <span>{learned} / {total} lessons</span>
        </span>
        <ChevronRight className="practice-chevron" size={18} aria-hidden="true" />
      </GoLink>
    </div>
  );
}

function Statistics() {
  return (
    <section className="statistics">
      <h2>{copy.statistics}</h2>
      <dl className="stats">
        <div>
          <dt>{copy.rating}</dt>
          <dd>{rating.numericLabel}<small>{rating.rankLabel}</small></dd>
        </div>
        <div>
          <dt>{copy.ratedGames}</dt>
          <dd>53</dd>
        </div>
        <div>
          <dt>{copy.lastThirtyDays}</dt>
          <dd className="negative">−36</dd>
        </div>
      </dl>
    </section>
  );
}

function RecentGames() {
  const dialog = useRef<HTMLDialogElement>(null);
  const [selected, setSelected] = useState<(typeof games)[number]>(games[0]);

  function showGame(game: (typeof games)[number]) {
    setSelected(game);
    dialog.current?.showModal();
  }

  return (
    <section className="recent">
      <header className="section-heading">
        <h2>{copy.recentGames}</h2>
        <GoLink path="/profile#game-history">{copy.allGames}<ChevronRight size={16} aria-hidden="true" /></GoLink>
      </header>
      <ul className="game-list">
        {games.map((game) => (
          <li key={game.name}>
            <button className="game-row" onClick={() => showGame(game)} type="button">
              <span className="result-mark" aria-hidden="true">L</span>
              <span className="game-info">
                <strong>{game.name}</strong>
                <small>9×9 · {game.timeControl} · {copy.lost}</small>
              </span>
              <span className="negative game-change">{game.change}</span>
              <ChevronRight className="game-chevron" size={15} aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
      <dialog aria-labelledby="game-title" ref={dialog}>
        <form method="dialog"><button aria-label="Close" type="submit"><X size={22} /></button></form>
        <h3 id="game-title">{selected.name}</h3>
        <p>9×9 · {selected.timeControl} · {copy.lost}</p>
        {selected.change && <p className="negative">{selected.change}</p>}
        <GoLink path="/profile#game-history">{copy.allGames}<ArrowRight size={16} aria-hidden="true" /></GoLink>
      </dialog>
    </section>
  );
}

function Dock() {
  return (
    <footer className="dock">
      <GoLink className="play" path="/play"><i aria-hidden="true" />{copy.play}</GoLink>
      <nav className="tab-bar" aria-label={copy.appNavigation}>
        {tabs.map(({ label, icon: Icon, path }) => {
          const labelWithIcon = <><span className="tab-icon"><Icon size={22} strokeWidth={1.9} aria-hidden="true" /></span><span>{label}</span></>;
          return path === "/" ? (
            <a className="tab" aria-current="page" href="" key={path}>{labelWithIcon}</a>
          ) : (
            <GoLink className="tab" path={path} key={path}>{labelWithIcon}</GoLink>
          );
        })}
      </nav>
      <div className="home-indicator" aria-hidden="true" />
    </footer>
  );
}

function App() {
  return (
    <div className="phone">
      <StatusBar />
      <header className="top-bar">
        <GoLink className="profile" path="/profile" label="Profile: komi">
          <ProfileAvatar size="sm" style="urushi-mon" /><span>komi</span>
        </GoLink>
        <h1>
          {/* eslint-disable-next-line @next/next/no-img-element -- The Vite preview bundles the approved SVG master. */}
          <img src={darkLogo} alt="" width={29} height={29} />
          GoStone
        </h1>
        <GoLink className="friends" path="/friends" label={copy.friends}>
          <UsersRound size={22} strokeWidth={1.85} aria-hidden="true" />
        </GoLink>
      </header>
      <main>
        <Practice />
        <Statistics />
        <RecentGames />
      </main>
      <Dock />
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
