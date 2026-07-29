import { randomUUID } from "node:crypto";
import "dotenv/config";
import type { Pool, PoolClient, QueryResult, QueryResultRow } from "pg";
import { closePool, getPool } from "../lib/db";
import { getDatabaseUrl, isUnambiguousLocalDatabase } from "../lib/env";
import { pollGameState } from "../lib/game/gameService";
import { applyMove, boardHash, createEmptyBoard } from "../lib/game/goEngine";
import {
  aggregateScenario,
  assertScenarioMeasurement,
  executeClassifiedPollQuery,
  formatPollBenchmarkError,
  PollBenchmarkInvariantError,
  resolvePollBenchmarkFailure,
  serializeSafePollBenchmarkReport,
  type PollBenchmarkReport,
  type PollBenchmarkStage,
  type PollMeasurement,
  type PollQueryRecord,
  type PollScenarioAggregate,
  type PollScenarioDefinition,
} from "../lib/game/pollBenchmark";
import type { Board, GameState, Stone } from "../lib/game/types";
import { assertSmokeDatabaseIdentity } from "../lib/smokeDatabase";

const CI_DATABASE = "gostone_ci";
const CI_ROLE = "gostone_ci_runner";
const CI_BOOTSTRAP = "gostone-ci-v1";
const LOCAL_DISPOSABLE_SENTINEL = "gostone-poll-benchmark-v1";
const BENCHMARK_STATEMENT_TIMEOUT = "8s";
const PLACEMENT_COUNT = 300;
const SCORING_MOVE_COUNT = 302;
const SCORING_WINDOW_MS = 10 * 60 * 1_000;
const TIMEOUT_ELAPSED_MS = 31_000;

type Arguments = Readonly<{
  ci: boolean;
  includeScoringExpiry: boolean;
}>;

type RunnerPrivilegeRow = Readonly<{
  rolcanlogin: boolean;
  rolsuper: boolean;
  rolcreatedb: boolean;
  rolcreaterole: boolean;
  rolreplication: boolean;
  rolbypassrls: boolean;
}>;

type FixtureMove = Readonly<{
  moveNumber: number;
  color: Stone;
  x: number | null;
  y: number | null;
  isPass: boolean;
  hash: string;
}>;

type Fixture = Readonly<{
  gameId: string;
  playerKey: string;
  whitePlayerKey: string;
  version: number;
  moveCount: number;
}>;

type FixtureOptions = Readonly<{
  moves: readonly FixtureMove[];
  phase?: "play" | "scoring";
  scoringExpiry?: "future" | "expired";
  timeout?: boolean;
}>;

type PollResult = Awaited<ReturnType<typeof pollGameState>>;

let activeQueries: PollQueryRecord[] | null = null;
let terminationSignal: "SIGINT" | "SIGTERM" | null = null;
let activeStage: PollBenchmarkStage = "environment_authorization";

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new PollBenchmarkInvariantError(message);
}

function parseArguments(argv: readonly string[]): Arguments {
  let ci = false;
  let includeScoringExpiry = false;
  for (const argument of argv) {
    if (argument === "--ci") ci = true;
    else if (argument === "--include-scoring-expiry") includeScoringExpiry = true;
    else throw new PollBenchmarkInvariantError("The benchmark received an unsupported option.");
  }
  return { ci, includeScoringExpiry };
}

function authorizeEnvironment(args: Arguments): void {
  const databaseUrl = getDatabaseUrl();
  invariant(
    isUnambiguousLocalDatabase(databaseUrl),
    "The benchmark requires an unambiguous loopback PostgreSQL endpoint.",
  );

  if (args.ci) {
    invariant(
      process.env.CI === "true"
      && process.env.GITHUB_ACTIONS === "true"
      && process.env.GOSTONE_CI_DATABASE_BOOTSTRAP === CI_BOOTSTRAP
      && process.env.GOSTONE_SMOKE_DATABASE_NAME === CI_DATABASE
      && process.env.GOSTONE_SMOKE_DATABASE_ROLE === CI_ROLE,
      "The CI benchmark environment is not explicitly authorized.",
    );
    return;
  }

  invariant(process.env.CI !== "true", "CI must invoke the benchmark in correctness mode.");
  invariant(
    process.env.GOSTONE_POLL_BENCHMARK_DISPOSABLE === LOCAL_DISPOSABLE_SENTINEL,
    "Local committed fixtures require the disposable benchmark sentinel.",
  );
}

