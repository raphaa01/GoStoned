import {
  CURRENT_CHINESE_RULES_PROFILE,
  DEFAULT_MATCH_RULES,
  resolveRulesConfiguration,
  type ResolvedRulesConfiguration,
} from "./rulesPolicy";

export const NEW_GAME_RULES_PROFILE_ENV = "GOSTONE_NEW_GAME_RULES_PROFILE" as const;

/**
 * Japanese is the creation default in every environment. Operations may use
 * the exact historical Chinese profile as a non-destructive rollback switch;
 * no existing game's persisted tuple is ever changed by this setting.
 */
export function newGameRulesConfiguration(
  rawProfile = process.env[NEW_GAME_RULES_PROFILE_ENV],
): ResolvedRulesConfiguration {
  if (rawProfile === undefined || rawProfile === "" || rawProfile === DEFAULT_MATCH_RULES.rulesProfile) {
    return resolveRulesConfiguration(DEFAULT_MATCH_RULES);
  }
  if (rawProfile === CURRENT_CHINESE_RULES_PROFILE) {
    return resolveRulesConfiguration({
      ruleset: "chinese",
      rulesProfile: CURRENT_CHINESE_RULES_PROFILE,
      scoringMethod: "area",
      komi: 7.5,
      handicap: 0,
    });
  }
  throw new Error(
    `${NEW_GAME_RULES_PROFILE_ENV} must be japanese-1989-gostone-v1 or ${CURRENT_CHINESE_RULES_PROFILE}.`,
  );
}
