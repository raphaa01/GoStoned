import type { Locale } from "./config";

const COPY = {
  de: {
    tag: "DEV",
    account: "Developer-Konto",
    learningAccess: "Testzugang: Alle Lektionen sind geöffnet. Dein Fortschritt zählt weiterhin nur gelöste Lektionen.",
  },
  en: {
    tag: "DEV",
    account: "Developer account",
    learningAccess: "Test access: All lessons are open. Your progress still counts only completed lessons.",
  },
};

export function developerCopy(locale: Locale) {
  return locale === "de" ? COPY.de : COPY.en;
}
