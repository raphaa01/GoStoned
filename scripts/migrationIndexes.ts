import type { PoolClient } from "pg";

export const MIGRATION_LOCK_NAMESPACE = 0x474f5354;
export const MIGRATION_LOCK_PURPOSE = 0x4d494752;

export type ConcurrentIndexSpec = Readonly<{
  filename: string;
  schema: "public";
  name: string;
  table: string;
  method: "btree";
  keyExpressions: readonly string[];
  includeExpressions: readonly string[];
  predicate: string | null;
  concurrentDropSql: string;
  recoveryLockSql: string;
  recoveryQuarantineName: string;
  recoveryRenameSql: string;
  recoveryDropSql: string;
}>;

export type ConcurrentIndexInspection = Readonly<{
  relationOid: number;
  relkind: string;
  relationPersistence: string;
  tablespaceOid: number;
  relationOptions: string[] | null;
  ownerName: string;
  tableSchema: string | null;
  tableName: string | null;
  tableOid: number | null;
  tableKind: string | null;
  tableOwnerName: string | null;
  method: string | null;
  keyExpressions: string[] | null;
  includeExpressions: string[] | null;
  predicate: string | null;
  unique: boolean | null;
  primary: boolean | null;
  exclusion: boolean | null;
  replicaIdentity: boolean | null;
  clustered: boolean | null;
  ready: boolean | null;
  valid: boolean | null;
  live: boolean | null;
  constraintCount: number;
  activeBuildCount: number;
}>;

export type ConcurrentIndexClassification = Readonly<{
  state: "missing" | "exact-valid" | "exact-invalid" | "conflict";
  reason: string;
}>;

export const CONCURRENT_INDEX_SPECS = [
  {
    filename: "012_leaderboard_rating_history_index.sql",
    schema: "public",
    name: "idx_player_rating_history_board_player_time",
    table: "player_rating_history",
    method: "btree",
    keyExpressions: ["board_size", "player_key", "recorded_at", "id"],
    includeExpressions: ["game_id", "rating_before", "rating_after", "result"],
    predicate: null,
    concurrentDropSql: "DROP INDEX CONCURRENTLY public.idx_player_rating_history_board_player_time",
    recoveryLockSql: "LOCK TABLE public.player_rating_history IN ACCESS EXCLUSIVE MODE",
    recoveryQuarantineName: "gostone_migration_recovery_012",
    recoveryRenameSql: `ALTER INDEX public.idx_player_rating_history_board_player_time
                          RENAME TO gostone_migration_recovery_012`,
    recoveryDropSql: "DROP INDEX public.gostone_migration_recovery_012",
  },
  {
    filename: "015_matchmaking_stale_cleanup_index.sql",
    schema: "public",
    name: "idx_matchmaking_waiting_pool_updated_at",
    table: "matchmaking_queue",
    method: "btree",
    keyExpressions: ["board_size", "time_control", "rules_profile", "updated_at", "player_key"],
    includeExpressions: [],
    predicate: "(status = 'waiting'::text)",
    concurrentDropSql: "DROP INDEX CONCURRENTLY public.idx_matchmaking_waiting_pool_updated_at",
    recoveryLockSql: "LOCK TABLE public.matchmaking_queue IN ACCESS EXCLUSIVE MODE",
    recoveryQuarantineName: "gostone_migration_recovery_015",
    recoveryRenameSql: `ALTER INDEX public.idx_matchmaking_waiting_pool_updated_at
                          RENAME TO gostone_migration_recovery_015`,
    recoveryDropSql: "DROP INDEX public.gostone_migration_recovery_015",
  },
] as const satisfies readonly ConcurrentIndexSpec[];

export function getConcurrentIndexSpec(filename: string): ConcurrentIndexSpec | undefined {
  return CONCURRENT_INDEX_SPECS.find((spec) => spec.filename === filename);
}

export function validateMigrationIndexContract(
  filename: string,
  sql: string,
): ConcurrentIndexSpec | undefined {
  const nonTransactional = sql.trimStart().startsWith(
    "-- gostone:migration-mode=nontransactional",
  );
  const spec = getConcurrentIndexSpec(filename);
  if (nonTransactional !== Boolean(spec)) {
    throw new Error(`Unsupported nontransactional migration contract: ${filename}.`);
  }
  return spec;
}

