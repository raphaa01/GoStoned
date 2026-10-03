export const BOARD_DESIGNS = [
  { id: "default", wins: 0, preview: null },
  { id: "light-oak", wins: 0, preview: "01-Helle-Eiche.jpg" },
  { id: "dark-slate", wins: 10, preview: "02-Dunkler-Schiefer.jpg" },
  { id: "white-porcelain", wins: 20, preview: "03-Weisses-Porzellan.jpg" },
  { id: "sage", wins: 30, preview: "04-Salbeigruen.jpg" },
  { id: "bordeaux", wins: 50, preview: "05-Bordeaux.jpg" },
  { id: "ink-flow", wins: null, preview: "06-Tintenfluss.jpg" },
  { id: "orbit", wins: null, preview: "07-Orbit.jpg" },
  { id: "glacier-glass", wins: null, preview: "08-Gletscherglas.jpg" },
  { id: "kintsugi", wins: null, preview: "09-Kintsugi.jpg" },
  { id: "volcano", wins: null, preview: "10-Vulkan.jpg" },
] as const;

export type BoardDesignId = (typeof BOARD_DESIGNS)[number]["id"];
export type BoardDesignPreference = { design: BoardDesignId; wins: number };

export function isBoardDesignId(value: unknown): value is BoardDesignId {
  return BOARD_DESIGNS.some((design) => design.id === value);
}

export function isBoardDesignUnlocked(id: BoardDesignId, wins: number): boolean {
  const design = BOARD_DESIGNS.find((entry) => entry.id === id)!;
  return design.wins !== null && Number.isSafeInteger(wins) && wins >= design.wins;
}

export function parseBoardDesignUpdate(body: Record<string, unknown>): BoardDesignId {
  if (Object.keys(body).length !== 1 || !isBoardDesignId(body.design)) {
    throw new TypeError("Invalid board design.");
  }
  return body.design;
}

export function parseBoardDesignPreference(body: unknown): BoardDesignPreference {
  if (!body || typeof body !== "object" || !("design" in body) || !("wins" in body)
    || !isBoardDesignId(body.design) || typeof body.wins !== "number"
    || !isBoardDesignUnlocked(body.design, body.wins)) {
    throw new TypeError("Invalid board design preference.");
  }
  return { design: body.design, wins: body.wins };
}
