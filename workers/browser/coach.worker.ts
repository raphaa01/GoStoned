/// <reference lib="webworker" />
import * as ort from "onnxruntime-web/wasm";
import { COACH_MODEL, COACH_REASONS } from "@/lib/learn/coachModel";
import { decodeCoachComment, type CoachTokenizer } from "@/lib/learn/coachLanguage";
import type { CoachEvidence } from "@/lib/learn/coachEvidence";
import { GOSTONE_BOT_MODEL } from "@/lib/bot/modelV1";

const scope = self as unknown as DedicatedWorkerGlobalScope;
let ready: Promise<{ session: ort.InferenceSession; tokenizer: CoachTokenizer }> | undefined;

async function verifiedAsset(file: keyof typeof COACH_MODEL.files): Promise<ArrayBuffer> {
  const response = await fetch(`${COACH_MODEL.baseUrl}${file}`);
  if (!response.ok) throw new Error(`Coach asset unavailable: ${file}`);
  const bytes = await response.arrayBuffer();
  const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(b => b.toString(16).padStart(2, "0")).join("");
  if (hash !== COACH_MODEL.files[file]) throw new Error(`Coach asset identity mismatch: ${file}`);
  return bytes;
}

function load() {
  ready ??= (async () => {
    const [model, vocabulary, schemaBytes, manifestBytes] = await Promise.all([
      verifiedAsset("coach.onnx"), verifiedAsset("tokenizer.json"), verifiedAsset("schema.json"), verifiedAsset("manifest.json"),
    ]);
    const decode = (buffer: ArrayBuffer) => JSON.parse(new TextDecoder().decode(buffer));
    const schema = decode(schemaBytes);
    const manifest = decode(manifestBytes);
    const tokenizer = decode(vocabulary) as CoachTokenizer;
    if (schema.contract !== COACH_MODEL.contract || manifest.contract !== COACH_MODEL.contract || schema.features !== 63
      || schema.reasons.join() !== COACH_REASONS.join() || tokenizer.vocabSize !== 2048 || tokenizer.type !== "word-with-utf8-fallback") throw new Error("Incompatible coach bundle.");
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.proxy = false;
    ort.env.wasm.wasmPaths = GOSTONE_BOT_MODEL.runtimeBaseUrl;
    const session = await ort.InferenceSession.create(model, { executionProviders: ["wasm"], graphOptimizationLevel: "all" });
    if (session.inputNames.join() !== "context,tokens,reason,board" || !session.outputNames.includes("text_logits") || !session.outputNames.includes("reason_logits")) throw new Error("Incompatible coach tensors.");
    return { session, tokenizer };
  })();
  return ready;
}

scope.onmessage = async (event: MessageEvent<{ id: string; evidence?: CoachEvidence }>) => {
  const { id, evidence } = event.data;
  try {
    const { session, tokenizer } = await load();
    const comment = evidence ? await decodeCoachComment(tokenizer, evidence, async (prefixes, reason) => {
      const batch = prefixes.length;
      const length = prefixes[0].length;
      const context = new Float32Array(batch * 63);
      const board = new Float32Array(batch * 11 * 361);
      for (let b = 0; b < batch; b++) { context.set(evidence.context, b * 63); board.set(evidence.board, b * 11 * 361); }
      const result = await session.run({
        context: new ort.Tensor("float32", context, [batch, 63]),
        board: new ort.Tensor("float32", board, [batch, 11, 19, 19]),
        tokens: new ort.Tensor("int64", BigInt64Array.from(prefixes.flat().map(BigInt)), [batch, length]),
        reason: new ort.Tensor("int64", new BigInt64Array(batch).fill(BigInt(reason)), [batch]),
      });
      const logits = { text: Float32Array.from(result.text_logits.data as Float32Array), reason: Float32Array.from(result.reason_logits.data as Float32Array), vocabulary: tokenizer.vocabSize };
      Object.values(result).forEach(t => t.dispose());
      return logits;
    }) : null;
    scope.postMessage({ id, comment });
  } catch (error) {
    scope.postMessage({ id, error: error instanceof Error ? error.message : "Coach inference failed." });
  }
};
