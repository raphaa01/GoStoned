import type { ScoredOutcome } from "./scoreContract";
import type { Stone } from "./types";

export const JAPANESE_1989_CONTRACT_ID =
  "japanese-1989-gostone-inactive-v1" as const;

export type Japanese1989ContractOutcome =
  | ScoredOutcome
  | Readonly<{ kind: "resignation"; winner: Stone }>
  | Readonly<{ kind: "no-result"; reason: "cyclic-repetition" }>
  | Readonly<{
      kind: "double-loss";
      reason:
        | "post-stop-result-affecting-valid-move-deadlock"
        | "unresolved-stone-displacement";
    }>
  | Readonly<{ kind: "forfeit"; winner: Stone; reason: "rules-violation" }>;

/**
 * An inactive implementation contract for the 1989 Japanese Rules of Go.
 * It is intentionally separate from the persisted RULES_POLICIES registry:
 * these semantics are not playable until their full service and persistence
 * lifecycle exists.
 *
 * @see https://www.nihonkiin.or.jp/match/kiyaku/zenbun.htm
 * @see https://www.nihonkiin.or.jp/match/kiyaku/kiyaku06.htm
 * @see https://www.nihonkiin.or.jp/match/kiyaku/kiyaku07-2.html
 * @see https://www.nihonkiin.or.jp/match/kiyaku/kiyaku09.html
 * @see https://www.nihonkiin.or.jp/match/kiyaku/kiyaku11-12.html
 * @see https://www.nihonkiin.or.jp/match/kiyaku/kiyaku13-14.html
 * @see https://www.nihonkiin.or.jp/match/kiyaku/gaiyo-00.html
 * @see https://www.nihonkiin.or.jp/english/topics/02/topics2002_10.htm
 */
export const JAPANESE_1989_POLICY_CONTRACT = Object.freeze({
  contractId: JAPANESE_1989_CONTRACT_ID,
  activation: "inactive",
  ruleset: "japanese",
  scoringMethod: "territory",
  scoringRule: "japanese-territory-with-prisoners",
  twoPassEffect: "stop",
  settlementRule: "mutual-life-death-and-territory-agreement",
  automatedLifeDeathAdjudication: false,
  normalPlayKoRule: "simple-ko",
  koBanClearedBy: "prohibited-player-plays-elsewhere",
  passClearsNormalPlayKoBan: false,
  postStopLifeDeathKo: Object.freeze({
    recaptureRequires: "pass-for-the-specific-ko",
    passScope: "one-ko",
  }),
  cyclicRepetitionRule: "mutual-no-result",
  cyclicRepetitionIsIllegalMove: false,
  resumeTurnRule: "opponent-first",
  matchConditions: Object.freeze({
    authority: "gostone-initial-conditions-outside-1989-rules",
    defaultKomi: 6.5,
    supportedKomi: Object.freeze([6.5]),
    supportedHandicaps: Object.freeze([0]),
  }),
} as const);
