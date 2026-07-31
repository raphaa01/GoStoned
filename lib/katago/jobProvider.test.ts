import assert from "node:assert/strict";
import test from "node:test";
import { canonicalizeKataGoScoringRequest } from "./canonical";
import { KataGoScoringError } from "./errors";
import {
  LocalWorkerKataGoScoringProvider,
  ModalKataGoScoringProvider,
} from "./jobProvider";
import { providerResponseFixture, scoringRequestFixture } from "./testFixtures";

const request = canonicalizeKataGoScoringRequest(scoringRequestFixture());

test("Modal scoring persists one canonical job, dispatches its id, and returns worker evidence", async () => {
  let selects = 0;
  const dispatches: string[] = [];
  const response = providerResponseFixture(request);
  const fakeQuery = async (sql: string) => {
    if (sql.includes("INSERT INTO katago_scoring_jobs")) return { rows: [], rowCount: 1 };
    if (sql.includes("SELECT id,request,status")) {
      selects += 1;
      return {
        rows: [{
          id: "22222222-2222-4222-8222-222222222222",
          request,
          status: selects >= 2 ? "completed" : "queued",
          result: selects >= 2 ? response : null,
          attempts: 1,
          error_code: null,
        }],
        rowCount: 1,
      };
    }
    throw new Error(`Unexpected job provider query: ${sql}`);
  };
  const provider = new ModalKataGoScoringProvider({
    query: fakeQuery as never,
    dispatch: async (_kind, id) => {
      dispatches.push(id);
      return true;
    },
    pollIntervalMs: 25,
  });
  assert.deepEqual(
    await provider.analyze(request, { signal: new AbortController().signal }),
    response,
  );
  assert.deepEqual(dispatches, ["22222222-2222-4222-8222-222222222222"]);
});

test("local scoring waits for the durable worker and honors caller cancellation", async () => {
  const fakeQuery = async (sql: string) => {
    if (sql.includes("INSERT INTO katago_scoring_jobs")) return { rows: [], rowCount: 1 };
    return {
      rows: [{
        id: "33333333-3333-4333-8333-333333333333",
        request,
        status: "queued",
        result: null,
        attempts: 0,
        error_code: null,
      }],
      rowCount: 1,
    };
  };
  const provider = new LocalWorkerKataGoScoringProvider({
    query: fakeQuery as never,
    pollIntervalMs: 25,
  });
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 5);
  await assert.rejects(
    provider.analyze(request, { signal: controller.signal }),
    (error) => error instanceof KataGoScoringError && error.code === "request_aborted",
  );
});
