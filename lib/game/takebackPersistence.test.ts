import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const schema = readFileSync(join(process.cwd(), "db/schema.sql"), "utf8");
const migration = readFileSync(
  join(process.cwd(), "db/migrations/037_japanese_rules_and_takebacks.sql"),
  "utf8",
);
const service = readFileSync(join(process.cwd(), "lib/game/gameService.ts"), "utf8");

test("takebacks are pending, participant-bound, and remove only the exact latest move", () => {
  for (const sql of [schema, migration]) {
    assert.ok(sql.includes("game_takeback_requests"));
    assert.ok(sql.includes("requested_by_color"));
    assert.ok(sql.includes("ENABLE ROW LEVEL SECURITY"));
    assert.ok(sql.includes("REVOKE ALL ON game_takeback_requests FROM anon"));
    assert.ok(sql.includes("REVOKE ALL ON game_takeback_requests FROM authenticated"));
  }
  assert.ok(service.includes("latest.color !== requester"));
  assert.ok(service.includes("Only the opponent can answer this request."));
  assert.ok(service.includes("DELETE FROM moves WHERE game_id = $1 AND move_number = $2"));
  assert.ok(service.includes("to_move = $2"));
  assert.ok(service.includes("takeback_pending"));
});