async function assertRunnerPrivileges(pool: Pool): Promise<void> {
  await assertSmokeDatabaseIdentity(pool);
  const result = await pool.query<RunnerPrivilegeRow>(
    `SELECT rolcanlogin, rolsuper, rolcreatedb, rolcreaterole,
            rolreplication, rolbypassrls
       FROM pg_catalog.pg_roles
      WHERE rolname = pg_catalog.current_user`,
  );
  invariant(result.rows.length === 1, "The benchmark runner role is unavailable.");
  const role = result.rows[0];
  invariant(
    role.rolcanlogin
    && !role.rolsuper
    && !role.rolcreatedb
    && !role.rolcreaterole
    && !role.rolreplication
    && !role.rolbypassrls,
    "The benchmark runner role has unsafe privileges.",
  );
}

function signalHandler(signal: "SIGINT" | "SIGTERM"): void {
  terminationSignal ??= signal;
}

const handleSigint = () => signalHandler("SIGINT");
const handleSigterm = () => signalHandler("SIGTERM");

function assertNotInterrupted(): void {
  invariant(terminationSignal === null, "The benchmark was interrupted safely.");
}

function buildPlacementMoves(): readonly FixtureMove[] {
  let board: Board = createEmptyBoard(19);
  const moves: FixtureMove[] = [];
  const seenHashes = new Set([boardHash(board)]);
  let blackIndex = 0;
  let whiteIndex = 0;
  for (let moveNumber = 1; moveNumber <= PLACEMENT_COUNT; moveNumber += 1) {
    const color: Stone = moveNumber % 2 === 1 ? "black" : "white";
    const index = color === "black" ? blackIndex++ : whiteIndex++;
    const x = (color === "black" ? 0 : 10) + (index % 9);
    const y = Math.floor(index / 9);
    const applied = applyMove(board, color, x, y);
    invariant(applied.ok, "The deterministic benchmark sequence contains an illegal move.");
    board = applied.board;
    const hash = boardHash(board);
    invariant(!seenHashes.has(hash), "The deterministic benchmark sequence repeats a position.");
    seenHashes.add(hash);
    moves.push({
      moveNumber,
      color,
      x,
      y,
      isPass: false,
      hash,
    });
  }
  invariant(moves.length === PLACEMENT_COUNT, "The benchmark move sequence is incomplete.");
  return moves;
}

function buildScoringMoves(placements: readonly FixtureMove[]): readonly FixtureMove[] {
  invariant(placements.length === PLACEMENT_COUNT, "The scoring fixture needs 300 placements.");
  const hash = placements[placements.length - 1].hash;
  return [
    ...placements,
    {
      moveNumber: 301,
      color: "black",
      x: null,
      y: null,
      isPass: true,
      hash,
    },
    {
      moveNumber: 302,
      color: "white",
      x: null,
      y: null,
      isPass: true,
      hash,
    },
  ];
}

