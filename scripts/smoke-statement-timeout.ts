import assert from "node:assert/strict";
import "dotenv/config";
import type { PoolClient } from "pg";
import { closePool, getPool } from "../lib/db";
import { getDatabaseUrl, isUnambiguousLocalDatabase } from "../lib/env";
import { assertSmokeDatabaseIdentity } from "../lib/smokeDatabase";

const APPLICATION_TIMEOUT_MS = 8_000;
const PROBE_TIMEOUT_MS = 100;

type BackendState = Readonly<{
  backend_pid: number;
  statement_timeout_ms: number;
  statement_timeout_source: string;
}>;

function hasSqlState(error: unknown, code: string): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && (error as { code?: unknown }).code === code;
}

async function backendState(client: PoolClient): Promise<BackendState> {
  const result = await client.query<BackendState>(
    `SELECT pg_catalog.pg_backend_pid()::int AS backend_pid,
            setting.setting::int AS statement_timeout_ms,
            setting.source AS statement_timeout_source
       FROM pg_catalog.pg_settings AS setting
      WHERE setting.name = 'statement_timeout'`,
  );
  assert.equal(result.rows.length, 1, "Statement-timeout backend state is unavailable.");
  return result.rows[0];
}

async function run(): Promise<void> {
  const databaseUrl = getDatabaseUrl();
  if (!isUnambiguousLocalDatabase(databaseUrl)) {
    throw new Error("Statement-timeout smoke may only run against a local PostgreSQL database.");
  }

  const pool = getPool();
  await assertSmokeDatabaseIdentity(pool);
  const client = await pool.connect();
  let destroyClient = true;
  try {
    await assertSmokeDatabaseIdentity(client);
    const initial = await backendState(client);
    assert.equal(initial.statement_timeout_ms, APPLICATION_TIMEOUT_MS);
    assert.equal(initial.statement_timeout_source, "database user");

    await client.query(`SET statement_timeout = '${PROBE_TIMEOUT_MS}ms'`);
    await assert.rejects(
      client.query("SELECT pg_catalog.pg_sleep(1)"),
      (error) => hasSqlState(error, "57014"),
    );

    const recovered = await backendState(client);
    assert.equal(recovered.backend_pid, initial.backend_pid, "Timed-out backend was not reusable.");
    assert.equal(recovered.statement_timeout_ms, PROBE_TIMEOUT_MS);
    assert.equal(recovered.statement_timeout_source, "session");

    await client.query("RESET statement_timeout");
    const reset = await backendState(client);
    assert.equal(reset.backend_pid, initial.backend_pid, "Reset used a different backend.");
    assert.equal(reset.statement_timeout_ms, APPLICATION_TIMEOUT_MS);
    assert.equal(reset.statement_timeout_source, "database user");
    destroyClient = false;
    console.log("PostgreSQL statement timeout and same-backend recovery smoke passed.");
  } finally {
    client.release(destroyClient);
  }
}

run()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Statement-timeout smoke failed.");
    process.exitCode = 1;
  })
  .finally(closePool);
