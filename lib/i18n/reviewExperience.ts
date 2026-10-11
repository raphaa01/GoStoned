import type { Locale } from "./config";

const en = {
  title: "Game review", back: "Back", previous: "Previous", next: "Next", first: "First move", last: "Last move",
  done: "Done", summary: "Game summary", accuracy: "Accuracy", winner: "Winner", returnToAnalysis: "Back to analysis",
  initial: "Starting position", reviewed: "{done} of {total} moves",
  partial: "Preliminary · {done} of {total} moves", preliminary: "Preliminary",
  accuracyHelp: "GoStone accuracy: average of 100 × exp(−max(point loss / 6, win-probability loss × 4)) over evaluated moves. This is a GoStone estimate, not a Chess.com rating.",
  capturedOne: "{move} captures one stone.", captured: "{move} captures {count} stones.", connected: "{move} connects separate groups.",
  atari: "After {move}, this group has only one liberty and is in atari.",
  saves: "{move} gives the group more liberties and gets it out of atari.",
};

const de: typeof en = {
  title: "Partie-Analyse", back: "Zurück", previous: "Zurück", next: "Nächste", first: "Zum Anfang", last: "Zum Ende",
  done: "Fertig", summary: "Partieübersicht", accuracy: "Genauigkeit", winner: "Gewonnen", returnToAnalysis: "Zur Analyse",
  initial: "Startposition", reviewed: "{done} von {total} Zügen",
  partial: "Vorläufig · {done} von {total} Zügen", preliminary: "Vorläufig",
  accuracyHelp: "GoStone-Genauigkeit: Mittelwert aus 100 × exp(−max(Punktverlust / 6, Gewinnwahrscheinlichkeitsverlust × 4)) über bewertete Züge. Eine GoStone-Schätzung, keine Chess.com-Wertung.",
  capturedOne: "{move} schlägt einen Stein.", captured: "{move} schlägt {count} Steine.", connected: "{move} verbindet getrennte Gruppen.",
  atari: "Nach {move} hat diese Gruppe nur eine Freiheit und steht im Atari.",
  saves: "{move} gibt der Gruppe mehr Freiheiten und löst das Atari auf.",
};

export function getReviewExperienceCopy(locale: Locale): typeof en {
  return locale === "de" ? de : en;
}