async function withPoolTransaction<T>(
  pool: Pool,
  operation: (client: PoolClient) => Promise<T>,
  afterCommit?: () => void,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`SET LOCAL statement_timeout = '${BENCHMARK_STATEMENT_TIMEOUT}'`);
    const result = await operation(client);
    await client.query("COMMIT");
    afterCommit?.();
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function seedFixture(
  pool: Pool,
  ownedGameIds: Set<string>,
  options: FixtureOptions,
): Promise<Fixture> {
  assertNotInterrupted();
  const gameId = randomUUID();
  const blackPlayerKey = `guest:${randomUUID()}`;
  const whitePlayerKey = `guest:${randomUUID()}`;
  const phase = options.phase ?? "play";
  const scoring = phase === "scoring";
  invariant(!scoring || options.moves.length === SCORING_MOVE_COUNT, "A scoring fixture is incomplete.");
  invariant(scoring === Boolean(options.scoringExpiry), "A scoring fixture needs an expiry class.");
  invariant(!(scoring && options.timeout), "A scoring fixture cannot be a timeout fixture.");
  const now = new Date();
  const expiredScoring = options.scoringExpiry === "expired";
  const scoringStartedAt = scoring
    ? new Date(now.getTime() - (expiredScoring ? 2 * SCORING_WINDOW_MS : 1_000))
    : null;
  const scoringExpiresAt = scoringStartedAt
    ? new Date(scoringStartedAt.getTime() + SCORING_WINDOW_MS)
    : null;
  const playTurnStartedAt = options.timeout
    ? new Date(now.getTime() - TIMEOUT_ELAPSED_MS)
    : now;
  const lifecycleStartedAt = scoringStartedAt ?? playTurnStartedAt;
  const fixtureStartedAt = new Date(
    lifecycleStartedAt.getTime() - options.moves.length - 1_000,
  );
  const turnStartedAt = scoringStartedAt
    ? new Date(fixtureStartedAt.getTime() + 301)
    : playTurnStartedAt;

  await withPoolTransaction(pool, async (client) => {
    await client.query(
      `INSERT INTO games
         (id, board_size, black_player_key, white_player_key, status, phase, to_move,
          consecutive_passes, scoring_revision, komi, rules, rules_profile,
          scoring_method, handicap, time_control, main_time_seconds,
          byo_yomi_periods, byo_yomi_seconds, black_time_remaining_ms,
          white_time_remaining_ms, black_periods_remaining, white_periods_remaining,
          turn_started_at, version, started_at, updated_at)
       VALUES
         ($1, 19, $2, $3, 'active', $4, $5,
          $6, $7, 7.5, 'chinese', 'chinese-2002-gostone-v1',
          'area', 0, 'rapid', 600,
          5, 30, $8,
          600000, $9, 5,
          $10, $11, $12, $13)`,
      [
        gameId,
        blackPlayerKey,
        whitePlayerKey,
        phase,
        scoring ? null : "black",
        scoring ? 2 : 0,
        scoring ? 1 : 0,
        options.timeout ? 0 : 600_000,
        options.timeout ? 1 : 5,
        turnStartedAt,
        options.moves.length,
        fixtureStartedAt,
        lifecycleStartedAt,
      ],
    );
    if (options.moves.length > 0) {
      await client.query(
        `INSERT INTO moves
           (game_id, move_number, color, x, y, is_pass, board_hash, created_at)
         SELECT $1, fixture.move_number, fixture.color,
                fixture.x, fixture.y, fixture.is_pass, fixture.board_hash, fixture.created_at
           FROM UNNEST(
             $2::int[], $3::text[], $4::int[], $5::int[],
             $6::boolean[], $7::text[], $8::timestamp[]
           ) AS fixture(move_number, color, x, y, is_pass, board_hash, created_at)`,
        [
          gameId,
          options.moves.map(({ moveNumber }) => moveNumber),
          options.moves.map(({ color }) => color),
          options.moves.map(({ x }) => x),
          options.moves.map(({ y }) => y),
          options.moves.map(({ isPass }) => isPass),
          options.moves.map(({ hash }) => hash),
          options.moves.map(({ moveNumber }) =>
            new Date(fixtureStartedAt.getTime() + moveNumber)),
        ],
      );
    }
    if (scoring) {
      invariant(
        scoringStartedAt !== null
        && scoringExpiresAt !== null
        && scoringExpiresAt.getTime() - scoringStartedAt.getTime() === SCORING_WINDOW_MS,
        "The scoring fixture window is invalid.",
      );
      await client.query(
        `INSERT INTO game_scoring_state
           (game_id, board_hash, stopped_move_number, revision,
            rules, rules_profile, scoring_method, komi, handicap,
            fallback_to_move, expires_at, started_at, updated_at)
         VALUES
           ($1, $2, 302, 1,
            'chinese', 'chinese-2002-gostone-v1', 'area', 7.5, 0,
            'black', $3, $4, $4)`,
        [
          gameId,
          options.moves[options.moves.length - 1].hash,
          scoringExpiresAt,
          scoringStartedAt,
        ],
      );
    }
  }, () => ownedGameIds.add(gameId));
  return {
    gameId,
    playerKey: blackPlayerKey,
    whitePlayerKey,
    version: options.moves.length,
    moveCount: options.moves.length,
  };
}

