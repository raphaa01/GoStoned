import type { QueryResult, QueryResultRow } from "pg";
import { isProxy } from "node:util/types";

export const POLL_BENCHMARK_STATEMENTS = [
  "participant_read",
  "read_only_begin",
  "transaction_begin",
  "statement_timeout",
  "game_read",
  "moves_read",
  "resume_events_read",
  "scoring_read",
  "dead_stones_read",
  "rating_history_read",
  "registered_users_read",
  "scoring_resume_insert",
  "scoring_delete",
  "timeout_game_update",
  "deadline_resume_game_update",
  "transaction_commit",
  "transaction_rollback",
] as const;

export type PollBenchmarkStatement = typeof POLL_BENCHMARK_STATEMENTS[number];

export const POLL_BENCHMARK_SCENARIOS = [
  "play_current_0",
  "play_current_150",
  "play_current_300",
  "play_stale_300",
  "play_future_300",
  "scoring_current_302",
  "play_timeout_150",
  "scoring_expiry_302",
] as const;

export type PollBenchmarkScenario = typeof POLL_BENCHMARK_SCENARIOS[number];

export const POLL_BENCHMARK_STAGES = [
  "environment_authorization",
  "runner_identity",
  "fixture_generation",
  "fixture_seeding",
  "fixture_validation",
  "stable_warmup",
  "stable_measurement",
  "timeout_warmup",
  "timeout_measurement",
  "scoring_expiry_warmup",
  "scoring_expiry_measurement",
  "report_serialization",
] as const;

export type PollBenchmarkStage = typeof POLL_BENCHMARK_STAGES[number];

type QueryMetadata = Readonly<{
  statement: PollBenchmarkStatement;
  read: boolean;
  write: boolean;
  locking: boolean;
}>;

export type PollQueryRecord = QueryMetadata & Readonly<{
  durationMs: number;
  returnedRows: number;
  affectedRows: number;
  lockedRows: number;
}>;

export type PollMeasurement = Readonly<{
  durationMs: number;
  responseBytes: number;
  queries: readonly PollQueryRecord[];
}>;

export type PollScenarioDefinition = Readonly<{
  name: PollBenchmarkScenario;
  positionMoves: number;
  knownVersion: "current" | "stale" | "future";
  response: "heartbeat" | "full";
  responseMoves: number | null;
}>;

export type PollQueryShape = Readonly<{
  statements: number;
  reads: number;
  writes: number;
  lockingStatements: number;
  returnedRows: number;
  affectedRows: number;
  lockedRows: number;
  statementCounts: Readonly<Record<PollBenchmarkStatement, number>>;
  statementSequence: readonly PollBenchmarkStatement[];
}>;

export type PollScenarioAggregate = PollScenarioDefinition & Readonly<{
  iterations: number;
  perPoll: PollQueryShape;
  latencyMs: Readonly<{ p50: number; p95: number; maximum: number }>;
  databaseMs: Readonly<{ p50: number; p95: number; maximum: number }>;
  responseBytes: Readonly<{ p50: number; p95: number; maximum: number }>;
}>;

export type PollBenchmarkReport = Readonly<{
  benchmark: "verified-game-polls-v1";
  mode: "ci-correctness" | "local";
  latencyAdvisoryOnly: true;
  scoringExpiryIncluded: boolean;
  scenarios: readonly PollScenarioAggregate[];
}>;

export class PollBenchmarkInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PollBenchmarkInvariantError";
  }
}

export function formatPollBenchmarkError(
  error: unknown,
  stage: PollBenchmarkStage,
): string {
  return error instanceof PollBenchmarkInvariantError
    ? error.message
    : `Verified game-poll benchmark failed safely during ${stage}.`;
}

export function resolvePollBenchmarkFailure(
  executionFailure: unknown,
  executionFailed: boolean,
  cleanupFailed: boolean,
  closeFailed: boolean,
): unknown {
  if (cleanupFailed) {
    return new PollBenchmarkInvariantError(
      executionFailed
        ? "The benchmark failed and fixture cleanup could not be verified."
        : "Benchmark fixture cleanup could not be verified.",
    );
  }
  if (closeFailed) {
    return new PollBenchmarkInvariantError(
      executionFailed
        ? "The benchmark failed and database cleanup could not be completed."
        : "Benchmark database cleanup could not be completed.",
    );
  }
  if (!executionFailed) return null;
  return executionFailure instanceof Error
    ? executionFailure
    : new PollBenchmarkInvariantError("Benchmark execution failed safely.");
}

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new PollBenchmarkInvariantError(message);
}

