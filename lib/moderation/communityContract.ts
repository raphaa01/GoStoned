export const COMMUNITY_RULES_VERSION = "2026-10-30";
export const COMMUNITY_RULES_HEADER = "x-gostone-community-rules";
export const MODERATION_ACTIONS = ["dismiss", "remove_chat", "suspend_7d", "restore"] as const;
export type ModerationAction = (typeof MODERATION_ACTIONS)[number];
export function isModerationAction(value: unknown): value is ModerationAction {
  return typeof value === "string" && MODERATION_ACTIONS.includes(value as ModerationAction);
}
