import type { TimeControlId } from "./types";

export type TimeControl = {
  id: TimeControlId;
  name: string;
  shortLabel: string;
  description: string;
  mainTimeSeconds: number;
  byoYomiPeriods: number;
  byoYomiSeconds: number;
};

export const TIME_CONTROLS: readonly TimeControl[] = [
  {
    id: "blitz",
    name: "Blitz",
    shortLabel: "5 min + 3×20 sec",
    description: "Fast games",
    mainTimeSeconds: 5 * 60,
    byoYomiPeriods: 3,
    byoYomiSeconds: 20,
  },
  {
    id: "rapid",
    name: "Rapid",
    shortLabel: "10 min + 5×30 sec",
    description: "Balanced",
    mainTimeSeconds: 10 * 60,
    byoYomiPeriods: 5,
    byoYomiSeconds: 30,
  },
  {
    id: "classic",
    name: "Classic",
    shortLabel: "20 min + 5×30 sec",
    description: "More thinking time",
    mainTimeSeconds: 20 * 60,
    byoYomiPeriods: 5,
    byoYomiSeconds: 30,
  },
] as const;

export function isTimeControlId(value: unknown): value is TimeControlId {
  return value === "blitz" || value === "rapid" || value === "classic";
}

export function getTimeControl(id: TimeControlId): TimeControl {
  const control = TIME_CONTROLS.find((candidate) => candidate.id === id);
  if (!control) throw new Error(`Unknown time control: ${id}`);
  return control;
}
