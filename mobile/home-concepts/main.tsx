import { useRef, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowLeft, ArrowRight, ArrowUpRight, BarChart3, ChevronRight,
  GraduationCap, Home, Puzzle, Trophy, UsersRound, Wifi, X,
} from "lucide-react";
import darkLogo from "../../app/icons/gostone-sculpted-dark.svg?url";
import lightLogo from "../../app/icons/gostone-sculpted-light.svg?url";
import { ProfileAvatar } from "../../components/profile/ProfileAvatar";
import { getMobileCopy } from "../../lib/i18n/mobile";
import { presentRating } from "../../lib/rating/rankPolicy";
import "./styles.css";

const copy = getMobileCopy("en");
const live = "https://gostone.app";
const learned = 36;
const total = 120;
const progress = learned / total;
const rating = presentRating(451);
const concepts = [
  { id: "kifu", name: "Kifu", idea: "Die Spielchronik" },
  { id: "raster", name: "Raster", idea: "Das Koordinatensystem" },
  { id: "porzellan", name: "Porzellan", idea: "Die runde Form" },
  { id: "spielraum", name: "Spielraum", idea: "Die gemeinsame Spielfläche" },
] as const;

type Concept = typeof concepts[number];

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

// An illustrative corner position. The Daily Puzzle link opens the current puzzle hub.
const stones = [
  [1, 1, "black"], [2, 1, "white"], [1, 2, "black"], [2, 2, "white"],
  [3, 2, "white"], [1, 3, "black"], [3, 3, "black"], [2, 4, "white"],
] as const;

function GoLink({ path, className, label, children }: {
  path: string;
  className?: string;
  label?: string;
  children: ReactNode;
}) {
  return <a aria-label={label} className={className} href={live + path} target="_blank" rel="noreferrer">{children}</a>;
}

function StatusBar() {
  return (
    <div className="status-bar" aria-hidden="true">
      <span>12:39</span>
      <i className="dynamic-island" />
      <span className="status-symbols">
        <svg viewBox="0 0 19 13" width="17" height="13">
          <path d="M0 9a1 1 0 0 1 1-1h1.5a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1H1a1 1 0 0 1-1-1zm5-3a1 1 0 0 1 1-1h1.5a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1zm5-2.5a1 1 0 0 1 1-1h1.5a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1H11a1 1 0 0 1-1-1zM15 1a1 1 0 0 1 1-1h1.5a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H16a1 1 0 0 1-1-1z" fill="currentColor" />
        </svg>
        <Wifi size={15} strokeWidth={2.8} />
        <svg width="26" height="13" viewBox="0 0 26 13">
          <rect x=".5" y="1.5" width="22" height="10" rx="3" fill="none" stroke="currentColor" opacity=".45" />
          <rect x="2.5" y="3.5" width="13" height="6" rx="1.4" fill="currentColor" />
          <path d="M24 4.5a2 2 0 0 1 0 4z" fill="currentColor" opacity=".55" />
        </svg>
      </span>
    </div>
  );
}

function MiniBoard() {
  const lines = [18, 38, 58, 78, 98];
  return (
    <svg aria-hidden="true" className="mini-board" viewBox="0 0 116 116">
      <rect className="board-surface" width="116" height="116" />
      <g className="board-grid">
        {lines.map((point) => (
          <path key={point} d={`M18 ${point}H98M${point} 18V98`} />
        ))}
      </g>
      <circle className="board-hoshi" cx="78" cy="78" r="2" />
      {stones.map(([col, row, color]) => (
        <circle className={`board-stone board-stone--${color}`} key={`${col}-${row}`}
          cx={18 + (col - 1) * 20} cy={18 + (row - 1) * 20} r="8.4" />
      ))}
      <circle className="board-target" cx="58" cy="78" r="7.3" />
      <circle className="board-hoshi" cx="58" cy="78" r="1.6" />
    </svg>
  );
}

function Practice({ concept }: { concept: Concept["id"] }) {
  return (
    <div className="practice">
      <GoLink className="practice-link puzzle-link" path="/puzzles">
        <MiniBoard />
        <span className="practice-label">{copy.dailyPuzzle}</span>
        <ArrowUpRight className="practice-arrow" aria-hidden="true" size={19} strokeWidth={1.65} />
      </GoLink>
      <GoLink className="practice-link learn-link" path="/learn">
        <span className="practice-label">{copy.continueLearning}</span>
        <ArrowUpRight className="practice-arrow" aria-hidden="true" size={19} strokeWidth={1.65} />
        <span className="progress" role="progressbar" aria-label="Lessons complete" aria-valuemin={0}
          aria-valuenow={learned} aria-valuemax={total}>
          {concept === "porzellan" ? (
            <svg className="progress-ring" viewBox="0 0 104 104" aria-hidden="true">
              <circle className="progress-ring-track" cx="52" cy="52" r="45" />
              <circle cx="52" cy="52" r="45" pathLength="100" strokeDasharray={`${progress * 100} 100`} />
            </svg>
          ) : (
            <span className="progress-marks" aria-hidden="true">
              {Array.from({ length: 10 }, (_, index) => (
                <i key={index}><b style={{ width: `${Math.max(0, Math.min(1, progress * 10 - index)) * 100}%` }} /></i>
              ))}
            </span>
          )}
          <span className="progress-count"><strong>{learned}</strong><span> / {total}</span></span>
        </span>
      </GoLink>
    </div>
  );
}

