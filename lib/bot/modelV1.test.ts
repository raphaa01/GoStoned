import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import * as ort from "onnxruntime-web/wasm";
import { createEmptyBoard } from "@/lib/game/goEngine";
import type { BoardSize } from "@/lib/game/types";
import {
  botStrengthForRating,
  GOSTONE_BOT_MODEL,
  goStoneBotModelForIdentity,
  type GoStoneBotPosition,
} from "./modelV1";
import { buildLegacyV4Features, buildV8Features } from "./v8Features";

const artifactPath = join(process.cwd(), "public", "bot-models", "gostone-japanese-v8.onnx");

test("the published v8 artifact matches the immutable browser model contract", async () => {
  const artifact = await readFile(artifactPath);
  const metadata = JSON.parse(await readFile(
    join(process.cwd(), "public", "bot-models", "gostone-japanese-v8.json"),
    "utf8",
  )) as {
    integrationContractVersion?: unknown;
    version?: unknown;
    sha256?: unknown;
    bytes?: unknown;
    input?: { shape?: unknown; planes?: unknown[] };
    strengthProfiles?: unknown;
    settlement?: { automaticSekiClassificationAllowed?: unknown };
  };
  assert.equal(artifact.byteLength, GOSTONE_BOT_MODEL.artifactBytes);
  assert.equal(createHash("sha256").update(artifact).digest("hex"), GOSTONE_BOT_MODEL.artifactSha256);
  assert.equal(metadata.integrationContractVersion, "gostone-v8-website-package-v1");
  assert.equal(metadata.version, GOSTONE_BOT_MODEL.modelVersion);
  assert.equal(metadata.sha256, GOSTONE_BOT_MODEL.artifactSha256);
  assert.equal(metadata.bytes, GOSTONE_BOT_MODEL.artifactBytes);
  assert.deepEqual(metadata.input?.shape, [null, 23, 19, 19]);
  assert.equal(metadata.input?.planes?.length, GOSTONE_BOT_MODEL.inputPlanes);
  assert.deepEqual(metadata.strengthProfiles, GOSTONE_BOT_MODEL.strengthProfiles);
  assert.equal(metadata.settlement?.automaticSekiClassificationAllowed, false);
});

test("rating strength is bounded and exactly matches all six trained profiles", () => {
  assert.equal(botStrengthForRating(-1), 0);
  assert.equal(botStrengthForRating(9_999), 1);
  assert.deepEqual(
    GOSTONE_BOT_MODEL.strengthProfiles.map(({ nominalElo }) => botStrengthForRating(nominalElo)),
    GOSTONE_BOT_MODEL.strengthProfiles.map(({ value }) => value),
  );
});

test("new games default to v8 while exact v4 bindings remain resumable", async () => {
  assert.equal(goStoneBotModelForIdentity().modelVersion, "v8");
  const legacyArtifact = await readFile(
    join(process.cwd(), "public", "bot-models", "gostone-japanese-v4.onnx"),
  );
  const legacySha256 = createHash("sha256").update(legacyArtifact).digest("hex");
  const legacy = goStoneBotModelForIdentity("v4", legacySha256);
  assert.equal(legacy.modelVersion, "v4");
  assert.equal(legacy.inputPlanes, 12);
  assert.throws(() => goStoneBotModelForIdentity("v4", GOSTONE_BOT_MODEL.artifactSha256));

  ort.env.wasm.numThreads = 1;
  ort.env.wasm.wasmPaths = new URL(
    "./",
    pathToFileURL(join(process.cwd(), "node_modules", "onnxruntime-web", "dist", "placeholder")),
  ).href;
  const session = await ort.InferenceSession.create(legacyArtifact, { executionProviders: ["wasm"] });
  const position = emptyPosition(9, 1_200);
  const outputs = await session.run({
    features: new ort.Tensor("float32", buildLegacyV4Features(position), [1, 12, 19, 19]),
  });
  assert.deepEqual(outputs.policy_logits.dims, [1, 362]);
});

function emptyPosition(boardSize: BoardSize, targetRating: number): GoStoneBotPosition {
  return {
    gameId: `model-contract-${boardSize}-${targetRating}`,
    boardSize,
    board: createEmptyBoard(boardSize),
    moves: [],
    toMove: "black",
    komi: GOSTONE_BOT_MODEL.komi,
    targetRating,
    gameVersion: 0,
  };
}

function combineFeatures(positions: readonly GoStoneBotPosition[]): Float32Array {
  const sampleLength = GOSTONE_BOT_MODEL.inputPlanes * 19 * 19;
  const combined = new Float32Array(positions.length * sampleLength);
  positions.forEach((position, index) => combined.set(buildV8Features(position), index * sampleLength));
  return combined;
}

test("the v8 ONNX graph accepts every board size and exposes the full output contract", async () => {
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.wasmPaths = new URL(
    "./",
    pathToFileURL(join(process.cwd(), "node_modules", "onnxruntime-web", "dist", "placeholder")),
  ).href;
  const artifact = await readFile(artifactPath);
  const session = await ort.InferenceSession.create(artifact, { executionProviders: ["wasm"] });
  const positions = ([9, 13, 19] as const).map((size) => emptyPosition(size, 1_500));
  const outputs = await session.run({
    features: new ort.Tensor("float32", combineFeatures(positions), [3, 23, 19, 19]),
  });
  assert.deepEqual(outputs.policy_logits.dims, [3, 362]);
  assert.deepEqual(outputs.value.dims, [3]);
  assert.deepEqual(outputs.score.dims, [3]);
  assert.deepEqual(outputs.ownership.dims, [3, 361]);
  assert.deepEqual(outputs.survival_logits.dims, [3, 361]);
  assert.deepEqual(outputs.score_stdev.dims, [3]);
  assert.deepEqual(outputs.territory_logits.dims, [3, 3, 361]);
  assert.deepEqual(outputs.status_logits.dims, [3, 4, 361]);
  assert.deepEqual(outputs.score_logits.dims, [3, 41]);
  assert.ok([...outputs.policy_logits.data as Float32Array].every(Number.isFinite));

  const strengthPositions = GOSTONE_BOT_MODEL.strengthProfiles.map(({ nominalElo }) =>
    emptyPosition(19, nominalElo));
  const strengthOutputs = await session.run({
    features: new ort.Tensor("float32", combineFeatures(strengthPositions), [6, 23, 19, 19]),
  });
  const policies = strengthOutputs.policy_logits.data as Float32Array;
  const policyLength = 362;
  const signatures = GOSTONE_BOT_MODEL.strengthProfiles.map((_, profileIndex) =>
    createHash("sha256").update(new Uint8Array(
      policies.buffer,
      policies.byteOffset + profileIndex * policyLength * Float32Array.BYTES_PER_ELEMENT,
      policyLength * Float32Array.BYTES_PER_ELEMENT,
    )).digest("hex"));
  assert.equal(new Set(signatures).size, GOSTONE_BOT_MODEL.strengthProfiles.length);
});
