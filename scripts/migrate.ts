import "dotenv/config";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { closePool, getPool } from "../lib/db";

async function migrate() {
  const migrationsPath = path.join(process.cwd(), "db", "migrations");
  console.log("GoStone database migration");
  console.log(`Reading migrations: ${migrationsPath}`);

  const pool = getPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
    ALTER TABLE schema_migrations ENABLE ROW LEVEL SECURITY;

    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        REVOKE ALL ON schema_migrations FROM anon;
      END IF;
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        REVOKE ALL ON schema_migrations FROM authenticated;
      END IF;
    END
    $$;
  `);

  const files = (await readdir(migrationsPath))
    .filter((filename) => filename.endsWith(".sql"))
    .sort();

  for (const filename of files) {
    const alreadyApplied = await pool.query(
      "SELECT 1 FROM schema_migrations WHERE filename = $1",
      [filename],
    );
    if (alreadyApplied.rowCount) {
      console.log(`Skipping ${filename} (already applied).`);
      continue;
    }

    const sql = await readFile(path.join(migrationsPath, filename), "utf8");
    const nonTransactional = sql.trimStart().startsWith(
      "-- gostone:migration-mode=nontransactional",
    );
    const client = await pool.connect();
    try {
      console.log(`Applying ${filename}...`);
      if (nonTransactional) {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (filename) VALUES ($1)", [filename]);
        console.log(`Applied ${filename}.`);
        continue;
      }
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (filename) VALUES ($1)", [filename]);
      await client.query("COMMIT");
      console.log(`Applied ${filename}.`);
    } catch (error) {
      if (!nonTransactional) {
        await client.query("ROLLBACK");
      }
      throw error;
    } finally {
      client.release();
    }
  }

  console.log("Database migrations completed successfully.");
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
