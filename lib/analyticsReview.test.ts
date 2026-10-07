import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("server review and price reports preserve counts, date boundaries, zero options and read-only isolation", () => {
  const result = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", `
    import assert from 'node:assert/strict';
    import Module, { createRequire } from 'node:module';
    const require = createRequire(import.meta.url);
    const originalResolve = Module._resolveFilename;
    Module._resolveFilename = function(name, ...args) {
      return name === 'server-only' ? require.resolve('next/dist/compiled/server-only/empty.js') : originalResolve.call(this, name, ...args);
    };
    const { getReviewAnalyticsReport, getPriceSurveyReport } = require('./lib/analytics/reviewReport.ts');
    const queries = [];
    let released = 0;
    let fail = false;
    globalThis.goStonedDbPool = { connect: async () => ({
      release: () => { released++; },
      query: async (sql, values) => {
        queries.push({sql, values});
        assert.doesNotMatch(sql, /INSERT|UPDATE|DELETE/);
        if (fail && sql.includes('FROM analysis_price_votes')) throw new Error('database unavailable');
        let rows = [];
        if (sql.includes('AS total_requests')) rows = [{ total_requests:'20', total_started:'18', requests:'3', started:'2', completed:'1', failed:'1', queued:'2', running:'1', requesters:'2' }];
        else if (sql.startsWith('WITH days')) rows = [{day:'2026-10-07',requests:'3',started:'2',completed:'1'}];
        else if (sql.startsWith('SELECT id')) rows = [{id:'job-1',created_at:new Date('2026-10-07T09:00:00Z'),started_at:null,completed_at:null,status:'queued',attempts:0}];
        else if (sql.includes('average_price')) rows = [{voters:'3',accounts:'10',new_voters:'1',updated_votes:'2',average_price:'6'}];
        else if (sql.includes('GROUP BY monthly_price_eur')) rows = [{monthly_price_eur:3,voters:'2'},{monthly_price_eur:12,voters:'1'}];
        else if (sql.startsWith('SELECT monthly_price_eur, created_at')) rows = [{monthly_price_eur:12,created_at:'2026-09-01T10:00:00Z',updated_at:'2026-10-07T10:00:00Z'}];
        return {rows};
      }
    })};
    const now = new Date('2026-10-07T12:00:00Z');
    const review = await getReviewAnalyticsReport(now, 7);
    const survey = await getPriceSurveyReport(now, 7);
    assert.equal(review.summary.totalRequests, 20);
    assert.equal(review.summary.totalStarted, 18);
    assert.equal(review.summary.requesters, 2);
    assert.deepEqual(review.days[0], {date:'2026-10-07',requests:3,started:2,completed:1});
    assert.equal(review.recent[0].startedAt, null);
    assert.equal(review.recent[0].requestedAt, '2026-10-07T09:00:00.000Z');
    assert.equal(survey.voters, 3);
    assert.equal(survey.newVoters, 1);
    assert.equal(survey.updatedVotes, 2);
    assert.equal(survey.averagePrice, 6);
    assert.deepEqual(survey.options, [{euros:3,voters:2},{euros:5,voters:0},{euros:8,voters:0},{euros:12,voters:1}]);
    assert.deepEqual(Object.keys(survey.recent[0]).sort(), ['createdAt','euros','updatedAt']);
    for (const {values} of queries.filter(q => q.values)) assert.deepEqual(values, ['2026-10-01T00:00:00.000Z', now.toISOString()]);
    assert.equal(queries.filter(q => q.sql === 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY').length, 2);
    assert.equal(released, 2);
    assert.equal(queries.filter(q => /FROM game_analysis_jobs/.test(q.sql)).length, 3);
    fail = true;
    await assert.rejects(getPriceSurveyReport(now, 1), /database unavailable/);
    assert.equal(queries.at(-1).sql, 'ROLLBACK');
    assert.equal(released, 3);
  `], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