export function assertMigrationSessionEndpoint(databaseUrl: string): void {
  let url: URL;
  try {
    url = new URL(databaseUrl);
  } catch {
    throw new Error("Database migrations require a valid PostgreSQL connection URL.");
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new Error("Database migrations require a valid PostgreSQL connection URL.");
  }
  const targetOverrides = new Set(["host", "hostaddr", "port", "service", "servicefile"]);
  if ([...url.searchParams.keys()].some((key) => targetOverrides.has(key.toLowerCase()))) {
    throw new Error(
      "Database migrations require an unambiguous direct or session-mode PostgreSQL target.",
    );
  }
  const transactionPooler = url.port === "6543"
    || url.searchParams.getAll("pgbouncer").some((value) => value.toLowerCase() === "true")
    || url.searchParams.getAll("pool_mode").some((value) => value.toLowerCase() === "transaction");
  if (transactionPooler) {
    throw new Error(
      "Database migrations require a direct or session-mode PostgreSQL connection, not a transaction pooler.",
    );
  }
}

export async function releaseMigrationSession(
  client: Pick<PoolClient, "query" | "release">,
  lockAcquired: boolean,
): Promise<void> {
  if (!lockAcquired) {
    client.release();
    return;
  }
  try {
    const result = await client.query<{ unlocked: boolean }>(
      "SELECT pg_catalog.pg_advisory_unlock($1::int, $2::int) AS unlocked",
      [MIGRATION_LOCK_NAMESPACE, MIGRATION_LOCK_PURPOSE],
    );
    if (result.rows[0]?.unlocked !== true) {
      throw new Error("Database migration lock release failed.");
    }
  } catch (error) {
    client.release(true);
    throw error;
  }
  client.release();
}

export async function inspectConcurrentIndex(
  client: Pick<PoolClient, "query">,
  spec: ConcurrentIndexSpec,
): Promise<ConcurrentIndexInspection | null> {
  const result = await client.query<ConcurrentIndexInspection>(
    `SELECT index_relation.oid::int AS "relationOid",
            index_relation.relkind AS relkind,
            index_relation.relpersistence AS "relationPersistence",
            index_relation.reltablespace::int AS "tablespaceOid",
            index_relation.reloptions AS "relationOptions",
            pg_catalog.pg_get_userbyid(index_relation.relowner) AS "ownerName",
            table_namespace.nspname AS "tableSchema",
            table_relation.relname AS "tableName",
            table_relation.oid::int AS "tableOid",
            table_relation.relkind AS "tableKind",
            pg_catalog.pg_get_userbyid(table_relation.relowner) AS "tableOwnerName",
            access_method.amname AS method,
            CASE WHEN index_state.indexrelid IS NULL THEN NULL ELSE ARRAY(
              SELECT pg_catalog.pg_get_indexdef(index_state.indexrelid, position, FALSE)
                FROM pg_catalog.generate_series(1, index_state.indnkeyatts) AS position
               ORDER BY position
            ) END AS "keyExpressions",
            CASE WHEN index_state.indexrelid IS NULL THEN NULL ELSE ARRAY(
              SELECT pg_catalog.pg_get_indexdef(index_state.indexrelid, position, FALSE)
                FROM pg_catalog.generate_series(index_state.indnkeyatts + 1, index_state.indnatts) AS position
               ORDER BY position
            ) END AS "includeExpressions",
            pg_catalog.pg_get_expr(index_state.indpred, index_state.indrelid, FALSE) AS predicate,
            index_state.indisunique AS unique,
            index_state.indisprimary AS primary,
            index_state.indisexclusion AS exclusion,
            index_state.indisreplident AS "replicaIdentity",
            index_state.indisclustered AS clustered,
            index_state.indisready AS ready,
            index_state.indisvalid AS valid,
            index_state.indislive AS live,
            (SELECT COUNT(*)::int
               FROM pg_catalog.pg_constraint AS constraint_state
              WHERE constraint_state.conindid = index_relation.oid) AS "constraintCount",
            (SELECT COUNT(*)::int
               FROM pg_catalog.pg_stat_progress_create_index AS progress
              WHERE progress.index_relid = index_relation.oid) AS "activeBuildCount"
       FROM pg_catalog.pg_class AS index_relation
       JOIN pg_catalog.pg_namespace AS index_namespace
         ON index_namespace.oid = index_relation.relnamespace
       LEFT JOIN pg_catalog.pg_index AS index_state
         ON index_state.indexrelid = index_relation.oid
       LEFT JOIN pg_catalog.pg_class AS table_relation
         ON table_relation.oid = index_state.indrelid
       LEFT JOIN pg_catalog.pg_namespace AS table_namespace
         ON table_namespace.oid = table_relation.relnamespace
       LEFT JOIN pg_catalog.pg_am AS access_method
         ON access_method.oid = index_relation.relam
      WHERE index_namespace.nspname = $1
        AND index_relation.relname = $2`,
    [spec.schema, spec.name],
  );
  if (result.rows.length > 1) {
    throw new Error(`Concurrent index inspection was ambiguous for ${spec.filename}.`);
  }
  return result.rows[0] ?? null;
}