async function recordedQuery<T extends QueryResultRow>(
  queryable: Pool | PoolClient,
  text: string,
  values: unknown[] | undefined,
): Promise<QueryResult<T>> {
  const recorder = activeQueries;
  return executeClassifiedPollQuery(
    text,
    () => queryable.query<T>(text, values),
    recorder ? (record) => recorder.push(record) : undefined,
  );
}

function instrumentedPool(pool: Pool): Pool {
  const facade = {
    query<T extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]) {
      return recordedQuery<T>(pool, text, values);
    },
    async connect() {
      const client = await pool.connect();
      const wrapped = {
        query<T extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]) {
          return recordedQuery<T>(client, text, values);
        },
        release(error?: Error | boolean) {
          client.release(error);
        },
      };
      return wrapped as unknown as PoolClient;
    },
    end() {
      return pool.end();
    },
  };
  return facade as unknown as Pool;
}

function assertFullFixtureIdentity(game: GameState, fixture: Fixture): void {
  invariant(game.id === fixture.gameId, "Full state returned the wrong game.");
  invariant(
    game.boardSize === 19
    && game.ruleset === "chinese"
    && game.rulesProfile === "chinese-2002-gostone-v1"
    && game.scoringMethod === "area"
    && game.komi === 7.5
    && game.handicap === 0
    && game.timeControl === "rapid",
    "Full state returned the wrong rules tuple.",
  );
}

function assertResponse(
  result: PollResult,
  definition: PollScenarioDefinition,
  fixture: Fixture,
  expectedVersion: number,
): void {
  if (definition.response === "heartbeat") {
    invariant(result.unchanged === true, "A current poll did not return a heartbeat.");
    invariant(result.gameId === fixture.gameId, "A heartbeat returned the wrong game.");
    invariant(result.version === expectedVersion, "A heartbeat returned the wrong version.");
    return;
  }
  invariant(result.unchanged === false, "A changed poll did not return full state.");
  assertFullFixtureIdentity(result.game, fixture);
  invariant(result.game.version === expectedVersion, "Full state returned the wrong version.");
  invariant(
    result.game.moveCount === definition.responseMoves,
    "Full state returned the wrong move count.",
  );
  if (definition.name === "play_stale_300" || definition.name === "play_future_300") {
    invariant(
      result.game.status === "active"
      && result.game.phase === "play"
      && result.game.scoring === null
      && result.game.turn === "black"
      && result.game.consecutivePasses === 0
      && result.game.scoringRevision === 0,
      "The play poll returned an invalid lifecycle.",
    );
  }
  if (definition.name === "play_timeout_150") {
    invariant(
      result.game.status === "finished"
      && result.game.finishReason === "timeout"
      && result.game.phase === "play"
      && result.game.scoring === null,
      "The timeout poll returned an invalid lifecycle.",
    );
    invariant(
      result.game.result === "W+T"
      && result.game.winnerKey === fixture.whitePlayerKey
      && result.game.rated === false
      && result.game.turn === null
      && result.game.clock.black.mainTimeMs === 0
      && result.game.clock.black.periodsRemaining === 0,
      "The timeout poll returned an invalid lifecycle.",
    );
  }
  if (definition.name === "scoring_expiry_302") {
    invariant(
      result.game.status === "active"
      && result.game.phase === "play"
      && result.game.scoring === null
      && result.game.lastResume?.claim === "deadline"
      && result.game.lastResume.requestedBy === null
      && result.game.lastResume.disputedStone === null
      && result.game.consecutivePasses === 0
      && result.game.scoringRevision === 2
      && result.game.turn === "black"
      && result.game.result === null
      && result.game.winnerKey === null
      && result.game.finishReason === null,
      "The scoring-expiry poll returned an invalid lifecycle.",
    );
  }
}

