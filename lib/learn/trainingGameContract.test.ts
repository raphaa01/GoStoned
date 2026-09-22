import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const component = readFileSync(
  new URL("../../components/learn/TrainingGame.tsx", import.meta.url),
  "utf8",
);
const scoreRoute = readFileSync(
  new URL("../../app/api/training-game/score/route.ts", import.meta.url),
  "utf8",
);
const scoring = readFileSync(new URL("./trainingGameScoring.ts", import.meta.url), "utf8");

test("practice games use the versioned browser model without entering saved-game flows", () => {
  assert.match(component, /generateBrowserBotMove/);
  assert.match(component, /proposeJapaneseSettlement/);
  assert.match(component, /GOSTONE_BOT_MODEL/);
  assert.doesNotMatch(component, /\/api\/games|\/analysis|matchmaking/);
  assert.doesNotMatch(scoreRoute, /@\/lib\/db|INSERT INTO|UPDATE games/);
});

test("practice settlement stays proposal-only until the server rulebook scores it", () => {
  assert.match(scoreRoute, /scoreTrainingSettlement/);
  assert.match(scoring, /authority !== "proposal-only"/);
  assert.match(scoring, /scoreJapaneseTerritory/);
  assert.match(scoring, /GOSTONE_BOT_MODEL\.artifactSha256/);
});
