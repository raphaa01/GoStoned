import assert from "node:assert/strict";
import test from "node:test";
import { newGameRulesConfiguration } from "./newGameRules";

test("creates Japanese games by default and supports one non-destructive Chinese rollback", () => {
  assert.deepEqual(newGameRulesConfiguration(undefined), {
    ruleset: "japanese",
    rulesProfile: "japanese-1989-gostone-v1",
    scoringMethod: "territory",
    komi: 6.5,
    handicap: 0,
    policy: newGameRulesConfiguration(undefined).policy,
  });
  assert.deepEqual(newGameRulesConfiguration("chinese-2002-gostone-v1"), {
    ruleset: "chinese",
    rulesProfile: "chinese-2002-gostone-v1",
    scoringMethod: "area",
    komi: 7.5,
    handicap: 0,
    policy: newGameRulesConfiguration("chinese-2002-gostone-v1").policy,
  });
  assert.throws(() => newGameRulesConfiguration("legacy-immediate-area"));
  assert.throws(() => newGameRulesConfiguration("japanese-latest"));
});
