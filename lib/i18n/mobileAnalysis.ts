import type { Locale } from "./config";

const english = {
  preview: "Quick review",
  quality: "Improving details",
  previewNote: "The first moves are ready. KataGo continues locally in the background.",
  qualityNote: "The position estimates are ready. KataGo now checks the most important moves.",
  noAlternatives: "No searched move recommendation is available for this move yet.",
  bestMove: "Best move",
  provisional: "Preliminary",
  startNote: "The first moves appear as a quick review, with a move recommendation and preliminary rating. KataGo then checks important moves in more detail locally.",
  progress: "{done} of {total} moves",
};

const copies: Record<Locale, typeof english> = {
  en: english,
  de: {
    preview: "Schnellauswertung",
    quality: "Details werden verbessert",
    previewNote: "Die ersten Züge sind bereit. KataGo rechnet lokal im Hintergrund weiter.",
    qualityNote: "Die Stellungsbewertungen sind bereit. KataGo prüft jetzt die wichtigsten Züge genauer.",
    noAlternatives: "Für diesen Zug liegt noch keine geprüfte Zugempfehlung vor.",
    bestMove: "Bester Zug",
    provisional: "Vorläufig",
    startNote: "Die ersten Züge erscheinen als Schnellauswertung mit Zugempfehlung und vorläufiger Bewertung. Danach prüft KataGo wichtige Züge lokal genauer.",
    progress: "{done} von {total} Zügen",
  },
  fr: english,
  es: english,
  zh: english,
  ja: english,
  ko: english,
  ky: english,
};

export function getMobileAnalysisCopy(locale: Locale) {
  return copies[locale];
}
