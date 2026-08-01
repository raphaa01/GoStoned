import "dotenv/config";
import assert from "node:assert/strict";
import { closePool } from "../lib/db";
import { repairPendingJapaneseSuggestion } from "../lib/game/japaneseGameService";

const gameId = process.env.KATAGO_SCORING_SMOKE_GAME_ID;
const playerKey = process.env.KATAGO_SCORING_SMOKE_PLAYER_KEY;
const allowed = process.env.KATAGO_SCORING_SMOKE_NONPRODUCTION === "I-understand-this-updates-a-disposable-game";

if (!allowed) {
  throw new Error("KataGo scoring smoke requires explicit disposable non-production authorization.");
}
if (!gameId || !/^[0-9a-f-]{36}$/i.test(gameId)) {
  throw new Error("KATAGO_SCORING_SMOKE_GAME_ID must identify a disposable pending-scoring game.");
}
if (!playerKey || !/^(?:user|guest):[A-Za-z0-9-]{1,128}$/.test(playerKey)) {
  throw new Error("KATAGO_SCORING_SMOKE_PLAYER_KEY must identify one participant.");
}

try {
  const state = await repairPendingJapaneseSuggestion(gameId, playerKey);
  assert.equal(state.phase, "scoring");
  assert.ok(state.scoring);
  assert.ok(state.scoring.suggestion);
  assert.equal(state.scoring.suggestion.status, "ready");
  assert.ok(state.scoring.suggestion.providerKind);
  console.log(JSON.stringify({
    ok: true,
    provider: state.scoring.suggestion.providerKind,
    engineVersion: state.scoring.suggestion.engineVersion,
    modelVersion: state.scoring.suggestion.modelVersion,
    status: state.scoring.suggestion.status,
  }));
} finally {
  await closePool();
}
