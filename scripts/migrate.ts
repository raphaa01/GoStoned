import "dotenv/config";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { closePool, query } from "../lib/db";

async function migrate() {
  const schemaPath = path.join(process.cwd(), "db", "schema.sql");
  console.log("GoStoned database migration");
  console.log(`Reading schema: ${schemaPath}`);

  const schema = await readFile(schemaPath, "utf8");
  console.log("Connecting to PostgreSQL…");
  await query(schema);
  console.log("Database schema applied successfully.");
}

migrate()
  .catch((error: unknown) => {
    console.error("Migration failed.");
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
