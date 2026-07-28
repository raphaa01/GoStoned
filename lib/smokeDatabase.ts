import type { QueryResult, QueryResultRow } from "pg";

type SmokeQueryable = {
  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<T>>;
};

export type SmokeDatabaseExpectation = Readonly<{
  databaseName: string;
  roleName: string;
}>;

const POSTGRES_IDENTIFIER = /^[a-z][a-z0-9_]{0,62}$/;

export function getSmokeDatabaseExpectation(
  env: Readonly<Record<string, string | undefined>> = process.env,
): SmokeDatabaseExpectation {
  const databaseName = env.GOSTONE_SMOKE_DATABASE_NAME;
  const roleName = env.GOSTONE_SMOKE_DATABASE_ROLE;
  if (
    !databaseName
    || !roleName
    || !POSTGRES_IDENTIFIER.test(databaseName)
    || !POSTGRES_IDENTIFIER.test(roleName)
  ) {
    throw new Error("Smoke database identity is not explicitly configured.");
  }
  return { databaseName, roleName };
}

export async function assertSmokeDatabaseIdentity(
  database: SmokeQueryable,
  expected = getSmokeDatabaseExpectation(),
): Promise<void> {
  const result = await database.query<{
    database_name: string;
    role_name: string;
    session_role: string;
  }>(
    `SELECT current_database() AS database_name,
            current_user AS role_name,
            session_user AS session_role`,
  );
  if (
    result.rows.length !== 1
    || result.rows[0].database_name !== expected.databaseName
    || result.rows[0].role_name !== expected.roleName
    || result.rows[0].session_role !== expected.roleName
  ) {
    throw new Error("Smoke database identity check failed.");
  }
}

export async function withRollbackOnlyTransaction<T>(
  client: SmokeQueryable,
  operation: (transaction: SmokeQueryable) => Promise<T>,
): Promise<T> {
  await client.query("BEGIN");
  try {
    return await operation(client);
  } finally {
    await client.query("ROLLBACK");
  }
}
