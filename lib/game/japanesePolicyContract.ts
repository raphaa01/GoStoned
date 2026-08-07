import type { ScoredOutcome } from "./scoreContract";
import type { Stone } from "./types";

export const JAPANESE_1989_CONTRACT_ID =
  "japanese-1989-gostone-contract-v1" as const;
export const JAPANESE_1989_RULES_PROFILE = "japanese-1989-gostone-v1" as const;
export const JAPANESE_SETTLEMENT_PROPOSAL_DIGEST_VERSION =
  "japanese-settlement-proposal-v1" as const;

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
 * The implementation contract for the active 1989 Japanese Rules profile.
 * The contract id identifies the semantic/replay kernel; the rules profile
 * identifies the exact tuple persisted with each game.
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
  rulesProfile: JAPANESE_1989_RULES_PROFILE,
  activation: "active",
  ruleset: "japanese",
  scoringMethod: "territory",
  scoringRule: "japanese-territory-with-prisoners",
  twoPassEffect: "stop",
  settlementRule: "mutual-life-death-and-territory-agreement",
  proposalDigest: Object.freeze({
    algorithm: "sha256",
    serializationVersion: JAPANESE_SETTLEMENT_PROPOSAL_DIGEST_VERSION,
    includes: Object.freeze([
      "game-id",
      "stopped-board-hash",
      "stopped-move-number",
      "revision",
      "rules-identity",
      "prisoner-ledger",
      "sorted-dead-stones",
      "sorted-neutral-region-seeds",
    ]),
  }),
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
