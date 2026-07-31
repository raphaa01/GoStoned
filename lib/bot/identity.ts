import { createHash } from "node:crypto";

export const BOT_NAMES = [
  "QuietPanda",
  "StoneDrifter",
  "BambooFox67",
  "HiddenKomi",
  "BlackLotus",
  "WhiteCrane",
  "SilentGoban4",
  "KoHunter",
  "MistyCorner6",
  "CedarStone",
  "CalmDragon67",
  "LunarKyu9",
  "RiverTesuji",
  "EmptyTriangle",
  "GentleAtari",
  "CloudyJoseki",
  "SenteFox",
  "MoyoMaker7",
  "StoneHarbor",
  "ShusakuFan",
  "KoiPlayer5",
  "WillowKomi",
  "NorthStarGo",
  "SlowBadger",
  "TeaAndTesuji",
  "QuietRaven",
  "PineNeedle0",
  "CornerKeeper3",
  "MidnightGoban",
  "SoftSente6",
  "KoalaKyu",
  "JadeStone",
  "RedMapleGo",
  "PatientTiger2",
  "MoonlitMoyo",
  "SimpleJoseki",
  "WanderingStone",
  "SnowCrane12",
  "LuckyAtari",
  "ForestDan",
  "SmallKnight2",
  "CalmKitsune",
  "ThirdLine",
  "BambooShade",
  "QuietInfluence4",
  "StoneLantern",
  "GentleKo11",
  "DistantStar",
  "AutumnGoban3",
  "LastLiberty",
] as const;

export function botDisplayName(seed: string): string {
  const index = createHash("sha256").update(seed).digest()[0] % BOT_NAMES.length;
  return BOT_NAMES[index];
}

export function deterministicUnit(seed: string): number {
  const bytes = createHash("sha256").update(seed).digest();
  return bytes.readUInt32BE(0) / 0x1_0000_0000;
}
