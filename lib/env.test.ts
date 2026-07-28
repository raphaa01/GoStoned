import assert from "node:assert/strict";
import test from "node:test";
import { isLocalDatabase, isUnambiguousLocalDatabase } from "./env";

test("classifies the effective node-postgres connection target", () => {
  for (const databaseUrl of [
    "postgresql://gostone:test@localhost:5432/gostone",
    "postgres://gostone:test@LOCALHOST:5432/gostone",
    "postgresql://gostone:test@127.0.0.1:5432/gostone",
    "postgresql://gostone:p%40ss@localhost:5432/gostone?sslmode=disable",
    "postgresql://gostone:test@remote.example:5432/gostone?host=localhost",
    "postgresql://gostone:test@localhost:5432/gostone?host=",
    "postgresql://gostone:test@localhost:5432/gostone?host=%2Fvar%2Frun%2Fpostgresql",
    "postgresql://gostone:test@localhost:5432/gostone?hostaddr=203.0.113.10",
    "postgresql://gostone:test@localhost:5432/gostone?service=production",
  ]) {
    assert.equal(isLocalDatabase(databaseUrl), true, databaseUrl);
  }
});

test("rejects non-PostgreSQL, malformed, and non-loopback URLs", () => {
  for (const databaseUrl of [
    "",
    "not a URL",
    "http://localhost:5432/gostone",
    "postgresql:///gostone",
    "postgresql://gostone:test@database.internal:5432/gostone",
    "postgresql://gostone:test@localhost.example:5432/gostone",
    "postgresql://gostone:test@127.0.0.2:5432/gostone",
    "postgresql://gostone:test@[::1]:5432/gostone",
    "postgresql://gostone:test@localhost,remote.example:5432/gostone",
    " postgresql://gostone:test@localhost:5432/gostone",
    "postgresql://gostone:test@localhost:5432/gostone ",
    "postgresql://gostone:test@localhost:5432/gostone?host=localhost&host=remote.example",
  ]) {
    assert.equal(isLocalDatabase(databaseUrl), false, databaseUrl);
  }
});

test("accepts only unambiguous TCP loopback URLs for destructive tests", () => {
  for (const databaseUrl of [
    "postgresql://gostone:test@localhost:5432/gostone",
    "postgres://gostone:test@127.0.0.1:5432/gostone?sslmode=disable",
  ]) {
    assert.equal(isUnambiguousLocalDatabase(databaseUrl), true, databaseUrl);
  }

  for (const override of [
    "host=remote.example",
    "host=%2Fvar%2Frun%2Fpostgresql",
    "host=",
    "hostaddr=203.0.113.10",
    "service=production",
    "SERVICE=production",
    "servicefile=%2Ftmp%2Fpg_service.conf",
  ]) {
    const databaseUrl = `postgresql://gostone:test@localhost:5432/gostone?${override}`;
    assert.equal(isUnambiguousLocalDatabase(databaseUrl), false, databaseUrl);
  }

  assert.equal(
    isUnambiguousLocalDatabase("postgresql://gostone:test@[::1]:5432/gostone"),
    false,
  );
  assert.equal(
    isUnambiguousLocalDatabase(" postgresql://gostone:test@localhost:5432/gostone"),
    false,
  );
});
