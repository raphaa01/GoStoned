import {
  Pool,
  type PoolClient,
  type PoolConfig,
  type QueryResult,
  type QueryResultRow,
} from "pg";
import { getDatabaseUrl, isLocalDatabase } from "./env";

declare global {
  // Reuse the pool during Next.js hot reloads in development.
  var goStonedDbPool: Pool | undefined;
}

function createPool(): Pool {
  const connectionString = getDatabaseUrl();
  const configuredMax = Number(process.env.DATABASE_POOL_MAX);
  const config: PoolConfig = {
    connectionString,
    max: Number.isInteger(configuredMax) && configuredMax > 0 ? configuredMax : 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 8_000,
    allowExitOnIdle: process.env.NODE_ENV !== "production",
  };

  if (!isLocalDatabase(connectionString)) {
    config.ssl = { rejectUnauthorized: false };
  }

  return new Pool(config);
}

export function getPool(): Pool {
  if (!globalThis.goStonedDbPool) {
    globalThis.goStonedDbPool = createPool();
  }
  return globalThis.goStonedDbPool;
}

export function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  values: readonly unknown[] = [],
): Promise<QueryResult<T>> {
  return getPool().query<T>(text, [...values]);
}

export async function withTransaction<T>(
  callback: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await getPool().connect();

  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL statement_timeout = '8s'");
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function withReadOnlyTransaction<T>(
  callback: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await getPool().connect();

  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await client.query("SET LOCAL statement_timeout = '8s'");
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function closePool(): Promise<void> {
  if (globalThis.goStonedDbPool) {
    await globalThis.goStonedDbPool.end();
    globalThis.goStonedDbPool = undefined;
  }
}
