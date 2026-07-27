import { Pool, type PoolConfig, type QueryResult, type QueryResultRow } from "pg";
import { getDatabaseUrl, isLocalDatabase } from "./env";

declare global {
  // Reuse the pool during Next.js hot reloads in development.
  var goStonedDbPool: Pool | undefined;
}

function createPool(): Pool {
  const connectionString = getDatabaseUrl();
  const config: PoolConfig = {
    connectionString,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 8_000,
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

export async function closePool(): Promise<void> {
  if (globalThis.goStonedDbPool) {
    await globalThis.goStonedDbPool.end();
    globalThis.goStonedDbPool = undefined;
  }
}
