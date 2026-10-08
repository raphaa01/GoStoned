// One identity for the uploaded v5 bundle. Only mobile builds package these files.
export const COACH_MODEL = {
  contract: "gostone-coach-v5",
  baseUrl: "/coach/",
  files: {
    "coach.onnx": "6194b5dad83f7c9a5f188cf2a92c02708b1d944250af79dbc85bbb494fe4d47f",
    "schema.json": "c3e9c8849f527b5fbeb53a36e54905d604d202c0bfd06f6f9f304706e6052532",
    "tokenizer.json": "330ecc50c389950ac61bf98391fc2ffb59603a1cd05ce4237cbfac49c9cf2aca",
    "manifest.json": "dd6d2b39d358ad20aba2ae8b6283ce2e95175aad8b43ce696dfb04e00a542f20",
  },
} as const;

export const COACH_REASONS = ["good", "uncertain", "score_loss", "capture", "save", "connect", "liberties", "enemy_atari", "own_threat", "group_loss", "opening_corner", "opening_side", "cut", "weak_group", "eyes", "direction", "pass", "sacrifice", "tenuki", "human_insight"] as const;
export type CoachReason = typeof COACH_REASONS[number];
export type CoachJudgement = "good" | "inaccuracy" | "mistake" | "blunder" | "uncertain";
export const COACH_JUDGEMENTS: readonly CoachJudgement[] = ["good", "inaccuracy", "mistake", "blunder", "uncertain"];
