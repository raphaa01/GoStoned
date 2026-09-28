import type { Locale } from "./config";

const english = {
  preview: "Quick review",
  quality: "Improving details",
  previewNote: "The first moves are ready. KataGo continues locally in the background.",
  qualityNote: "The complete review is usable while KataGo refines each position.",
  progress: "{done} of {total} moves",
};

const copies: Record<Locale, typeof english> = {
  en: english,
  de: {
    preview: "Schnellauswertung",
    quality: "Details werden verbessert",
    previewNote: "Die ersten Züge sind bereit. KataGo rechnet lokal im Hintergrund weiter.",
    qualityNote: "Die vollständige Auswertung ist bereits nutzbar, während KataGo die Stellungen verfeinert.",
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
