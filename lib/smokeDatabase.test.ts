import assert from "node:assert/strict";
import test from "node:test";
import type { QueryResult, QueryResultRow } from "pg";
import {
  assertSmokeDatabaseIdentity,
  getSmokeDatabaseExpectation,
  withRollbackOnlyTransaction,
} from "./smokeDatabase";

function result<T extends QueryResultRow>(rows: T[]): QueryResult<T> {
  return { command: "SELECT", fields: [], oid: 0, rowCount: rows.length, rows };
}

test("requires explicit safe database and role names before querying", async () => {
  for (const env of [
    {},
    { GOSTONE_SMOKE_DATABASE_NAME: "gostone" },
    {
      GOSTONE_SMOKE_DATABASE_NAME: "gostone; DROP DATABASE production",
      GOSTONE_SMOKE_DATABASE_ROLE: "runner",
    },
  ]) {
    assert.throws(
      () => getSmokeDatabaseExpectation(env),
      /identity is not explicitly configured/,
    );
  }
});

test("accepts only the exact connected database, current role, and session role", async () => {
  const expected = { databaseName: "gostone_ci", roleName: "gostone_ci_runner" };
  await assert.doesNotReject(assertSmokeDatabaseIdentity({
    async query<T extends QueryResultRow>() {
      return result([{
        database_name: "gostone_ci",
        role_name: "gostone_ci_runner",
        session_role: "gostone_ci_runner",
      }]) as unknown as QueryResult<T>;
    },
  }, expected));

  const failures = [
    [],
    [{ database_name: "wrong", role_name: "gostone_ci_runner", session_role: "gostone_ci_runner" }],
    [{ database_name: "gostone_ci", role_name: "wrong", session_role: "gostone_ci_runner" }],
    [{ database_name: "gostone_ci", role_name: "gostone_ci_runner", session_role: "wrong" }],
    [
      { database_name: "gostone_ci", role_name: "gostone_ci_runner", session_role: "gostone_ci_runner" },
      { database_name: "gostone_ci", role_name: "gostone_ci_runner", session_role: "gostone_ci_runner" },
    ],
  ];
  for (const rows of failures) {
    await assert.rejects(
      assertSmokeDatabaseIdentity({
        async query<T extends QueryResultRow>() {
          return result(rows) as unknown as QueryResult<T>;
        },
      }, expected),
      (error: Error) => {
        assert.equal(error.message, "Smoke database identity check failed.");
        assert.equal(error.message.includes("gostone_ci"), false);
        assert.equal(error.message.includes("wrong"), false);
        return true;
      },
    );
  }
});

test("rollback-only transactions never commit successful or failed probes", async () => {
  for (const failProbe of [false, true]) {
    const statements: string[] = [];
    const database = {
      async query<T extends QueryResultRow>(statement: string) {
        statements.push(statement);
        if (statement === "DESTRUCTIVE PROBE" && failProbe) throw new Error("expected rejection");
        return result([]) as QueryResult<T>;
      },
    };
    const operation = withRollbackOnlyTransaction(database, async (transaction) => {
      await transaction.query("DESTRUCTIVE PROBE");
      assert.fail("The protection under test unexpectedly allowed the probe.");
    });
    await assert.rejects(
      operation,
      failProbe ? /expected rejection/ : /unexpectedly allowed the probe/,
    );
    assert.deepEqual(statements, ["BEGIN", "DESTRUCTIVE PROBE", "ROLLBACK"]);
    assert.equal(statements.includes("COMMIT"), false);
  }
});
