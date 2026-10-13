import type { Locale } from "./config";

const en = {
  title: "Play on one device", subtitle: "Unrated · Not saved", start: "Start game",
  clock: "Go clock", startClock: "Start clock", back: "Back", toPlay: "to play",
  pause: "Pause", resume: "Resume", reset: "Reset", tapStart: "Tap to start", tapSwitch: "Tap to switch",
  paused: "Paused", wins: "wins", newGame: "Play again", exit: "Leave game",
  exitTitle: "Leave this game?", exitDescription: "This game will be discarded.",
  resignTitle: "Resign?", resignDescription: "The other color wins.",
  resetTitle: "Reset clock?", resetDescription: "Both clocks return to the selected time.",
  confirmBlack: "Black agrees", confirmWhite: "White agrees",
  scoringHint: "Mark dead groups, then both confirm.", dead: "Dead groups", neutral: "Neutral area",
  scoringFailed: "Scoring unavailable. Check your connection and try again.", retry: "Retry",
  moveLimit: "Move limit reached. Pass to finish the game.",
};
type LocalPlayCopy = { [Key in keyof typeof en]: string };
const de: LocalPlayCopy = {
  title: "Auf einem Gerät spielen", subtitle: "Ungewertet · Nicht gespeichert", start: "Spiel starten",
  clock: "Go-Uhr", startClock: "Uhr starten", back: "Zurück", toPlay: "am Zug",
  pause: "Pause", resume: "Fortsetzen", reset: "Zurücksetzen", tapStart: "Tippen zum Starten", tapSwitch: "Tippen zum Wechseln",
  paused: "Pausiert", wins: "gewinnt", newGame: "Noch einmal spielen", exit: "Partie verlassen",
  exitTitle: "Partie verlassen?", exitDescription: "Diese Partie wird verworfen.",
  resignTitle: "Aufgeben?", resignDescription: "Die andere Farbe gewinnt.",
  resetTitle: "Uhr zurücksetzen?", resetDescription: "Beide Uhren werden auf die gewählte Zeit zurückgesetzt.",
  confirmBlack: "Schwarz bestätigt", confirmWhite: "Weiß bestätigt",
  scoringHint: "Tote Gruppen markieren, dann beide bestätigen.", dead: "Tote Gruppen", neutral: "Neutrales Gebiet",
  scoringFailed: "Wertung nicht erreichbar. Verbindung prüfen und erneut versuchen.", retry: "Erneut versuchen",
  moveLimit: "Zuglimit erreicht. Passe, um die Partie zu beenden.",
};
export function getLocalPlayCopy(locale: Locale): LocalPlayCopy {
  return locale === "de" ? de : en;
}
