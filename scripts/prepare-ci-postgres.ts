import assert from "node:assert/strict";
import { appendFile } from "node:fs/promises";
import "dotenv/config";
import { closePool, getPool, query, withTransaction } from "../lib/db";
import { getDatabaseUrl, isUnambiguousLocalDatabase } from "../lib/env";
import { assertSmokeDatabaseIdentity } from "../lib/smokeDatabase";

const CI_DATABASE = "gostone_ci";
const CI_ADMIN_ROLE = "gostone_ci_admin";
const CI_RUNNER_ROLE = "gostone_ci_runner";

type RoleState = {
  database_name: string;
  role_name: string;
  session_role: string;
  owner_name: string;
  rolcanlogin: boolean;
  rolsuper: boolean;
  rolcreatedb: boolean;
  rolcreaterole: boolean;
  rolreplication: boolean;
  rolbypassrls: boolean;
};

async function connectedRoleState(): Promise<RoleState> {
  const state = await query<RoleState>(
    `SELECT current_database() AS database_name,
            current_user AS role_name,
            session_user AS session_role,
            pg_get_userbyid(database.datdba) AS owner_name,
            role.rolcanlogin,
            role.rolsuper,
            role.rolcreatedb,
            role.rolcreaterole,
            role.rolreplication,
            role.rolbypassrls
       FROM pg_database AS database
       JOIN pg_roles AS role ON role.rolname = current_user
      WHERE database.datname = current_database()`,
  );
  assert.equal(state.rows.length, 1, "CI database bootstrap identity check failed.");
  return state.rows[0];
}

async function run(): Promise<void> {
  const databaseUrl = getDatabaseUrl();
  const adminUrl = new URL(databaseUrl);
  const githubEnv = process.env.GITHUB_ENV;
  if (
    process.env.CI !== "true"
    || process.env.GITHUB_ACTIONS !== "true"
    || process.env.GOSTONE_CI_DATABASE_BOOTSTRAP !== "gostone-ci-v1"
    || process.env.GOSTONE_SMOKE_DATABASE_NAME !== CI_DATABASE
    || process.env.GOSTONE_SMOKE_DATABASE_ROLE !== CI_RUNNER_ROLE
    || adminUrl.username !== CI_ADMIN_ROLE
    || !adminUrl.password
    || !githubEnv
    || githubEnv.includes("\n")
    || !isUnambiguousLocalDatabase(databaseUrl)
  ) {
    throw new Error("CI database bootstrap is not explicitly authorized.");
  }

  const initial = await connectedRoleState();
  assert.equal(initial.database_name, CI_DATABASE, "CI database bootstrap identity check failed.");
  assert.equal(initial.role_name, CI_ADMIN_ROLE, "CI database bootstrap identity check failed.");
  assert.equal(initial.session_role, CI_ADMIN_ROLE, "CI database bootstrap identity check failed.");
  assert.equal(initial.owner_name, CI_ADMIN_ROLE, "CI database bootstrap identity check failed.");
  assert.equal(initial.rolcanlogin, true, "CI database bootstrap role check failed.");
  assert.equal(initial.rolsuper, true, "CI database bootstrap role check failed.");

  const publicRelations = await query<{ count: number }>(
    `SELECT COUNT(*)::int AS count
       FROM pg_class AS relation
       JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = 'public'
        AND relation.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')`,
  );
  assert.equal(publicRelations.rows[0].count, 0, "CI smoke database is not empty.");

  const existingClientRoles = await query<{ role_name: string }>(
    `SELECT rolname AS role_name
       FROM pg_roles
      WHERE rolname IN ('anon', 'authenticated', 'gostone_ci_runner')`,
  );
  assert.equal(existingClientRoles.rows.length, 0, "CI smoke roles already exist.");

  const bootstrapPassword = decodeURIComponent(adminUrl.password);
  await withTransaction(async (client) => {
    await client.query(
      "SELECT set_config('gostone.bootstrap_password', $1, TRUE)",
      [bootstrapPassword],
    );
    await client.query(
      `DO $bootstrap$
       BEGIN
         EXECUTE format(
           'CREATE ROLE gostone_ci_runner WITH LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS',
           current_setting('gostone.bootstrap_password')
         );
       END
       $bootstrap$`,
    );
    await client.query(`CREATE ROLE anon NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
                          NOINHERIT NOREPLICATION NOBYPASSRLS`);
    await client.query(`CREATE ROLE authenticated NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
                          NOINHERIT NOREPLICATION NOBYPASSRLS`);
    await client.query("ALTER DATABASE gostone_ci OWNER TO gostone_ci_runner");
  });
  await closePool();

  adminUrl.username = CI_RUNNER_ROLE;
  const runnerDatabaseUrl = adminUrl.toString();
  process.env.DATABASE_URL = runnerDatabaseUrl;
  await assertSmokeDatabaseIdentity(getPool());
  const demoted = await connectedRoleState();
  assert.equal(demoted.owner_name, CI_RUNNER_ROLE, "CI database owner handoff failed.");
  assert.equal(demoted.rolcanlogin, true, "CI database owner handoff failed.");
  assert.equal(demoted.rolsuper, false, "CI database owner handoff failed.");
  assert.equal(demoted.rolcreatedb, false, "CI database owner handoff failed.");
  assert.equal(demoted.rolcreaterole, false, "CI database owner handoff failed.");
  assert.equal(demoted.rolreplication, false, "CI database owner handoff failed.");
  assert.equal(demoted.rolbypassrls, false, "CI database owner handoff failed.");
  await appendFile(githubEnv, `DATABASE_URL=${runnerDatabaseUrl}\n`, "utf8");
  console.log("Prepared empty PostgreSQL CI database with a dedicated nonsuper owner and client roles.");
}

run()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "CI database bootstrap failed.");
    process.exitCode = 1;
  })
  .finally(closePool);