async function measurePoll(
  fixture: Fixture,
  knownVersion: number,
  definition: PollScenarioDefinition,
  expectedVersion: number,
): Promise<PollMeasurement> {
  assertNotInterrupted();
  invariant(activeQueries === null, "Benchmark query recording overlapped.");
  const queries: PollQueryRecord[] = [];
  activeQueries = queries;
  const started = performance.now();
  let result: PollResult;
  try {
    result = await pollGameState(fixture.gameId, fixture.playerKey, knownVersion);
  } finally {
    activeQueries = null;
  }
  const measurement: PollMeasurement = {
    durationMs: performance.now() - started,
    responseBytes: Buffer.byteLength(JSON.stringify(result), "utf8"),
    queries,
  };
  assertResponse(result, definition, fixture, expectedVersion);
  assertScenarioMeasurement(definition.name, measurement);
  return measurement;
}

async function runStableScenario(
  fixture: Fixture,
  definition: PollScenarioDefinition,
  knownVersion: number,
  iterations: number,
): Promise<PollScenarioAggregate> {
  const measurements: PollMeasurement[] = [];
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    measurements.push(await measurePoll(
      fixture,
      knownVersion,
      definition,
      fixture.version,
    ));
  }
  return aggregateScenario(definition, measurements);
}

async function cleanupOwnedFixtures(pool: Pool, ownedGameIds: Set<string>): Promise<void> {
  activeQueries = null;
  if (ownedGameIds.size === 0) return;
  const gameIds = [...ownedGameIds];
  await withPoolTransaction(pool, async (client) => {
    await client.query(
      "DELETE FROM matchmaking_queue WHERE game_id = ANY($1::uuid[])",
      [gameIds],
    );
    await client.query(
      "DELETE FROM games WHERE id = ANY($1::uuid[])",
      [gameIds],
    );
  });
  const residue = await withPoolTransaction(pool, (client) =>
    client.query<{ residue_count: number }>(
      `SELECT (
         (SELECT COUNT(*) FROM games WHERE id = ANY($1::uuid[]))
         + (SELECT COUNT(*) FROM moves WHERE game_id = ANY($1::uuid[]))
         + (SELECT COUNT(*) FROM matchmaking_queue WHERE game_id = ANY($1::uuid[]))
         + (SELECT COUNT(*) FROM game_messages WHERE game_id = ANY($1::uuid[]))
         + (SELECT COUNT(*) FROM player_reports WHERE game_id = ANY($1::uuid[]))
         + (SELECT COUNT(*) FROM player_rating_history WHERE game_id = ANY($1::uuid[]))
         + (SELECT COUNT(*) FROM game_scoring_state WHERE game_id = ANY($1::uuid[]))
         + (SELECT COUNT(*) FROM game_dead_stones WHERE game_id = ANY($1::uuid[]))
         + (SELECT COUNT(*) FROM game_scoring_resume_events WHERE game_id = ANY($1::uuid[]))
       )::int AS residue_count`,
      [gameIds],
    ));
  invariant(
    residue.rows.length === 1 && residue.rows[0].residue_count === 0,
    "The benchmark could not verify zero fixture residue.",
  );
}

async function validateStableFixture(
  fixture: Fixture,
  expected: "heartbeat" | "full",
  knownVersion: number,
  expectedMoves: number,
): Promise<void> {
  assertNotInterrupted();
  const result = await pollGameState(fixture.gameId, fixture.playerKey, knownVersion);
  invariant(
    (expected === "heartbeat" && result.unchanged === true)
    || (expected === "full" && result.unchanged === false),
    "A committed benchmark fixture failed validation.",
  );
  if (result.unchanged === false) {
    assertFullFixtureIdentity(result.game, fixture);
    invariant(result.game.moveCount === expectedMoves, "A committed fixture has the wrong move count.");
    invariant(
      result.game.status === "active"
      && result.game.phase === "play"
      && result.game.turn === "black"
      && result.game.scoring === null,
      "A committed play fixture failed validation.",
    );
  }
}

