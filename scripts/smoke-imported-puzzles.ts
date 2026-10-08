import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { Pool } from "pg";
import { closePool, getPool, query } from "../lib/db";
import { getDatabaseUrl, isUnambiguousLocalDatabase } from "../lib/env";
import { assertSmokeDatabaseIdentity } from "../lib/smokeDatabase";
import { attemptImportedPuzzle, readImportedPuzzleHint, readImportedPuzzleHub } from "../lib/puzzles/importedService";
import { IMPORTED_PUZZLES, IMPORTED_CATALOG_VERSION, dailyImportedPuzzle } from "../lib/puzzles/importedCatalog";

async function verifyProductionConstraintRepair(player: string) {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL statement_timeout = '8s'");
    await client.query("ALTER TABLE puzzles DROP CONSTRAINT puzzles_visits_check");
    await client.query("ALTER TABLE puzzles ADD CONSTRAINT puzzles_visits_check CHECK (visits BETWEEN 1 AND 10000) NOT VALID");
    globalThis.goStonedDbPool = {query: client.query.bind(client)} as unknown as Pool;
    for (const mode of ["daily", "practice"] as const) {
      await client.query("SAVEPOINT legacy_constraint");
      await assert.rejects(readImportedPuzzleHub(player, mode), (error: unknown) => (error as {code:string;constraint:string}).code === "23514" && (error as {constraint:string}).constraint === "puzzles_visits_check");
      await client.query("ROLLBACK TO SAVEPOINT legacy_constraint");
    }
    const repair = await readFile(new URL("../db/migrations/052_repair_imported_puzzle_visits.sql", import.meta.url), "utf8");
    await client.query(repair);
    await client.query(repair);
    assert.equal((await readImportedPuzzleHub(player, "daily")).puzzles.length, 1);
    assert.equal((await readImportedPuzzleHub(player, "practice")).puzzles.length, 61);
  } finally {
    globalThis.goStonedDbPool = pool;
    await client.query("ROLLBACK");
    client.release();
  }
}

async function main() {
  assert.ok(isUnambiguousLocalDatabase(getDatabaseUrl()), "Imported puzzle smoke requires a local test database.");
  await assertSmokeDatabaseIdentity(getPool());
  const player = `user:${randomUUID()}`;
  await verifyProductionConstraintRepair(player);
  const archivedBefore = await query<{count:string}>("SELECT count(*)::text AS count FROM puzzles WHERE engine_version <> $1", [IMPORTED_CATALOG_VERSION]);
  try {
    const hub = await readImportedPuzzleHub(player, "practice");
    assert.equal(hub.puzzles.length, 61);
    assert.ok(hub.puzzles.every((puzzle)=>puzzle.solution === null && puzzle.variationProgress.length === 0));
    assert.equal(hub.puzzles[0].rankKyu, 30);
    const secondHub = await readImportedPuzzleHub(player, "practice");
    assert.deepEqual(secondHub,hub,"catalog initialization is idempotent");
    const puzzle = IMPORTED_PUZZLES.find((candidate)=>candidate.paths[1].line.length === 6 && candidate.paths[1].line.some((ply)=>ply.move==="pass" && ply.color===candidate.toPlay))!;
    let revision=0;
    const wrong=puzzle.paths[1].line;
    const opening=await attemptImportedPuzzle(puzzle.id,player,{...wrong[0],revision},true);
    assert.equal(opening.outcome,"continue");
    revision=opening.variationRevision;
    const reloaded=(await readImportedPuzzleHub(player,"practice")).puzzles.find((candidate)=>candidate.id===puzzle.id)!;
    assert.deepEqual(reloaded.variationProgress,wrong.slice(0,2));
    await assert.rejects(attemptImportedPuzzle(puzzle.id,player,{...wrong[2],revision:0},true),/puzzle changed/i);
    const undone=await attemptImportedPuzzle(puzzle.id,player,{x:0,y:0,revision,action:"undo"},true);
    assert.deepEqual(undone.variationProgress,[]);
    revision=undone.variationRevision;
    for(const ply of wrong.filter((ply)=>ply.color===puzzle.toPlay)) {
      const result=await attemptImportedPuzzle(puzzle.id,player,{...ply,revision,action:ply.move==="pass"?"pass":"play"},true);
      revision=result.variationRevision;
      assert.equal(result.outcome,ply===wrong[4]?"retry":"continue");
    }
    for(const ply of puzzle.paths[0].line.filter((ply)=>ply.color===puzzle.toPlay)) {
      const result=await attemptImportedPuzzle(puzzle.id,player,{...ply,revision,action:ply.move==="pass"?"pass":"play"},true);
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
    const dailySource = dailyImportedPuzzle(daily.puzzles[0].dailyDate!);
    const practiceBeforeDaily = (await readImportedPuzzleHub(player,"practice")).puzzles.find((puzzle)=>puzzle.id===dailySource.id)!;
    assert.notEqual(daily.puzzles[0].id,dailySource.id);
    assert.equal(daily.puzzles[0].solved,false);
    assert.equal(daily.puzzles[0].solution,null);
    await readImportedPuzzleHint(daily.puzzles[0].id,player,false);
    revision=0;
    for(const ply of dailySource.paths[0].line.filter((ply)=>ply.color===dailySource.toPlay)) {
      const result=await attemptImportedPuzzle(daily.puzzles[0].id,player,{...ply,revision,action:ply.move==="pass"?"pass":"play"},false);
      revision=result.variationRevision;
    }
    assert.equal((await readImportedPuzzleHub(player,"daily")).puzzles[0].solved,true);
    const practiceAfterDaily = (await readImportedPuzzleHub(player,"practice")).puzzles.find((puzzle)=>puzzle.id===dailySource.id)!;
    assert.deepEqual(practiceAfterDaily,practiceBeforeDaily,"daily progress never overwrites practice attempts");
    const archivedAfter=await query<{count:string}>("SELECT count(*)::text AS count FROM puzzles WHERE engine_version <> $1", [IMPORTED_CATALOG_VERSION]);
    assert.deepEqual(archivedAfter.rows,archivedBefore.rows,"legacy puzzles are preserved");
    console.log("Imported puzzles: production constraint repair, 61 practice entries, independent daily progress, answer privacy, branches, undo, revisions, persistence and player isolation passed.");
  } finally { await query("DELETE FROM puzzle_attempts WHERE player_key=$1",[player]); }
}
main().catch((error:unknown)=>{console.error(error instanceof Error?error.message:error);process.exitCode=1;}).finally(closePool);
