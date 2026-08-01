import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { QueryResult } from "pg";
import {
  aggregateScenario,
  classifyPollQuery,
  executeClassifiedPollQuery,
  formatPollBenchmarkError,
  percentile,
  PollBenchmarkInvariantError,
  POLL_BENCHMARK_CONTRACTS,
  POLL_BENCHMARK_SCENARIOS,
  POLL_BENCHMARK_SQL_CASES,
  pollQueryRecord,
  resolvePollBenchmarkFailure,
  serializeSafePollBenchmarkReport,
  type PollBenchmarkReport,
  type PollBenchmarkScenario,
  type PollBenchmarkStatement,
  type PollMeasurement,
  type PollQueryRecord,
  type PollScenarioAggregate,
} from "./pollBenchmark";

test("classifies every exact poll SQL fingerprint and rejects near misses", () => {
  assert.ok(POLL_BENCHMARK_SQL_CASES.length > 0);
  for (const sqlCase of POLL_BENCHMARK_SQL_CASES) {
    assert.equal(classifyPollQuery(sqlCase.sql), sqlCase.statement);
    assert.throws(() => classifyPollQuery(`${sqlCase.sql};`), /unclassified query/);
    assert.throws(() => classifyPollQuery(`${sqlCase.sql} /* appended */`), /unclassified query/);
  }
  assert.throws(
    () => classifyPollQuery("SELECT black_player_key, white_player_key, secret FROM games WHERE id = $1"),
    /unclassified query/,
  );
  assert.throws(
    () => classifyPollQuery("UPDATE games SET phase = 'play' WHERE id = $1 RETURNING *"),
    /unclassified query/,
  );
  const gameRead = POLL_BENCHMARK_SQL_CASES.find(
    ({ statement, locking }) => statement === "game_read" && !locking,
  )!.sql;
  assert.ok(gameRead.includes("'Guest '"));
  assert.throws(
    () => classifyPollQuery(gameRead.replace("'Guest '", "'guest '")),
    /unclassified query/,
  );
});

test("rejects unknown SQL before invoking the database operation", async () => {
  let executed = false;
  await assert.rejects(
    executeClassifiedPollQuery(
      "SELECT secret FROM unexpected_table",
      async () => {
        executed = true;
        return { rows: [], rowCount: 0 } as unknown as QueryResult<Record<string, never>>;
      },
    ),
    /unclassified query/,
  );
  assert.equal(executed, false);
});

test("separates returned, affected, locking-statement, and locked-row evidence", () => {
  const timeoutSql = POLL_BENCHMARK_SQL_CASES.find(
    ({ statement }) => statement === "timeout_game_update",
  )!.sql;
  const updateResult = {
    rows: [{ version: 151 }],
    rowCount: 1,
  } as unknown as QueryResult<{ version: number }>;
  assert.deepEqual(pollQueryRecord(timeoutSql, 1.25, updateResult), {
    statement: "timeout_game_update",
    durationMs: 1.25,
    returnedRows: 1,
    affectedRows: 1,
    lockedRows: 0,
    read: false,
    write: true,
    locking: false,
  });

  const ratingSql = POLL_BENCHMARK_SQL_CASES.find(
    ({ statement }) => statement === "rating_history_read",
  )!.sql;
  const emptyResult = { rows: [], rowCount: 0 } as unknown as QueryResult<Record<string, never>>;
  const lockedRead = pollQueryRecord(ratingSql, 0.5, emptyResult);
  assert.equal(lockedRead.locking, true);
  assert.equal(lockedRead.lockedRows, 0);
  assert.equal(lockedRead.returnedRows, 0);
  assert.equal(lockedRead.affectedRows, 0);
});

test("uses nearest-rank percentiles and rejects invalid samples", () => {
  assert.equal(percentile([4, 1, 3, 2], 0.5), 2);
  assert.equal(percentile([4, 1, 3, 2], 0.95), 4);
  assert.throws(() => percentile([], 0.5), /at least one sample/);
  assert.throws(() => percentile([1, Number.NaN], 0.5), /sample is invalid/);
  assert.throws(() => percentile([1], 1.1), /rank is invalid/);
});

const READS = new Set<PollBenchmarkStatement>([
  "participant_read",
  "game_read",
  "moves_read",
  "resume_events_read",
  "scoring_read",
  "dead_stones_read",
  "rating_history_read",
  "rating_participants_read",
]);
const WRITES = new Set<PollBenchmarkStatement>([
  "scoring_resume_insert",
  "scoring_delete",
  "timeout_game_update",
  "deadline_resume_game_update",
]);