async function validateScoringFixture(fixture: Fixture): Promise<void> {
  assertNotInterrupted();
  const result = await pollGameState(fixture.gameId, fixture.playerKey, fixture.version - 1);
  invariant(result.unchanged === false, "The scoring fixture did not return full state.");
  assertFullFixtureIdentity(result.game, fixture);
  invariant(
    result.game.status === "active"
    && result.game.phase === "scoring"
    && result.game.turn === null
    && result.game.consecutivePasses === 2
    && result.game.scoringRevision === 1
    && result.game.scoring?.revision === 1
    && result.game.moveCount === SCORING_MOVE_COUNT,
    "The committed scoring fixture failed validation.",
  );
}

async function executeBenchmark(
  pool: Pool,
  ownedGameIds: Set<string>,
  args: Arguments,
): Promise<PollBenchmarkReport> {
  activeStage = "fixture_generation";
  const placements = buildPlacementMoves();
  const scoringMoves = buildScoringMoves(placements);
  activeStage = "fixture_seeding";
  const play0 = await seedFixture(pool, ownedGameIds, { moves: [] });
  const play150 = await seedFixture(pool, ownedGameIds, { moves: placements.slice(0, 150) });
  const play300 = await seedFixture(pool, ownedGameIds, { moves: placements });
  const scoring = await seedFixture(pool, ownedGameIds, {
    moves: scoringMoves,
    phase: "scoring",
    scoringExpiry: "future",
  });
  const facade = instrumentedPool(pool);
  globalThis.goStonedDbPool = facade;

  activeStage = "fixture_validation";
  await validateStableFixture(play0, "heartbeat", 0, 0);
  await validateStableFixture(play0, "full", 1, 0);
  await validateStableFixture(play150, "heartbeat", 150, 150);
  await validateStableFixture(play150, "full", 149, 150);
  await validateStableFixture(play300, "heartbeat", 300, 300);
  await validateStableFixture(play300, "full", 299, 300);
  await validateStableFixture(play300, "full", 301, 300);
  await validateStableFixture(scoring, "heartbeat", 302, 302);
  await validateScoringFixture(scoring);
  assertNotInterrupted();

  const warmups = args.ci ? 3 : 25;
  const iterations = args.ci ? 10 : 200;
  const stableScenarios = [
    { fixture: play0, definition: {
      name: "play_current_0", positionMoves: 0, knownVersion: "current",
      response: "heartbeat", responseMoves: null,
    } as const, knownVersion: 0 },
    { fixture: play150, definition: {
      name: "play_current_150", positionMoves: 150, knownVersion: "current",
      response: "heartbeat", responseMoves: null,
    } as const, knownVersion: 150 },
    { fixture: play300, definition: {
      name: "play_current_300", positionMoves: 300, knownVersion: "current",
      response: "heartbeat", responseMoves: null,
    } as const, knownVersion: 300 },
    { fixture: play300, definition: {
      name: "play_stale_300", positionMoves: 300, knownVersion: "stale",
      response: "full", responseMoves: 300,
    } as const, knownVersion: 299 },
    { fixture: play300, definition: {
      name: "play_future_300", positionMoves: 300, knownVersion: "future",
      response: "full", responseMoves: 300,
    } as const, knownVersion: 301 },
    { fixture: scoring, definition: {
      name: "scoring_current_302", positionMoves: 300, knownVersion: "current",
      response: "heartbeat", responseMoves: null,
    } as const, knownVersion: 302 },
  ];
  activeStage = "stable_warmup";
  for (const scenario of stableScenarios) {
    for (let warmup = 0; warmup < warmups; warmup += 1) {
      assertNotInterrupted();
      const result = await pollGameState(
        scenario.fixture.gameId,
        scenario.fixture.playerKey,
        scenario.knownVersion,
      );
      assertResponse(result, scenario.definition, scenario.fixture, scenario.fixture.version);
    }
  }
  activeStage = "stable_measurement";
  const scenarios: PollScenarioAggregate[] = [];
  for (const scenario of stableScenarios) {
    scenarios.push(await runStableScenario(
      scenario.fixture,
      scenario.definition,
      scenario.knownVersion,
      iterations,
    ));
  }

  const timeoutDefinition: PollScenarioDefinition = {
    name: "play_timeout_150",
    positionMoves: 150,
    knownVersion: "current",
    response: "full",
    responseMoves: 150,
  };
  const timeoutMeasurements: PollMeasurement[] = [];
  activeStage = "timeout_warmup";
  for (let warmup = 0; warmup < warmups; warmup += 1) {
    assertNotInterrupted();
    const timeout = await seedFixture(pool, ownedGameIds, {
      moves: placements.slice(0, 150),
      timeout: true,
    });
    const result = await pollGameState(timeout.gameId, timeout.playerKey, 150);
    assertResponse(result, timeoutDefinition, timeout, 151);
  }
  activeStage = "timeout_measurement";
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const timeout = await seedFixture(pool, ownedGameIds, {
      moves: placements.slice(0, 150),
      timeout: true,
    });
    timeoutMeasurements.push(await measurePoll(
      timeout,
      150,
      timeoutDefinition,
      151,
    ));
  }
  scenarios.push(aggregateScenario(timeoutDefinition, timeoutMeasurements));

  if (args.includeScoringExpiry) {
    const expiryDefinition: PollScenarioDefinition = {
      name: "scoring_expiry_302",
      positionMoves: 300,
      knownVersion: "current",
      response: "full",
      responseMoves: 302,
    };
    const expiryMeasurements: PollMeasurement[] = [];
    activeStage = "scoring_expiry_warmup";
    for (let warmup = 0; warmup < warmups; warmup += 1) {
      assertNotInterrupted();
      const expired = await seedFixture(pool, ownedGameIds, {
        moves: scoringMoves,
        phase: "scoring",
        scoringExpiry: "expired",
      });
      const result = await pollGameState(expired.gameId, expired.playerKey, 302);
      assertResponse(result, expiryDefinition, expired, 303);
    }
    activeStage = "scoring_expiry_measurement";
    for (let iteration = 0; iteration < iterations; iteration += 1) {
      const expired = await seedFixture(pool, ownedGameIds, {
        moves: scoringMoves,
        phase: "scoring",
        scoringExpiry: "expired",
      });
      expiryMeasurements.push(await measurePoll(
        expired,
        302,
        expiryDefinition,
        303,
      ));
    }
    scenarios.push(aggregateScenario(expiryDefinition, expiryMeasurements));
  }
  return {
    benchmark: "verified-game-polls-v1",
    mode: args.ci ? "ci-correctness" : "local",
    latencyAdvisoryOnly: true,
    scoringExpiryIncluded: args.includeScoringExpiry,
    scenarios,
  };
}

