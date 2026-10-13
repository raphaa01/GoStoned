import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const source = (file: string) => readFile(path.join(root, file), "utf8");

test("finished game links expose a read-only public replay with server-only link access", async () => {
  const [service, view, replay, migration, access, schema] = await Promise.all([
    source("lib/game/sharedGameService.ts"),
    source("components/game/SharedGameView.tsx"),
    source("components/game/FinishedGameBoard.tsx"),
    source("db/migrations/040_game_share_links.sql"),
    source("db/migrations/055_game_share_server_access.sql"),
    source("db/schema.sql"),
  ]);
  assert.match(service, /g\.status = 'finished'/);
  assert.match(service, /Only finished games can be shared/);
  assert.match(service, /row\.black_player_key !== playerKey && row\.white_player_key !== playerKey/);
  assert.match(view, /FinishedGameBoard/);
  assert.match(replay, /disabled/);
  assert.doesNotMatch(view, /AnalysisReview|\/analysis|onIntersectionClick=\{[^}]*fetch/);
  assert.match(migration, /token UUID NOT NULL UNIQUE DEFAULT gen_random_uuid\(\)/);
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS game_share_links/);
  assert.match(access, /GRANT SELECT, INSERT, UPDATE ON game_share_links TO gostone_app/);
  assert.match(access, /FOR ALL TO gostone_app USING \(true\) WITH CHECK \(true\)/);
  assert.doesNotMatch(access, /GRANT[^;]+TO (?:anon|authenticated|PUBLIC)/);
});
