import { createHash } from "node:crypto";

const BOT_NAMES = [
  "Aiko",
  "Emi",
  "Hana",
  "Haru",
  "Kai",
  "Mika",
  "Nori",
  "Ren",
  "Sora",
  "Yuna",
] as const;

export function botDisplayName(seed: string): string {
  const index = createHash("sha256").update(seed).digest()[0] % BOT_NAMES.length;
  return BOT_NAMES[index];
}

export function deterministicUnit(seed: string): number {
  const bytes = createHash("sha256").update(seed).digest();
  return bytes.readUInt32BE(0) / 0x1_0000_0000;
}
