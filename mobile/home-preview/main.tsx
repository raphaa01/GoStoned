import { useRef, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowRight, BarChart3, ChevronRight, GraduationCap, Home, Moon, Puzzle, Sun, Trophy, UsersRound, Wifi, X,
} from "lucide-react";
import darkLogo from "../../app/icons/gostone-sculpted-dark.svg?url";
import lightLogo from "../../app/icons/gostone-sculpted-light.svg?url";
import { ProfileAvatar } from "../../components/profile/ProfileAvatar";
import { getMobileCopy } from "../../lib/i18n/mobile";
import { dailyPuzzleAt } from "../../lib/puzzles/dailyCatalog";
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

type Theme = "light" | "dark";

const params = new URLSearchParams(window.location.search);
const showThemeControls = !params.has("capture");

function initialTheme(): Theme {
  const requested = params.get("theme");
  if (requested === "light" || requested === "dark") return requested;
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

// Show the lower-left corner of a fixed sample from the GoStone daily rotation.
const puzzleRows = dailyPuzzleAt(1).board.slice(7, 13).map((row) => row.slice(0, 9));

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
  const step = 12;
  const x = (column: number) => 10 + column * step;
  const y = (row: number) => 8 + row * step;
  const columns = puzzleRows[0].length;

  return (
    <svg className="puzzle-board" viewBox="0 0 120 78" aria-hidden="true">
      <g className="board-grid">
        {puzzleRows.map((_, row) => <path key={row} d={`M${x(0)} ${y(row)}H114`} />)}
        {Array.from({ length: columns }, (_, column) => (
          <path key={column} d={`M${x(column)} 0V${y(puzzleRows.length - 1)}`} />
        ))}
      </g>
      {puzzleRows.flatMap((row, rowIndex) => row.map((stone, column) => stone && (
        <circle
          className={`board-stone ${stone}`}
          key={`${column}-${rowIndex}`}
          cx={x(column)}
          cy={y(rowIndex)}
          r="4.95"
        />
      )))}
    </svg>
  );
}

function Practice() {
  return (
    <div className="practice">
      <GoLink className="practice-link puzzle-link" path="/puzzles">
        <span className="practice-heading">
          <strong>{copy.dailyPuzzle}</strong>
          <ChevronRight size={16} aria-hidden="true" />
        </span>
        <span className="practice-visual"><PuzzleBoard /></span>
        <span className="practice-caption">Black to play</span>
      </GoLink>
      <GoLink className="practice-link learn-link" path="/learn" label={`${copy.continueLearning}, ${learned} of ${total} lessons complete`}>
        <span className="practice-heading">
          <strong>{copy.continueLearning}</strong>
          <ChevronRight size={16} aria-hidden="true" />
        </span>
        <span className="practice-visual" aria-hidden="true">
          <span className="lesson-count"><b>{learned}</b><span> / {total}</span></span>
          <progress max={100} value={percentage} />
        </span>
        <span className="practice-caption">Lessons complete</span>
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
            <a className="tab" aria-current="page" href="#home" key={path}>{labelWithIcon}</a>
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
  const [theme, setTheme] = useState<Theme>(initialTheme);

  return (
    <div className="preview" data-theme={theme} data-controls={showThemeControls}>
      {showThemeControls && (
        <div className="theme-switch" role="group" aria-label="Preview appearance">
          <button type="button" aria-pressed={theme === "light"} onClick={() => setTheme("light")}>
            <Sun size={16} aria-hidden="true" /> Light
          </button>
          <button type="button" aria-pressed={theme === "dark"} onClick={() => setTheme("dark")}>
            <Moon size={16} aria-hidden="true" /> Dark
          </button>
        </div>
      )}
      <div className="phone" id="home">
        <StatusBar />
        <header className="top-bar">
          <GoLink className="profile" path="/profile" label="Profile: komi">
            <ProfileAvatar size="sm" style="urushi-mon" /><span>komi</span>
          </GoLink>
          <h1>
            {/* eslint-disable-next-line @next/next/no-img-element -- The Vite preview bundles the approved SVG masters. */}
            <img src={theme === "dark" ? darkLogo : lightLogo} alt="" width={29} height={29} />
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
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
