import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import * as ort from "onnxruntime-web/wasm";
import { botStrengthForRating, GOSTONE_BOT_MODEL } from "./modelV1";

test("the published v1 artifact matches the immutable browser model contract", async () => {
  const artifact = await readFile(join(process.cwd(), "public", "bot-models", "gostone-japanese-v1.onnx"));
  assert.equal(artifact.byteLength, GOSTONE_BOT_MODEL.artifactBytes);
  assert.equal(createHash("sha256").update(artifact).digest("hex"), GOSTONE_BOT_MODEL.artifactSha256);
});

test("rating strength is bounded and monotonic across the trained range", () => {
  assert.equal(botStrengthForRating(-1), 0);
  assert.equal(botStrengthForRating(600), 0);
  assert.equal(botStrengthForRating(1_350), 0.5);
  assert.equal(botStrengthForRating(2_100), 1);
  assert.equal(botStrengthForRating(9_999), 1);
});

test("the v1 ONNX graph accepts the browser feature contract", async () => {
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.wasmPaths = new URL(
    "./",
    pathToFileURL(join(process.cwd(), "node_modules", "onnxruntime-web", "dist", "placeholder")),
  ).href;
  const artifact = await readFile(join(process.cwd(), "public", "bot-models", "gostone-japanese-v1.onnx"));
  const session = await ort.InferenceSession.create(artifact, { executionProviders: ["wasm"] });
  const features = new Float32Array(12 * 19 * 19);
  for (let y = 5; y < 14; y += 1) {
    for (let x = 5; x < 14; x += 1) {
      features[4 * 361 + y * 19 + x] = 1;
      features[7 * 361 + y * 19 + x] = 0.4;
    }
  }
  const outputs = await session.run({ features: new ort.Tensor("float32", features, [1, 12, 19, 19]) });
  assert.deepEqual(outputs.policy_logits.dims, [1, 362]);
  assert.deepEqual(outputs.ownership.dims, [1, 361]);
  assert.deepEqual(outputs.survival_logits.dims, [1, 361]);
  assert.ok([...outputs.policy_logits.data as Float32Array].every(Number.isFinite));
});
