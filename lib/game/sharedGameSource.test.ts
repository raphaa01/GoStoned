import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const source = (file: string) => readFile(path.join(root, file), "utf8");

test("finished game links expose only a static public board", async () => {
  const [service, view, migration, schema] = await Promise.all([
    source("lib/game/sharedGameService.ts"),
    source("components/game/SharedGameView.tsx"),
    source("db/migrations/040_game_share_links.sql"),
    source("db/schema.sql"),
  ]);
  assert.match(service, /g\.status = 'finished'/);
  assert.match(service, /Only finished games can be shared/);
  assert.match(service, /row\.black_player_key !== playerKey && row\.white_player_key !== playerKey/);
  assert.match(view, /disabled/);
  assert.doesNotMatch(view, /AnalysisReview|\/analysis|onIntersectionClick=\{[^}]*fetch/);
  assert.match(migration, /token UUID NOT NULL UNIQUE DEFAULT gen_random_uuid\(\)/);
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS game_share_links/);
});
