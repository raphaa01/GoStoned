import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { readPuzzleAttemptBody } from "./request";

const request = (body: unknown) => new NextRequest("https://gostone.test/api/puzzles/11111111-1111-4111-8111-111111111111/attempt", {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});

test("puzzle pass, undo and restart are distinct explicit commands while ordinary move bodies remain compatible", async () => {
  const move={x:3,y:4,revision:2};
  assert.deepEqual(await readPuzzleAttemptBody(request(move)),move);
  for(const action of ["pass","undo","restart"] as const) assert.deepEqual(await readPuzzleAttemptBody(request({...move,action})),{...move,action});
  for(const body of [{...move,action:"delete"},{...move,action:null},{...move,unexpected:true},{...move,action:"pass",unexpected:true}]) await assert.rejects(readPuzzleAttemptBody(request(body)),/invalid/i);
});
