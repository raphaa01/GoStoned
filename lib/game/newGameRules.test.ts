import assert from "node:assert/strict";
import test from "node:test";
import { JAPANESE_1989_RULES_PROFILE } from "./japanesePolicyContract";
import {
  NEW_GAME_RULES_PROFILE_ENV,
  newGameRulesConfiguration,
} from "./newGameRules";
import { CURRENT_CHINESE_RULES_PROFILE } from "./rulesPolicy";

test("new games default to the only visible Japanese profile", () => {
  const rules = newGameRulesConfiguration(undefined);
  assert.equal(rules.rulesProfile, JAPANESE_1989_RULES_PROFILE);
  assert.equal(rules.ruleset, "japanese");
  assert.equal(rules.scoringMethod, "territory");
  assert.equal(rules.komi, 6.5);
  assert.equal(rules.handicap, 0);
});

test("operations retain one exact non-destructive Chinese rollback switch", () => {
  const rules = newGameRulesConfiguration(CURRENT_CHINESE_RULES_PROFILE);
  assert.equal(rules.rulesProfile, CURRENT_CHINESE_RULES_PROFILE);
  assert.equal(rules.ruleset, "chinese");
  assert.throws(
    () => newGameRulesConfiguration("legacy-immediate-area"),
    new RegExp(NEW_GAME_RULES_PROFILE_ENV),
  );
});
