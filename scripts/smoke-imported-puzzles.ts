import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { closePool, getPool, query } from "../lib/db";
import { getDatabaseUrl, isUnambiguousLocalDatabase } from "../lib/env";
import { assertSmokeDatabaseIdentity } from "../lib/smokeDatabase";
import { attemptImportedPuzzle, readImportedPuzzleHub } from "../lib/puzzles/importedService";
import { IMPORTED_PUZZLES, IMPORTED_CATALOG_VERSION } from "../lib/puzzles/importedCatalog";

async function main() {
  assert.ok(isUnambiguousLocalDatabase(getDatabaseUrl()), "Imported puzzle smoke requires a local test database.");
  await assertSmokeDatabaseIdentity(getPool());
  const player = `user:${randomUUID()}`;
  const archivedBefore = await query<{count:string}>("SELECT count(*)::text AS count FROM puzzles WHERE engine_version <> $1", [IMPORTED_CATALOG_VERSION]);
  try {
    const hub = await readImportedPuzzleHub(player, "practice");
    assert.equal(hub.puzzles.length, 61);
    assert.ok(hub.puzzles.every((puzzle)=>puzzle.solution === null && puzzle.variationProgress.length === 0));
    assert.equal(hub.puzzles[0].rankKyu, 30);
    const secondHub = await readImportedPuzzleHub(player, "practice");
    assert.deepEqual(secondHub,hub,"catalog initialization is idempotent");
    const puzzle = IMPORTED_PUZZLES.find((candidate)=>candidate.paths[1].line.length === 6)!;
    let revision=0;
    const wrong=puzzle.paths[1].line;
    const opening=await attemptImportedPuzzle(puzzle.id,player,{...wrong[0],revision},true);
    assert.equal(opening.outcome,"continue");
    revision=opening.variationRevision;
    const reloaded=(await readImportedPuzzleHub(player,"practice")).puzzles.find((candidate)=>candidate.id===puzzle.id)!;
    assert.deepEqual(reloaded.variationProgress,wrong.slice(0,2));
    await assert.rejects(attemptImportedPuzzle(puzzle.id,player,{...wrong[2],revision:0},true),/puzzle changed/i);
    const undone=await attemptImportedPuzzle(puzzle.id,player,{x:-1,y:-1,revision},true);
    assert.deepEqual(undone.variationProgress,[]);
    revision=undone.variationRevision;
    for(const ply of wrong.filter((ply)=>ply.color===puzzle.toPlay)) {
      const result=await attemptImportedPuzzle(puzzle.id,player,{...ply,revision},true);
      revision=result.variationRevision;
      assert.equal(result.outcome,ply===wrong[4]?"retry":"continue");
    }
    for(const ply of puzzle.paths[0].line.filter((ply)=>ply.color===puzzle.toPlay)) {
      const result=await attemptImportedPuzzle(puzzle.id,player,{...ply,revision},true);
      revision=result.variationRevision;
    }
    const finished=(await readImportedPuzzleHub(player,"practice")).puzzles.find((candidate)=>candidate.id===puzzle.id)!;
    assert.equal(finished.solved,true);
    assert.equal(finished.firstAttemptCorrect,false);
    const isolated=(await readImportedPuzzleHub(`user:${randomUUID()}`,"practice")).puzzles.find((candidate)=>candidate.id===puzzle.id)!;
    assert.equal(isolated.solved,false);
    const daily=await readImportedPuzzleHub(player,"daily");
    assert.equal(daily.puzzles.length,1);
    assert.equal(daily.dailyCycleLength,61);
    const archivedAfter=await query<{count:string}>("SELECT count(*)::text AS count FROM puzzles WHERE engine_version <> $1", [IMPORTED_CATALOG_VERSION]);
    assert.deepEqual(archivedAfter.rows,archivedBefore.rows,"legacy puzzles are preserved");
    console.log("Imported puzzles: 61 catalog entries, answer privacy, branches, undo, revisions, persistence and player isolation passed.");
  } finally { await query("DELETE FROM puzzle_attempts WHERE player_key=$1",[player]); }
}
main().catch((error:unknown)=>{console.error(error instanceof Error?error.message:error);process.exitCode=1;}).finally(closePool);