function contractMeasurement(name: PollBenchmarkScenario): PollMeasurement {
  const expected = POLL_BENCHMARK_CONTRACTS[name].perPoll;
  const queries: PollQueryRecord[] = expected.statementSequence.map((statement) => ({
    statement,
    durationMs: 0.25,
    returnedRows: 0,
    affectedRows: 0,
    lockedRows: 0,
    read: READS.has(statement),
    write: WRITES.has(statement),
    locking: false,
  }));
  const lockingIndexes = name === "play_timeout_150"
    ? [11, 14, 16, 17]
    : name === "scoring_expiry_302"
      ? [11, 14]
      : [];
  for (const index of lockingIndexes) {
    queries[index] = { ...queries[index], locking: true };
  }
  queries[0] = { ...queries[0], returnedRows: expected.returnedRows };
  if (expected.lockedRows > 0) {
    const index = lockingIndexes[0];
    queries[index] = { ...queries[index], lockedRows: expected.lockedRows };
  }
  let remainingAffected = expected.affectedRows;
  for (let index = 0; index < queries.length && remainingAffected > 0; index += 1) {
    if (queries[index].write) {
      queries[index] = { ...queries[index], affectedRows: 1 };
      remainingAffected -= 1;
    }
  }
  return { durationMs: 4, responseBytes: 120, queries };
}

test("binds aggregation to the complete ordered scenario contract", () => {
  const contract = POLL_BENCHMARK_CONTRACTS.play_current_0;
  const definition = {
    name: contract.name,
    positionMoves: contract.positionMoves,
    knownVersion: contract.knownVersion,
    response: contract.response,
    responseMoves: contract.responseMoves,
  };
  const aggregate = aggregateScenario(
    definition,
    [contractMeasurement("play_current_0"), contractMeasurement("play_current_0")],
  );
  assert.equal(aggregate.iterations, 2);
  assert.deepEqual(aggregate.perPoll, contract.perPoll);
  assert.throws(
    () => aggregateScenario(definition, [{ ...contractMeasurement("play_current_0"), queries: [] }]),
    /query contract changed/,
  );
});

function scenarioAggregate(name: PollBenchmarkScenario): PollScenarioAggregate {
  const expected = POLL_BENCHMARK_CONTRACTS[name];
  return {
    name: expected.name,
    positionMoves: expected.positionMoves,
    knownVersion: expected.knownVersion,
    response: expected.response,
    responseMoves: expected.responseMoves,
    iterations: 10,
    perPoll: expected.perPoll,
    latencyMs: { p50: 1, p95: 2, maximum: 3 },
    databaseMs: { p50: 1, p95: 2, maximum: 3 },
    responseBytes: { p50: 100, p95: 120, maximum: 140 },
  };
}

function safeReport(includeExpiry = false): PollBenchmarkReport {
  return {
    benchmark: "verified-game-polls-v1",
    mode: "ci-correctness",
    latencyAdvisoryOnly: true,
    scoringExpiryIncluded: includeExpiry,
    scenarios: POLL_BENCHMARK_SCENARIOS
      .filter((name) => includeExpiry || name !== "scoring_expiry_302")
      .map(scenarioAggregate),
  };
}

test("serializes a fresh complete allowlisted snapshot", () => {
  const serialized = serializeSafePollBenchmarkReport(safeReport(true));
  const parsed = JSON.parse(serialized) as PollBenchmarkReport;
  assert.deepEqual(parsed, safeReport(true));
  assert.equal(serialized.includes("postgresql://"), false);
  assert.equal(serialized.includes("$1"), false);
});

test("rejects primitives, null, custom prototypes, getters, and toJSON hooks", () => {
  for (const value of [null, undefined, 1, "report", true]) {
    assert.throws(() => serializeSafePollBenchmarkReport(value));
  }

  const custom = Object.assign(Object.create({ unsafe: true }), safeReport());
  assert.throws(() => serializeSafePollBenchmarkReport(custom));

  const proxied = new Proxy(safeReport(), {});
  assert.throws(() => serializeSafePollBenchmarkReport(proxied));

  const symbolReport = { ...safeReport(), [Symbol("hidden")]: "secret" };
  assert.throws(() => serializeSafePollBenchmarkReport(symbolReport));

  let getterCalled = false;
  const getterReport = { ...safeReport() } as Record<string, unknown>;
  Object.defineProperty(getterReport, "mode", {
    enumerable: true,
    get() {
      getterCalled = true;
      return "ci-correctness";
    },
  });
  assert.throws(() => serializeSafePollBenchmarkReport(getterReport));
  assert.equal(getterCalled, false);

  const toJsonReport = { ...safeReport(), toJSON: () => ({ leaked: true }) };
  assert.throws(() => serializeSafePollBenchmarkReport(toJsonReport), /report is invalid/);
});