function Statistics() {
  return (
    <section className="statistics">
      <h2>{copy.statistics}</h2>
      <dl className="stat-values">
        <div className="stat-rating">
          <dt>{copy.rating}</dt>
          <dd className="rating-value">{rating.numericLabel}<small>{rating.rankLabel}</small></dd>
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
  const report = useRef<HTMLDialogElement>(null);
  const [selected, setSelected] = useState<(typeof games)[number]>(games[0]);
  // The screenshot has names and results, but no real game IDs.
  function showGame(game: (typeof games)[number]) {
    setSelected(game);
    report.current?.showModal();
  }

  return (
    <section className="recent">
      <header className="recent-heading">
        <h2>{copy.recentGames}</h2>
        <GoLink path="/profile#game-history">{copy.allGames}<ChevronRight size={15} aria-hidden="true" /></GoLink>
      </header>
      <div className="game-list">
        {games.map((game) => (
          <button className="game-row" key={game.name} onClick={() => showGame(game)} type="button">
            <span aria-hidden="true" className="game-result">L</span>
            <span className="game-info"><strong>{game.name}</strong><small>9×9 · {game.timeControl} · {copy.lost}</small></span>
            <span className="game-change negative">{game.change}</span>
          </button>
        ))}
      </div>
      <dialog aria-label="Game preview" ref={report}>
        <form method="dialog"><button aria-label="Close" type="submit"><X size={21} /></button></form>
        <h3>{selected.name}</h3>
        <p>9×9 · {selected.timeControl} · {copy.lost}</p>
        {selected.change && <p className="negative">{selected.change}</p>}
        <GoLink path="/profile#game-history">{copy.allGames}<ArrowRight size={17} aria-hidden="true" /></GoLink>
      </dialog>
    </section>
  );
}

function Phone({ concept }: { concept: Concept }) {
  return (
    <article lang="en" aria-label={`GoStone · ${concept.name}`} className={`phone ${concept.id}`}>
      <StatusBar />
      <header className="phone-header">
        <GoLink path="/profile" className="profile-link" label="Profile: komi">
          <ProfileAvatar size="sm" style="urushi-mon" /><span>komi</span>
        </GoLink>
        <span className="wordmark">
          {/* eslint-disable-next-line @next/next/no-img-element -- The standalone Vite preview bundles these SVG masters. */}
          <img alt="" width={30} height={30} src={concept.id === "raster" ? darkLogo : lightLogo} />
          GoStone
        </span>
        <GoLink path="/friends" className="friends-link" label={copy.friends}>
          <UsersRound aria-hidden="true" size={22} strokeWidth={1.7} />
        </GoLink>
      </header>
      <div className="phone-content">
        <Practice concept={concept.id} />
        <Statistics />
        <RecentGames />
      </div>
      <footer className="phone-dock">
        <GoLink className="play-link" path="/play">
          <i aria-hidden="true" className="play-stone" />{copy.play}
          <ArrowRight className="play-arrow" size={21} strokeWidth={1.75} aria-hidden="true" />
        </GoLink>
        <nav aria-label={copy.appNavigation} className="tab-bar">
          {tabs.map(({ label, icon: Icon, path }) => {
            const glyph = <><span className="tab-icon"><Icon size={22} strokeWidth={path === "/" ? 2.1 : 1.65} aria-hidden="true" /></span><span>{label}</span></>;
            return path === "/" ? (
              <a aria-current="page" className="tab-link" href={`?concept=${concept.id}`} key={path}>{glyph}</a>
            ) : (
              <GoLink className="tab-link" path={path} key={path}>{glyph}</GoLink>
            );
          })}
        </nav>
      </footer>
      <span aria-hidden="true" className="home-indicator" />
    </article>
  );
}

function Gallery() {
  return (
    <main className="gallery">
      <header className="gallery-heading">
        <div><p>GoStone</p><h1>Vier Startseiten</h1></div>
        <p>Designstudie für iPhone</p>
      </header>
      <div className="gallery-grid">
        {concepts.map((concept) => (
          <section className="concept-card" key={concept.id}>
            <header>
              <div><h2>{concept.name}</h2><p>{concept.idea}</p></div>
              <a aria-label={`${concept.name} einzeln öffnen`} href={`?concept=${concept.id}`}><ArrowUpRight size={20} aria-hidden="true" /></a>
            </header>
            <Phone concept={concept} />
          </section>
        ))}
      </div>
    </main>
  );
}

const query = new URLSearchParams(location.search);
const selected = concepts.find((concept) => concept.id === query.get("concept"));
createRoot(document.getElementById("root")!).render(selected ? (
  <main className="single">
    {query.has("capture") ? null : <a className="back-link" href="?"><ArrowLeft size={18} aria-hidden="true" />Vergleich</a>}
    <Phone concept={selected} />
  </main>
) : <Gallery />);
