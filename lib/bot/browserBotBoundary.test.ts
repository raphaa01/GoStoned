import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import {
  browserBotTargetForQueue,
  isBrowserBotFallbackReady,
} from "@/lib/matchmaking/matchmakingService";

const source = async (...parts: string[]) => readFile(join(process.cwd(), ...parts), "utf8");

test("normal bot gameplay never dispatches KataGo or Modal work", async () => {
  const paths = [
    ["app", "api", "matchmaking", "route.ts"],
    ["app", "api", "games", "[gameId]", "moves", "route.ts"],
    ["app", "api", "games", "[gameId]", "scoring", "confirm", "route.ts"],
    ["app", "api", "games", "[gameId]", "scoring", "resume", "route.ts"],
    ["app", "api", "games", "[gameId]", "browser-bot", "route.ts"],
    ["lib", "bot", "browserBotService.ts"],
  ];
  for (const path of paths) {
    const file = await source(...path);
    assert.doesNotMatch(file, /lib\/katago\/dispatch|dispatchBotTurnIfNeeded|KATAGO_DISPATCH_URL|Modal/i);
  }
  const matchmaking = await source("app", "api", "matchmaking", "route.ts");
  assert.match(matchmaking, /allowOnDemandBot:\s*true/);
  const matchmakingService = await source("lib", "matchmaking", "matchmakingService.ts");
  assert.match(matchmakingService, /CALIBRATED_BOT_FALLBACK_SECONDS\s*=\s*10/);
  assert.match(matchmakingService, /GOSTONE_BOT_MODEL\.modelVersion/);
  assert.doesNotMatch(await source("workers", "katago", "index.ts"), /runBotLoop|activeBotGame/);
  assert.doesNotMatch(await source("workers", "katago", "once.ts"), /case\s+["']bot["']|runBotOnce/);
  assert.doesNotMatch(await source("modal_worker", "app.py"), /process_bot|["']bot["']\s*:/);
});

test("the ten-second browser AI fallback serves guests and rated accounts", () => {
  const now = new Date("2026-08-12T12:00:10.000Z");
  const fallbackNotBefore = new Date("2026-08-12T12:00:10.000Z");
  assert.equal(isBrowserBotFallbackReady({
    allowOnDemandBot: true,
    status: "waiting",
    matchPool: "guest-unrated",
    ratingSnapshot: null,
    ratingDeviationSnapshot: null,
    fallbackNotBefore,
    now,
  }), true);
  assert.equal(isBrowserBotFallbackReady({
    allowOnDemandBot: true,
    status: "waiting",
    matchPool: "registered-rated",
    ratingSnapshot: 1460,
    ratingDeviationSnapshot: 180,
    fallbackNotBefore,
    now,
  }), true);
  assert.equal(isBrowserBotFallbackReady({
    allowOnDemandBot: true,
    status: "waiting",
    matchPool: "guest-unrated",
    fallbackNotBefore: new Date("2026-08-12T12:00:11.000Z"),
    now,
  }), false);
  assert.deepEqual(browserBotTargetForQueue({
    ratingSnapshot: null,
    ratingDeviationSnapshot: null,
  }), { rating: 1200, ratingDeviation: 350 });
  assert.deepEqual(browserBotTargetForQueue({
    ratingSnapshot: 1460,
    ratingDeviationSnapshot: 180,
  }), { rating: 1460, ratingDeviation: 180 });
});

test("browser AI bindings accept both account and guest player identities", async () => {
  const schema = await source("db", "schema.sql");
  const migration = await source("db", "migrations", "034_guest_browser_bot_bindings.sql");
  for (const sql of [schema, migration]) {
    assert.match(
      sql,
      /human_player_key LIKE 'user:%' OR human_player_key LIKE 'guest:%'/,
    );
  }
  assert.match(
    migration,
    /DROP CONSTRAINT IF EXISTS game_browser_bot_bindings_human_player_key_check/,
  );
  assert.match(
    migration,
    /VALIDATE CONSTRAINT game_browser_bot_bindings_human_player_key_check/,
  );
});

test("the Japanese rulebook handoff names the exact proposal-only model boundary", async () => {
  const agents = await source("AGENTS.md");
  const handoff = await source("docs", "browser-bot-v1.md");
  assert.match(agents, /GOSTONE_BOT_MODEL/);
  assert.match(agents, /proposal-only/);
  assert.match(handoff, /gostone-japanese-v4\.onnx/);
  assert.match(handoff, /japaneseScoring\.ts/);
  assert.match(handoff, /Modal[\s\S]*nicht[\s\S]*aufrufen/);
});
