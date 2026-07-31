import "dotenv/config";
import { resolveExpiredJapaneseScoringBatch } from "@/lib/game/japaneseDeadlineWorker";

const INTERVAL_ENV = "JAPANESE_DEADLINE_RESOLVER_INTERVAL_MS";

function intervalMs(raw = process.env[INTERVAL_ENV]): number {
  if (raw === undefined || raw === "") return 1_000;
  if (!/^[1-9]\d*$/.test(raw)) throw new Error(`${INTERVAL_ENV} must be a positive whole number.`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 250 || value > 60_000) {
    throw new Error(`${INTERVAL_ENV} must be between 250 and 60000.`);
  }
  return value;
}

let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => { stopping = true; });
}

async function main() {
  const once = process.argv.includes("--once");
  const delay = intervalMs();
  do {
    const result = await resolveExpiredJapaneseScoringBatch();
    if (result.discovered > 0) console.info("Japanese deadline batch", result);
    if (once || stopping) break;
    await new Promise((resolve) => setTimeout(resolve, delay));
  } while (!stopping);
}

main().catch((error) => {
  console.error("Japanese deadline resolver stopped", {
    errorClass: error instanceof Error ? error.name : "unknown_error",
  });
  process.exitCode = 1;
});