async function run(): Promise<PollBenchmarkReport> {
  const args = parseArguments(process.argv.slice(2));
  authorizeEnvironment(args);
  process.on("SIGINT", handleSigint);
  process.on("SIGTERM", handleSigterm);
  const ownedGameIds = new Set<string>();
  const pool = getPool();
  let report: PollBenchmarkReport | null = null;
  let failure: unknown = null;
  let executionFailed = false;
  let cleanupFailed = false;
  let closeFailed = false;
  try {
    activeStage = "runner_identity";
    await assertRunnerPrivileges(pool);
    report = await executeBenchmark(pool, ownedGameIds, args);
  } catch (error) {
    executionFailed = true;
    failure = error;
  } finally {
    activeQueries = null;
    globalThis.goStonedDbPool = pool;
    try {
      await cleanupOwnedFixtures(pool, ownedGameIds);
    } catch {
      cleanupFailed = true;
    }
    try {
      await closePool();
    } catch {
      closeFailed = true;
    }
    process.removeListener("SIGINT", handleSigint);
    process.removeListener("SIGTERM", handleSigterm);
  }
  const terminalFailure = resolvePollBenchmarkFailure(
    failure,
    executionFailed,
    cleanupFailed,
    closeFailed,
  );
  if (terminalFailure) throw terminalFailure;
  assertNotInterrupted();
  invariant(report !== null, "The benchmark report was not produced.");
  return report;
}

run()
  .then((report) => {
    activeStage = "report_serialization";
    console.log(serializeSafePollBenchmarkReport(report));
  })
  .catch((error: unknown) => {
    console.error(formatPollBenchmarkError(error, activeStage));
    process.exitCode = terminationSignal === "SIGINT"
      ? 130
      : terminationSignal === "SIGTERM"
        ? 143
        : 1;
  });
