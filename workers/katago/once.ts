import { closePool } from "@/lib/db";
import { runAnalysisOnce } from "./analysis";
import { KataGoEngine } from "./engine";
import { runPuzzleOnce } from "./puzzles";

const kind = process.argv[2];
const targetId = process.argv[3] || undefined;
const engineVersion = process.env.KATAGO_VERSION || "v1.17.0";
const modelName = process.env.KATAGO_MODEL_NAME || "b10c384h6nbttflrs";
const engine = new KataGoEngine({
  binary: process.env.KATAGO_BINARY || "/opt/katago/katago",
  model: process.env.KATAGO_MODEL || "/opt/katago/model.bin.gz",
  config: process.env.KATAGO_CONFIG || "/opt/katago/analysis.cfg",
});

async function main() {
  let processed: string | null;
  switch (kind) {
    case "analysis":
      processed = await runAnalysisOnce(engine, {
        engineVersion,
        modelName,
        maxVisits: Math.max(20, Number(process.env.KATAGO_MAX_VISITS) || 160),
        jobId: targetId,
      });
      break;
    case "puzzle":
      processed = await runPuzzleOnce(engine, { engineVersion, modelName, jobId: targetId });
      break;
    default:
      throw new Error("Usage: worker:katago:once <analysis|puzzle> [target-id]");
  }
  console.log(JSON.stringify({ ok: true, kind, processed }));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  engine.close();
  await closePool();
});