function normalizedSql(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

const PARTICIPANT_READ_SQL = `
  SELECT black_player_key, white_player_key
    FROM games
   WHERE id = $1
`;

const GAME_READ_SQL = `
  SELECT g.id, g.board_size, g.black_player_key, g.white_player_key, g.winner_key,
         g.status, g.phase, g.to_move, g.consecutive_passes, g.scoring_revision,
         g.result, g.finish_reason, g.last_resume_claim, g.last_resume_by,
         g.last_resume_x, g.last_resume_y, g.komi, g.rules, g.rules_profile,
         g.scoring_method, g.handicap, g.time_control, g.main_time_seconds,
         g.byo_yomi_periods, g.byo_yomi_seconds,
         g.black_time_remaining_ms, g.white_time_remaining_ms,
         g.black_periods_remaining, g.white_periods_remaining,
         g.turn_started_at, g.version, g.started_at, g.finished_at,
         COALESCE(
           CASE WHEN g.black_player_key = game_bot.bot_player_key THEN game_bot.display_name END,
           NULLIF(BTRIM(black_user.display_name), ''),
           black_user.username,
           'Guest ' || UPPER(RIGHT(g.black_player_key, 6))
         ) AS black_player_name,
         COALESCE(
           CASE WHEN g.white_player_key = game_bot.bot_player_key THEN game_bot.display_name END,
           NULLIF(BTRIM(white_user.display_name), ''),
           white_user.username,
           'Guest ' || UPPER(RIGHT(g.white_player_key, 6))
         ) AS white_player_name,
         g.black_player_key = game_bot.bot_player_key AS black_player_is_bot,
         g.white_player_key = game_bot.bot_player_key AS white_player_is_bot,
         CASE
           WHEN g.status = 'finished' THEN (
             SELECT COUNT(DISTINCT history.player_key) = 2
               FROM player_rating_history history
              WHERE history.game_id = g.id
                AND history.player_key IN (g.black_player_key, g.white_player_key)
           )
         ELSE g.black_player_key <> g.white_player_key
             AND (
               (black_user.id IS NOT NULL AND white_user.id IS NOT NULL)
               OR (
                 game_bot.game_id IS NOT NULL
                 AND (
                   (g.black_player_key = game_bot.bot_player_key AND white_user.id IS NOT NULL)
                   OR (g.white_player_key = game_bot.bot_player_key AND black_user.id IS NOT NULL)
                 )
               )
             )
       END AS rated
    FROM games g
    LEFT JOIN users black_user
      ON g.black_player_key = 'user:' || black_user.id::text
    LEFT JOIN users white_user
      ON g.white_player_key = 'user:' || white_user.id::text
    LEFT JOIN game_bots game_bot ON game_bot.game_id = g.id
   WHERE g.id = $1
`;

const MOVES_READ_SQL = `
  SELECT move_number, color, x, y, is_pass, board_hash, created_at
    FROM moves
   WHERE game_id = $1
   ORDER BY move_number
`;

const RESUME_EVENTS_READ_SQL = `
  SELECT scoring_revision, board_hash, stopped_move_number,
         rules, rules_profile, scoring_method, komi, handicap,
         fallback_to_move, scoring_expires_at, resume_claim,
         requested_by_color, disputed_x, disputed_y,
         resumed_to_move, resumed_at
    FROM game_scoring_resume_events
   WHERE game_id = $1
   ORDER BY scoring_revision
   LIMIT $2
`;

const SCORING_READ_SQL = "SELECT * FROM game_scoring_state WHERE game_id = $1";

const DEAD_STONES_READ_SQL = `
  SELECT x, y, color
    FROM game_dead_stones
   WHERE game_id = $1
   ORDER BY y, x
`;

const RATING_HISTORY_READ_SQL = `
  SELECT player_key
    FROM player_rating_history
   WHERE game_id = $1
   FOR UPDATE
`;

const REGISTERED_USERS_READ_SQL = `
  SELECT 'user:' || id::text AS player_key
    FROM users
   WHERE 'user:' || id::text IN ($1::text, $2::text)
`;

const SCORING_RESUME_INSERT_SQL = `
  INSERT INTO game_scoring_resume_events
    (game_id, scoring_revision, board_hash, stopped_move_number,
     rules, rules_profile, scoring_method, komi, handicap,
     fallback_to_move, scoring_expires_at, resume_claim,
     requested_by_color, disputed_x, disputed_y, resumed_to_move, resumed_at)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9,
          $10, $11, $12, $13, $14, $15, $16, $17)
`;

const TIMEOUT_GAME_UPDATE_SQL = `
  UPDATE games
     SET status = 'finished', phase = 'play', to_move = NULL,
         finish_reason = 'timeout', result = $2, winner_key = $3,
         black_time_remaining_ms = CASE WHEN $4 = 'black' THEN 0 ELSE black_time_remaining_ms END,
         white_time_remaining_ms = CASE WHEN $4 = 'white' THEN 0 ELSE white_time_remaining_ms END,
         black_periods_remaining = CASE WHEN $4 = 'black' THEN 0 ELSE black_periods_remaining END,
         white_periods_remaining = CASE WHEN $4 = 'white' THEN 0 ELSE white_periods_remaining END,
         finished_at = $5, updated_at = $5, version = version + 1
   WHERE id = $1
   RETURNING *
`;

const DEADLINE_RESUME_GAME_UPDATE_SQL = `
  UPDATE games
     SET phase = 'play', to_move = $2, consecutive_passes = 0,
         scoring_revision = scoring_revision + 1,
         last_resume_claim = 'deadline', last_resume_by = NULL,
         last_resume_x = NULL, last_resume_y = NULL,
         turn_started_at = $3, updated_at = $4, version = version + 1
   WHERE id = $1
   RETURNING *
`;

function sqlCase(sql: string, metadata: QueryMetadata): readonly [string, QueryMetadata] {
  return [normalizedSql(sql), metadata];
}

const SQL_CASES = [
  sqlCase(PARTICIPANT_READ_SQL, {
    statement: "participant_read", read: true, write: false, locking: false,
  }),
  sqlCase("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY", {
    statement: "read_only_begin", read: false, write: false, locking: false,
  }),
  sqlCase("BEGIN", {
    statement: "transaction_begin", read: false, write: false, locking: false,
  }),
  sqlCase("SET LOCAL statement_timeout = '8s'", {
    statement: "statement_timeout", read: false, write: false, locking: false,
  }),
  sqlCase(GAME_READ_SQL, {
    statement: "game_read", read: true, write: false, locking: false,
  }),
  sqlCase(`${GAME_READ_SQL} FOR UPDATE OF g`, {
    statement: "game_read", read: true, write: false, locking: true,
  }),
  sqlCase(MOVES_READ_SQL, {
    statement: "moves_read", read: true, write: false, locking: false,
  }),
  sqlCase(RESUME_EVENTS_READ_SQL, {
    statement: "resume_events_read", read: true, write: false, locking: false,
  }),
  sqlCase(SCORING_READ_SQL, {
    statement: "scoring_read", read: true, write: false, locking: false,
  }),
  sqlCase(`${SCORING_READ_SQL} FOR UPDATE`, {
    statement: "scoring_read", read: true, write: false, locking: true,
  }),
  sqlCase(DEAD_STONES_READ_SQL, {
    statement: "dead_stones_read", read: true, write: false, locking: false,
  }),
  sqlCase(RATING_HISTORY_READ_SQL, {
    statement: "rating_history_read", read: true, write: false, locking: true,
  }),
  sqlCase(REGISTERED_USERS_READ_SQL, {
    statement: "registered_users_read", read: true, write: false, locking: false,
  }),
  sqlCase(SCORING_RESUME_INSERT_SQL, {
    statement: "scoring_resume_insert", read: false, write: true, locking: false,
  }),
  sqlCase("DELETE FROM game_scoring_state WHERE game_id = $1", {
    statement: "scoring_delete", read: false, write: true, locking: false,
  }),
  sqlCase(TIMEOUT_GAME_UPDATE_SQL, {
    statement: "timeout_game_update", read: false, write: true, locking: false,
  }),
  sqlCase(DEADLINE_RESUME_GAME_UPDATE_SQL, {
    statement: "deadline_resume_game_update", read: false, write: true, locking: false,
  }),
  sqlCase("COMMIT", {
    statement: "transaction_commit", read: false, write: false, locking: false,
  }),
  sqlCase("ROLLBACK", {
    statement: "transaction_rollback", read: false, write: false, locking: false,
  }),
] as const;

const QUERY_METADATA = new Map<string, QueryMetadata>(SQL_CASES);
invariant(QUERY_METADATA.size === SQL_CASES.length, "Benchmark SQL fingerprints are not unique.");

export const POLL_BENCHMARK_SQL_CASES = Object.freeze(
  SQL_CASES.map(([sql, metadata]) => Object.freeze({ sql, ...metadata })),
);

function queryMetadata(text: string): QueryMetadata {
  const metadata = QUERY_METADATA.get(normalizedSql(text));
  if (!metadata) throw new PollBenchmarkInvariantError("The poll issued an unclassified query.");
  return metadata;
}

export function classifyPollQuery(text: string): PollBenchmarkStatement {
  return queryMetadata(text).statement;
}

export function pollQueryRecord<T extends QueryResultRow>(
  text: string,
  durationMs: number,
  result: QueryResult<T>,
): PollQueryRecord {
  const metadata = queryMetadata(text);
  return {
    ...metadata,
    durationMs,
    returnedRows: result.rows.length,
    affectedRows: metadata.write ? (result.rowCount ?? 0) : 0,
    lockedRows: metadata.locking ? result.rows.length : 0,
  };
}

export async function executeClassifiedPollQuery<T extends QueryResultRow>(
  text: string,
  operation: () => Promise<QueryResult<T>>,
  onRecord?: (record: PollQueryRecord) => void,
): Promise<QueryResult<T>> {
  queryMetadata(text);
  const started = performance.now();
  const result = await operation();
  onRecord?.(pollQueryRecord(text, performance.now() - started, result));
  return result;
}

export function emptyStatementCounts(): Record<PollBenchmarkStatement, number> {
  return Object.fromEntries(
    POLL_BENCHMARK_STATEMENTS.map((statement) => [statement, 0]),
  ) as Record<PollBenchmarkStatement, number>;
}

function rounded(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}

export function percentile(values: readonly number[], percentileRank: number): number {
  invariant(values.length > 0, "A percentile requires at least one sample.");
  invariant(
    Number.isFinite(percentileRank) && percentileRank >= 0 && percentileRank <= 1,
    "The percentile rank is invalid.",
  );
  invariant(values.every((value) => Number.isFinite(value) && value >= 0), "A sample is invalid.");
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.ceil(percentileRank * sorted.length) - 1;
  return rounded(sorted[Math.max(0, index)]);
}

function aggregateRange(values: readonly number[]) {
  return {
    p50: percentile(values, 0.5),
    p95: percentile(values, 0.95),
    maximum: rounded(Math.max(...values)),
  };
}

export function queryShape(measurement: PollMeasurement): PollQueryShape {
  const statementCounts = emptyStatementCounts();
  let reads = 0;
  let writes = 0;
  let lockingStatements = 0;
  let returnedRows = 0;
  let affectedRows = 0;
  let lockedRows = 0;
  const statementSequence: PollBenchmarkStatement[] = [];
  for (const query of measurement.queries) {
    statementCounts[query.statement] += 1;
    statementSequence.push(query.statement);
    reads += Number(query.read);
    writes += Number(query.write);
    lockingStatements += Number(query.locking);
    returnedRows += query.returnedRows;
    affectedRows += query.affectedRows;
    lockedRows += query.lockedRows;
  }
  return {
    statements: measurement.queries.length,
    reads,
    writes,
    lockingStatements,
    returnedRows,
    affectedRows,
    lockedRows,
    statementCounts,
    statementSequence,
  };
}

function countsFor(sequence: readonly PollBenchmarkStatement[]) {
  const counts = emptyStatementCounts();
  for (const statement of sequence) counts[statement] += 1;
  return counts;
}

const PLAY_SEQUENCE: readonly PollBenchmarkStatement[] = [
  "participant_read",
  "read_only_begin",
  "statement_timeout",
  "game_read",
  "moves_read",
  "resume_events_read",
  "scoring_read",
  "transaction_commit",
];

const SCORING_SEQUENCE: readonly PollBenchmarkStatement[] = [
  ...PLAY_SEQUENCE.slice(0, -1),
  "dead_stones_read",
  "transaction_commit",
];

const TIMEOUT_SEQUENCE: readonly PollBenchmarkStatement[] = [
  ...PLAY_SEQUENCE,
  "transaction_begin",
  "statement_timeout",
  "game_read",
  "moves_read",
  "resume_events_read",
  "scoring_read",
  "timeout_game_update",
  "rating_history_read",
  "registered_users_read",
  "transaction_commit",
];

const EXPIRY_SEQUENCE: readonly PollBenchmarkStatement[] = [
  ...SCORING_SEQUENCE,
  "transaction_begin",
  "statement_timeout",
  "game_read",
  "moves_read",
  "resume_events_read",
  "scoring_read",
  "dead_stones_read",
  "scoring_resume_insert",
  "scoring_delete",
  "deadline_resume_game_update",
  "transaction_commit",
];

type ScenarioContract = PollScenarioDefinition & Readonly<{ perPoll: PollQueryShape }>;

function contract(
  definition: PollScenarioDefinition,
  sequence: readonly PollBenchmarkStatement[],
  totals: Readonly<{
    reads: number;
    writes: number;
    lockingStatements: number;
    returnedRows: number;
    affectedRows: number;
    lockedRows: number;
  }>,
): ScenarioContract {
  const statementSequence = Object.freeze([...sequence]);
  const perPoll = Object.freeze({
    statements: statementSequence.length,
    ...totals,
    statementCounts: Object.freeze(countsFor(statementSequence)),
    statementSequence,
  });
  return Object.freeze({
    ...definition,
    perPoll,
  });
}

const PLAY_TOTALS = (moveCount: number) => ({
  reads: 5,
  writes: 0,
  lockingStatements: 0,
  returnedRows: moveCount + 2,
  affectedRows: 0,
  lockedRows: 0,
});

export const POLL_BENCHMARK_CONTRACTS: Readonly<Record<PollBenchmarkScenario, ScenarioContract>> = Object.freeze({
  play_current_0: contract(
    { name: "play_current_0", positionMoves: 0, knownVersion: "current", response: "heartbeat", responseMoves: null },
    PLAY_SEQUENCE,
    PLAY_TOTALS(0),
  ),
  play_current_150: contract(
    { name: "play_current_150", positionMoves: 150, knownVersion: "current", response: "heartbeat", responseMoves: null },
    PLAY_SEQUENCE,
    PLAY_TOTALS(150),
  ),
  play_current_300: contract(
    { name: "play_current_300", positionMoves: 300, knownVersion: "current", response: "heartbeat", responseMoves: null },
    PLAY_SEQUENCE,
    PLAY_TOTALS(300),
  ),
  play_stale_300: contract(
    { name: "play_stale_300", positionMoves: 300, knownVersion: "stale", response: "full", responseMoves: 300 },
    PLAY_SEQUENCE,
    PLAY_TOTALS(300),
  ),
  play_future_300: contract(
    { name: "play_future_300", positionMoves: 300, knownVersion: "future", response: "full", responseMoves: 300 },
    PLAY_SEQUENCE,
    PLAY_TOTALS(300),
  ),
  scoring_current_302: contract(
    { name: "scoring_current_302", positionMoves: 300, knownVersion: "current", response: "heartbeat", responseMoves: null },
    SCORING_SEQUENCE,
    { reads: 6, writes: 0, lockingStatements: 0, returnedRows: 305, affectedRows: 0, lockedRows: 0 },
  ),
  play_timeout_150: contract(
    { name: "play_timeout_150", positionMoves: 150, knownVersion: "current", response: "full", responseMoves: 150 },
    TIMEOUT_SEQUENCE,
    { reads: 11, writes: 1, lockingStatements: 3, returnedRows: 304, affectedRows: 1, lockedRows: 1 },
  ),
  scoring_expiry_302: contract(
    { name: "scoring_expiry_302", positionMoves: 300, knownVersion: "current", response: "full", responseMoves: 302 },
    EXPIRY_SEQUENCE,
    { reads: 11, writes: 3, lockingStatements: 2, returnedRows: 610, affectedRows: 3, lockedRows: 2 },
  ),
});

function sameData(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function assertScenarioMeasurement(
  scenario: PollBenchmarkScenario,
  measurement: PollMeasurement,
): void {
  invariant(
    sameData(queryShape(measurement), POLL_BENCHMARK_CONTRACTS[scenario].perPoll),
    "The poll query contract changed.",
  );
}

export function aggregateScenario(
  definition: PollScenarioDefinition,
  measurements: readonly PollMeasurement[],
): PollScenarioAggregate {
  invariant(measurements.length > 0, "A benchmark scenario requires at least one measurement.");
  const scenarioContract = POLL_BENCHMARK_CONTRACTS[definition.name];
  invariant(
    sameData(definition, {
      name: scenarioContract.name,
      positionMoves: scenarioContract.positionMoves,
      knownVersion: scenarioContract.knownVersion,
      response: scenarioContract.response,
      responseMoves: scenarioContract.responseMoves,
    }),
    "A benchmark scenario definition is invalid.",
  );
  for (const measurement of measurements) {
    assertScenarioMeasurement(definition.name, measurement);
  }
  return {
    ...definition,
    iterations: measurements.length,
    perPoll: scenarioContract.perPoll,
    latencyMs: aggregateRange(measurements.map(({ durationMs }) => durationMs)),
    databaseMs: aggregateRange(measurements.map(({ queries }) =>
      queries.reduce((total, query) => total + query.durationMs, 0))),
    responseBytes: aggregateRange(measurements.map(({ responseBytes }) => responseBytes)),
  };
}

type DataRecord = Record<string, unknown>;

function dataObject(value: unknown, expectedKeys: readonly string[], message: string): DataRecord {
  invariant(typeof value === "object" && value !== null && !Array.isArray(value), message);
  invariant(!isProxy(value), message);
  const prototype = Object.getPrototypeOf(value);
  invariant(prototype === Object.prototype || prototype === null, message);
  invariant(Object.getOwnPropertySymbols(value).length === 0, message);
  const descriptors = Object.getOwnPropertyDescriptors(value) as Record<string, PropertyDescriptor>;
  invariant(
    sameData(Object.keys(descriptors).sort(), [...expectedKeys].sort()),
    message,
  );
  const record: DataRecord = {};
  for (const key of expectedKeys) {
    const descriptor = descriptors[key];
    invariant(
      descriptor !== undefined
      && "value" in descriptor
      && descriptor.enumerable
      && descriptor.get === undefined
      && descriptor.set === undefined,
      message,
    );
    record[key] = descriptor.value;
  }
  return record;
}

function dataArray(value: unknown, message: string): unknown[] {
  invariant(Array.isArray(value) && !isProxy(value), message);
  invariant(Object.getPrototypeOf(value) === Array.prototype, message);
  invariant(Object.getOwnPropertySymbols(value).length === 0, message);
  const descriptors = Object.getOwnPropertyDescriptors(value) as Record<string, PropertyDescriptor>;
  const lengthDescriptor = descriptors.length;
  invariant(lengthDescriptor !== undefined && "value" in lengthDescriptor, message);
  const length = safeInteger(lengthDescriptor.value, message);
  const expectedKeys = ["length", ...Array.from({ length }, (_, index) => String(index))].sort();
  invariant(sameData(Object.keys(descriptors).sort(), expectedKeys), message);
  const result: unknown[] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = descriptors[String(index)];
    invariant(
      descriptor !== undefined
      && "value" in descriptor
      && descriptor.enumerable
      && descriptor.get === undefined
      && descriptor.set === undefined,
      message,
    );
    result.push(descriptor.value);
  }
  return result;
}

function safeInteger(value: unknown, message: string): number {
  invariant(Number.isSafeInteger(value) && (value as number) >= 0, message);
  return value as number;
}

function finiteNumber(value: unknown, message: string): number {
  invariant(typeof value === "number" && Number.isFinite(value) && value >= 0, message);
  return value;
}

function exactLiteral<T extends string | boolean | null>(
  value: unknown,
  allowed: readonly T[],
  message: string,
): T {
  invariant(allowed.includes(value as T), message);
  return value as T;
}

const RANGE_KEYS = ["p50", "p95", "maximum"] as const;

function safeRange(value: unknown): { p50: number; p95: number; maximum: number } {
  const range = dataObject(value, RANGE_KEYS, "A benchmark range is invalid.");
  const snapshot = {
    p50: finiteNumber(range.p50, "A benchmark percentile is invalid."),
    p95: finiteNumber(range.p95, "A benchmark percentile is invalid."),
    maximum: finiteNumber(range.maximum, "A benchmark maximum is invalid."),
  };
  invariant(
    snapshot.p50 <= snapshot.p95 && snapshot.p95 <= snapshot.maximum,
    "A benchmark range is unordered.",
  );
  return snapshot;
}

function safeIntegerRange(value: unknown): { p50: number; p95: number; maximum: number } {
  const range = dataObject(value, RANGE_KEYS, "A benchmark integer range is invalid.");
  const snapshot = {
    p50: safeInteger(range.p50, "A benchmark integer percentile is invalid."),
    p95: safeInteger(range.p95, "A benchmark integer percentile is invalid."),
    maximum: safeInteger(range.maximum, "A benchmark integer maximum is invalid."),
  };
  invariant(
    snapshot.p50 <= snapshot.p95 && snapshot.p95 <= snapshot.maximum,
    "A benchmark integer range is unordered.",
  );
  return snapshot;
}

const QUERY_SHAPE_KEYS = [
  "statements",
  "reads",
  "writes",
  "lockingStatements",
  "returnedRows",
  "affectedRows",
  "lockedRows",
  "statementCounts",
  "statementSequence",
] as const;

function safeQueryShape(value: unknown): PollQueryShape {
  const shape = dataObject(value, QUERY_SHAPE_KEYS, "A query shape is invalid.");
  const rawCounts = dataObject(
    shape.statementCounts,
    POLL_BENCHMARK_STATEMENTS,
    "Statement counts are invalid.",
  );
  const statementCounts = emptyStatementCounts();
  for (const statement of POLL_BENCHMARK_STATEMENTS) {
    statementCounts[statement] = safeInteger(rawCounts[statement], "A statement count is invalid.");
  }
  const rawSequence = dataArray(shape.statementSequence, "The statement sequence is invalid.");
  const statementSequence = rawSequence.map((statement) => exactLiteral(
    statement,
    POLL_BENCHMARK_STATEMENTS,
    "The statement sequence is invalid.",
  ));
  const snapshot: PollQueryShape = {
    statements: safeInteger(shape.statements, "The statement total is invalid."),
    reads: safeInteger(shape.reads, "The read total is invalid."),
    writes: safeInteger(shape.writes, "The write total is invalid."),
    lockingStatements: safeInteger(shape.lockingStatements, "The lock total is invalid."),
    returnedRows: safeInteger(shape.returnedRows, "The returned-row total is invalid."),
    affectedRows: safeInteger(shape.affectedRows, "The affected-row total is invalid."),
    lockedRows: safeInteger(shape.lockedRows, "The locked-row total is invalid."),
    statementCounts,
    statementSequence,
  };
  invariant(snapshot.statements === statementSequence.length, "The statement total is inconsistent.");
  invariant(
    snapshot.statements === Object.values(statementCounts).reduce((sum, count) => sum + count, 0),
    "Statement counts are inconsistent.",
  );
  return snapshot;
}

const SCENARIO_KEYS = [
  "name",
  "positionMoves",
  "knownVersion",
  "response",
  "responseMoves",
  "iterations",
  "perPoll",
  "latencyMs",
  "databaseMs",
  "responseBytes",
] as const;

function safeScenario(value: unknown): PollScenarioAggregate {
  const scenario = dataObject(value, SCENARIO_KEYS, "A benchmark scenario is invalid.");
  const name = exactLiteral(
    scenario.name,
    POLL_BENCHMARK_SCENARIOS,
    "A benchmark scenario name is invalid.",
  );
  const responseMoves = scenario.responseMoves === null
    ? null
    : safeInteger(scenario.responseMoves, "A response move count is invalid.");
  const snapshot: PollScenarioAggregate = {
    name,
    positionMoves: safeInteger(scenario.positionMoves, "A position move count is invalid."),
    knownVersion: exactLiteral(
      scenario.knownVersion,
      ["current", "stale", "future"] as const,
      "A known-version relation is invalid.",
    ),
    response: exactLiteral(
      scenario.response,
      ["heartbeat", "full"] as const,
      "A response class is invalid.",
    ),
    responseMoves,
    iterations: safeInteger(scenario.iterations, "An iteration count is invalid."),
    perPoll: safeQueryShape(scenario.perPoll),
    latencyMs: safeRange(scenario.latencyMs),
    databaseMs: safeRange(scenario.databaseMs),
    responseBytes: safeIntegerRange(scenario.responseBytes),
  };
  invariant(snapshot.iterations > 0, "A benchmark scenario has no coverage.");
  const expected = POLL_BENCHMARK_CONTRACTS[name];
  invariant(
    sameData(
      {
        name: snapshot.name,
        positionMoves: snapshot.positionMoves,
        knownVersion: snapshot.knownVersion,
        response: snapshot.response,
        responseMoves: snapshot.responseMoves,
        perPoll: snapshot.perPoll,
      },
      {
        name: expected.name,
        positionMoves: expected.positionMoves,
        knownVersion: expected.knownVersion,
        response: expected.response,
        responseMoves: expected.responseMoves,
        perPoll: expected.perPoll,
      },
    ),
    "A benchmark scenario violates its query contract.",
  );
  return snapshot;
}

const REPORT_KEYS = [
  "benchmark",
  "mode",
  "latencyAdvisoryOnly",
  "scoringExpiryIncluded",
  "scenarios",
] as const;

export function serializeSafePollBenchmarkReport(value: unknown): string {
  const report = dataObject(value, REPORT_KEYS, "The benchmark report is invalid.");
  const scoringExpiryIncluded = exactLiteral(
    report.scoringExpiryIncluded,
    [true, false] as const,
    "The scoring-expiry flag is invalid.",
  );
  const rawScenarios = dataArray(report.scenarios, "Benchmark scenarios are invalid.");
  const scenarios = rawScenarios.map(safeScenario);
  const expectedNames = POLL_BENCHMARK_SCENARIOS.filter((name) =>
    scoringExpiryIncluded || name !== "scoring_expiry_302");
  invariant(
    sameData(scenarios.map(({ name }) => name), expectedNames),
    "Benchmark scenario coverage is incomplete or duplicated.",
  );
  const snapshot: PollBenchmarkReport = {
    benchmark: exactLiteral(
      report.benchmark,
      ["verified-game-polls-v1"] as const,
      "The benchmark report name is invalid.",
    ),
    mode: exactLiteral(
      report.mode,
      ["ci-correctness", "local"] as const,
      "The benchmark report mode is invalid.",
    ),
    latencyAdvisoryOnly: exactLiteral(
      report.latencyAdvisoryOnly,
      [true] as const,
      "Benchmark latency must remain advisory.",
    ),
    scoringExpiryIncluded,
    scenarios,
  };
  const serialized = JSON.stringify(snapshot);
  invariant(!/postgres(?:ql)?:\/\//i.test(serialized), "The benchmark report exposes a connection string.");
  invariant(!/(?:guest|user):[0-9a-f-]{36}/i.test(serialized), "The benchmark report exposes a player key.");
  invariant(
    !/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i.test(serialized),
    "The benchmark report exposes an identifier.",
  );
  invariant(!/\$\d+/.test(serialized), "The benchmark report exposes query parameters.");
  invariant(
    !/\b(?:select|insert|update|delete)\s+/i.test(serialized),
    "The benchmark report exposes a query.",
  );
  return serialized;
}
