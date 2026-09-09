import type { GameState } from "@/lib/game/types";
import type { Dictionary } from "./dictionary";

type RulesParameters = Pick<
  GameState,
  "ruleset" | "scoringMethod" | "komi" | "handicap"
>;

export function localizedRulesSummary(
  game: RulesParameters,
  dictionary: Dictionary,
): string {
  const rules = dictionary.rules;
  const parts = [
    rules.rulesets[game.ruleset],
    rules.methods[game.scoringMethod],
    `${game.komi} ${rules.komi}`,
  ];
  if (game.handicap > 0) parts.push(`${rules.handicap} ${game.handicap}`);
  return parts.join(" · ");
}