test("rejects incomplete, duplicate, inconsistent, unordered, and leaking reports", () => {
  const missing = { ...safeReport(), scenarios: safeReport().scenarios.slice(1) };
  assert.throws(() => serializeSafePollBenchmarkReport(missing), /coverage is incomplete/);

  const duplicate = {
    ...safeReport(),
    scenarios: [safeReport().scenarios[0], ...safeReport().scenarios],
  };
  assert.throws(() => serializeSafePollBenchmarkReport(duplicate), /coverage is incomplete/);

  const zeroShape = structuredClone(safeReport()) as PollBenchmarkReport;
  (zeroShape.scenarios[0].perPoll as { statements: number }).statements = 0;
  assert.throws(() => serializeSafePollBenchmarkReport(zeroShape), /statement total is inconsistent/);

  const unordered = structuredClone(safeReport()) as PollBenchmarkReport;
  (unordered.scenarios[0].latencyMs as { p50: number }).p50 = 4;
  assert.throws(() => serializeSafePollBenchmarkReport(unordered), /range is unordered/);

  const unsafeCount = structuredClone(safeReport()) as PollBenchmarkReport;
  (unsafeCount.scenarios[0] as { iterations: number }).iterations = Number.MAX_SAFE_INTEGER + 1;
  assert.throws(() => serializeSafePollBenchmarkReport(unsafeCount), /iteration count is invalid/);

  const fractionalBytes = structuredClone(safeReport()) as PollBenchmarkReport;
  (fractionalBytes.scenarios[0].responseBytes as { p50: number }).p50 = 100.5;
  assert.throws(
    () => serializeSafePollBenchmarkReport(fractionalBytes),
    /integer percentile is invalid/,
  );

  const connectionLeak = { ...safeReport(), mode: "postgresql://runner:secret@127.0.0.1/db" };
  assert.throws(() => serializeSafePollBenchmarkReport(connectionLeak), /mode is invalid/);
  const identifierLeak = {
    ...safeReport(),
    benchmark: "5f4c2044-d159-4cb8-9138-b12d74f85a50",
  };
  assert.throws(() => serializeSafePollBenchmarkReport(identifierLeak), /name is invalid/);
});

test("cleanup failures take fixed precedence over execution and close failures", () => {
  const executionFailure = new Error("sensitive database detail");
  assert.equal(
    resolvePollBenchmarkFailure(executionFailure, true, false, false),
    executionFailure,
  );
  assert.match(
    (resolvePollBenchmarkFailure(executionFailure, true, true, true) as Error).message,
    /failed and fixture cleanup could not be verified/,
  );
  assert.match(
    (resolvePollBenchmarkFailure(null, false, true, false) as Error).message,
    /fixture cleanup could not be verified/,
  );
  assert.match(
    (resolvePollBenchmarkFailure(executionFailure, true, false, true) as Error).message,
    /failed and database cleanup could not be completed/,
  );
  assert.match(
    (resolvePollBenchmarkFailure(null, true, false, false) as Error).message,
    /execution failed safely/,
  );
});

test("database failures reveal only an allow-listed benchmark stage", () => {
  assert.equal(
    formatPollBenchmarkError(
      new Error("postgresql://runner:secret@127.0.0.1/db relation private_table"),
      "fixture_seeding",
    ),
    "Verified game-poll benchmark failed safely during fixture_seeding.",
  );
  assert.equal(
    formatPollBenchmarkError(
      new PollBenchmarkInvariantError("The benchmark contract is invalid."),
      "stable_measurement",
    ),
    "The benchmark contract is invalid.",
  );
});

test("the runner installs classification before validation and retains graceful cleanup guards", () => {
  const source = readFileSync(
    new URL("../../scripts/benchmark-game-polls.ts", import.meta.url),
    "utf8",
  );
  const facade = source.indexOf("globalThis.goStonedDbPool = facade;");
  const firstValidation = source.indexOf("await validateStableFixture");
  assert.ok(facade >= 0 && firstValidation > facade);
  assert.ok(source.includes("process.on(\"SIGINT\", handleSigint)"));
  assert.ok(source.includes("process.on(\"SIGTERM\", handleSigterm)"));
  assert.ok(source.includes("SET LOCAL statement_timeout"));
  assert.ok(source.includes("WHERE rolname = current_user"));
  assert.ok(!source.includes("pg_catalog.current_user"));
  assert.ok(source.includes("await cleanupOwnedFixtures(pool, ownedGameIds)"));
});
