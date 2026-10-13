import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/local-game/score/route";

const body = { boardSize: 9, moves: [null, null], deadStones: [], neutralRegionSeeds: [], blackAgreed: false, whiteAgreed: false };
function request(payload: unknown, origin = "capacitor://localhost", contentType = "application/json") {
  return new NextRequest("https://gostone.app/api/local-game/score", {
    method: "POST", headers: { origin, "content-type": contentType }, body: JSON.stringify(payload),
  });
}

test("local scoring works without login and is never cached", async () => {
  for (const origin of ["capacitor://localhost", "https://localhost", "https://gostone.app"]) {
    const response = await POST(request(body, origin));
    assert.equal(response.status, 200);
    assert.match(response.headers.get("cache-control")!, /no-store/);
    const data = await response.json();
    assert.equal(data.finalized, false);
    assert.equal(data.result.score.whiteTotal, 6.5);
    assert.equal(response.headers.has("set-cookie"), false);
  }
  const final = await POST(request({ ...body, blackAgreed: true, whiteAgreed: true }));
  assert.equal((await final.json()).finalized, true);
});

test("local scoring rejects invalid records, bodies, origins and client results", async () => {
  for (const payload of [null, [], { ...body, boardSize: 10 }, { ...body, moves: [null] }, { ...body, result: "B+100" }]) {
    assert.equal((await POST(request(payload))).status, 400);
  }
  assert.equal((await POST(request(body, "https://other.example"))).status, 403);
  assert.equal((await POST(request(body, "https://gostone.app", "text/plain"))).status, 403);
});
