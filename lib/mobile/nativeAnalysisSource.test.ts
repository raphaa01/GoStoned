import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const review = readFileSync(
  join(process.cwd(), "components", "review", "AnalysisReview.tsx"),
  "utf8",
);
const nativeRuntime = readFileSync(
  join(process.cwd(), "lib", "mobile", "nativeKataGo.ts"),
  "utf8",
);

test("native review loads the game but never queues server-side KataGo analysis", () => {
  const nativeStart = review.indexOf("if (nativeAnalysis) {");
  const serverStart = review.indexOf("const response = await fetch(`/api/games/${gameId}/analysis`");
  assert.notEqual(nativeStart, -1);
  assert.ok(serverStart > nativeStart);
  const nativeBranch = review.slice(nativeStart, serverStart);
  assert.match(nativeBranch, /fetch\(`\/api\/games\/\$\{gameId\}`/);
  assert.doesNotMatch(nativeBranch, /\/analysis/);
  assert.match(nativeBranch, /runNativeKataGoAnalysis\(body\.game, setAnalysis\)/);
  assert.match(review, /analysis\.status === "running"\) && !result/);
  assert.match(nativeRuntime, /catch \(analysisError\)[\s\S]*buildProgressiveGameAnalysis[\s\S]*storeResult\(game, partial\)/);
  assert.match(review, /if \(nativeAnalysis\) return;[\s\S]*setInterval/);
});