function arraysEqual(actual: readonly string[] | null, expected: readonly string[]): boolean {
  return actual !== null
    && actual.length === expected.length
    && actual.every((value, index) => value === expected[index]);
}

export function classifyConcurrentIndex(
  inspection: ConcurrentIndexInspection | null,
  spec: ConcurrentIndexSpec,
  currentUser: string,
): ConcurrentIndexClassification {
  if (!inspection) return { state: "missing", reason: "relation is missing" };

  const structuralChecks: ReadonlyArray<readonly [boolean, string]> = [
    [inspection.relkind === "i", "same-name relation is not an index"],
    [inspection.relationPersistence === "p", "index is not permanent"],
    [inspection.tablespaceOid === 0, "index uses a nondefault tablespace"],
    [inspection.relationOptions === null, "index has relation options"],
    [inspection.ownerName === currentUser, "index owner differs from the migration role"],
    [inspection.tableSchema === spec.schema, "index targets a different schema"],
    [inspection.tableName === spec.table, "index targets a different table"],
    [inspection.tableOid !== null, "index target is unavailable"],
    [inspection.tableKind === "r", "index target is not an ordinary table"],
    [inspection.tableOwnerName === currentUser, "table owner differs from the migration role"],
    [inspection.method === spec.method, "index uses a different access method"],
    [arraysEqual(inspection.keyExpressions, spec.keyExpressions), "index keys differ"],
    [arraysEqual(inspection.includeExpressions, spec.includeExpressions), "index includes differ"],
    [inspection.predicate === spec.predicate, "index predicate differs"],
    [inspection.unique === false, "index uniqueness differs"],
    [inspection.primary === false, "index is a primary-key index"],
    [inspection.exclusion === false, "index is an exclusion index"],
    [inspection.replicaIdentity === false, "index is a replica-identity index"],
    [inspection.clustered === false, "index is a clustered index"],
    [inspection.constraintCount === 0, "index backs a constraint"],
    [inspection.activeBuildCount === 0, "index build is active"],
  ];
  const failed = structuralChecks.find(([matches]) => !matches);
  if (failed) return { state: "conflict", reason: failed[1] };

  if (inspection.ready && inspection.valid && inspection.live) {
    return { state: "exact-valid", reason: "index matches the published contract" };
  }
  if (inspection.live && !inspection.valid) {
    return { state: "exact-invalid", reason: "index matches the contract but is invalid" };
  }
  return { state: "conflict", reason: "index lifecycle state is unsafe to recover" };
}

export async function assertExactUsableConcurrentIndex(
  client: Pick<PoolClient, "query">,
  spec: ConcurrentIndexSpec,
  currentUser: string,
): Promise<ConcurrentIndexInspection> {
  const inspection = await inspectConcurrentIndex(client, spec);
  const classification = classifyConcurrentIndex(inspection, spec, currentUser);
  if (classification.state !== "exact-valid" || !inspection) {
    throw new Error(`Concurrent index verification failed for ${spec.filename}: ${classification.reason}.`);
  }
  return inspection;
}
