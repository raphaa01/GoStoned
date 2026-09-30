export const BOARD_PLACEMENT_PREFERENCES = ["zoom", "direct"] as const;

export type BoardPlacementPreference = typeof BOARD_PLACEMENT_PREFERENCES[number];

export const DEFAULT_BOARD_PLACEMENT: BoardPlacementPreference = "zoom";

export function parseBoardPlacementPreference(value: unknown): BoardPlacementPreference {
  if (value !== "zoom" && value !== "direct") {
    throw new RangeError("Board placement preference is invalid.");
  }
  return value;
}
