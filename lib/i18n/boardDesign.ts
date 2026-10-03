import type { Locale } from "./config";
import type { BoardDesignId } from "../boardDesign";

const enNames: Record<BoardDesignId, string> = {
  default: "Default", "light-oak": "Light oak", "dark-slate": "Dark slate", "white-porcelain": "White porcelain",
  sage: "Sage", bordeaux: "Bordeaux", "ink-flow": "Ink flow", orbit: "Orbit", "glacier-glass": "Glacier glass", kintsugi: "Kintsugi", volcano: "Volcano",
};
const deNames: Record<BoardDesignId, string> = {
  default: "Default", "light-oak": "Helle Eiche", "dark-slate": "Dunkler Schiefer", "white-porcelain": "Weißes Porzellan",
  sage: "Salbeigrün", bordeaux: "Bordeaux", "ink-flow": "Tintenfluss", orbit: "Orbit", "glacier-glass": "Gletscherglas", kintsugi: "Kintsugi", volcano: "Vulkan",
};

export function getBoardDesignCopy(locale: Locale) {
  return locale === "de" ? {
    title: "Brettdesign", names: deNames, selected: "Ausgewählt", available: "Freigeschaltet", soon: "Coming soon",
    unlock: (wins: number) => `Ab ${wins} Siegen`, progress: (wins: number) => `${wins} Siege`,
    loading: "Designs werden geladen…", saving: "Wird gespeichert…", saved: "Brettdesign gespeichert.",
    failed: "Das Brettdesign konnte nicht gespeichert werden.", loadFailed: "Die Designs konnten nicht geladen werden.", retry: "Erneut versuchen", close: "Schließen",
  } : {
    title: "Board design", names: enNames, selected: "Selected", available: "Unlocked", soon: "Coming soon",
    unlock: (wins: number) => `Unlocks at ${wins} wins`, progress: (wins: number) => `${wins} wins`,
    loading: "Loading designs…", saving: "Saving…", saved: "Board design saved.",
    failed: "The board design could not be saved.", loadFailed: "The designs could not be loaded.", retry: "Try again", close: "Close",
  };
}
