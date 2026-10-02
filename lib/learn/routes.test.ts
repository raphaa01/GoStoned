import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import type { Pool } from "pg";
import { GET, PUT } from "@/app/api/learn/progress/route";
import { POST } from "@/app/api/learn/game/score/route";
import { emptyLearnProgress } from "./progress";

const userId = "00000000-0000-4000-8000-000000000001";
function request(path: string, method = "GET", body?: unknown, signedIn = false) {
  return new NextRequest(`https://gostone.test${path}`, {method, headers:{
    "Content-Type":"application/json", Origin:"https://gostone.test",
    ...(signedIn ? {Cookie:`gostoned_session=${"a".repeat(43)}`} : {}),
  }, ...(body === undefined ? {} : {body:JSON.stringify(body)})});
}

async function withSession<T>(action: (statements: {sql:string; values:readonly unknown[]}[]) => Promise<T>) {
  const before = globalThis.goStonedDbPool;
  const statements: {sql:string; values:readonly unknown[]}[] = [];
  let saved: Record<string, unknown> | null = null;
  const client = {
    async query(sql:string, values:readonly unknown[] = []) {
      statements.push({sql,values});
      if (sql.includes("FROM user_sessions")) return {rows:[{id:userId,username:"learner",display_name:"Learner",expires_at:new Date(Date.now()+60_000)}]};
      if (sql.includes("INSERT INTO learn_progress")) {
        saved = {completed_lesson_ids:JSON.parse(String(values[1])),current_lesson_id:values[2],completed_stages:JSON.parse(String(values[3])),last_step_by_lesson:JSON.parse(String(values[4])),challenge_results:JSON.parse(String(values[5])),updated_at:values[6]};
        return {rows:[saved]};
      }
      if (sql.includes("FROM learn_progress")) return {rows:saved ? [saved] : []};
      if (/BEGIN|COMMIT|ROLLBACK|SET LOCAL|pg_advisory_xact_lock/.test(sql)) return {rows:[]};
      throw new Error("Unexpected learning statement");
    }, release() {},
  };
  globalThis.goStonedDbPool = {...client,connect:async()=>client} as unknown as Pool;
  try { return await action(statements); } finally { globalThis.goStonedDbPool = before; }
}

test("learning APIs require an account and reject cross-site mutations", async () => {
  assert.equal((await GET(request("/api/learn/progress"))).status,401);
  assert.equal((await PUT(request("/api/learn/progress","PUT",{progress:emptyLearnProgress()}))).status,401);
  assert.equal((await POST(request("/api/learn/game/score","POST",{}))).status,401);
  const crossSite = new NextRequest("https://gostone.test/api/learn/progress", {method:"PUT",headers:{Origin:"https://attacker.test","Content-Type":"application/json"},body:"{}"});
  assert.equal((await PUT(crossSite)).status,403);
});

test("account progress uses the authenticated owner and merges completed lessons", async () => withSession(async (statements) => {
  const initial = await GET(request("/api/learn/progress","GET",undefined,true));
  assert.equal(initial.headers.get("Cache-Control"),"no-store, max-age=0");
  assert.equal((await initial.json()).progress,null);
  const first = {...emptyLearnProgress(),completedLessonIds:["s1-board"],updatedAt:"2026-01-01T00:00:00Z"};
  assert.equal((await PUT(request("/api/learn/progress","PUT",{progress:first},true))).status,200);
  const second = {...first,completedLessonIds:["s1-turns"],updatedAt:"2026-01-01T00:00:01Z"};
  const updated = await PUT(request("/api/learn/progress","PUT",{progress:second},true));
  assert.deepEqual((await updated.json()).progress.completedLessonIds,["s1-board","s1-turns"]);
  for (const statement of statements.filter(({sql})=>sql.includes("FROM learn_progress") || sql.includes("INSERT INTO learn_progress"))) assert.equal(statement.values[0],userId);
  assert.ok(statements.some(({sql})=>sql.includes("pg_advisory_xact_lock")));
  assert.equal((await PUT(request("/api/learn/progress","PUT",{progress:second,userId:"someone-else"},true))).status,400);
}));

test("learning settlement replays legal moves and refuses invented results", async () => withSession(async () => {
  const body = {moves:[{x:1,y:0},{x:0,y:0},{x:0,y:1},{x:8,y:8},null,null],deadStones:[],neutralRegionSeeds:[],agreed:true};
  const response = await POST(request("/api/learn/game/score","POST",body,true));
  assert.equal(response.status,200);
  const result = (await response.json()).result;
  assert.equal(result.score.capturedWhiteByBlack,1);
  assert.equal(result.score.komi,6.5);
  for (const invalid of [{...body,agreed:false},{...body,winner:"black"},{...body,moves:[null]},{...body,moves:[{x:9,y:0},null,null]}]) {
    assert.equal((await POST(request("/api/learn/game/score","POST",invalid,true))).status,400);
  }
}));
