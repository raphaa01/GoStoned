import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

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
  assert.doesNotMatch(await source("workers", "katago", "index.ts"), /runBotLoop|activeBotGame/);
  assert.doesNotMatch(await source("workers", "katago", "once.ts"), /case\s+["']bot["']|runBotOnce/);
  assert.doesNotMatch(await source("modal_worker", "app.py"), /process_bot|["']bot["']\s*:/);
});

test("the Japanese rulebook handoff names the exact proposal-only model boundary", async () => {
  const agents = await source("AGENTS.md");
  const handoff = await source("docs", "browser-bot-v1.md");
  assert.match(agents, /GOSTONE_BOT_MODEL/);
  assert.match(agents, /proposal-only/);
  assert.match(handoff, /gostone-japanese-v1\.onnx/);
  assert.match(handoff, /japaneseScoring\.ts/);
  assert.match(handoff, /Modal[\s\S]*nicht[\s\S]*aufrufen/);
});
