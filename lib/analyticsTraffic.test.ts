import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("Vercel report uses window visitor totals rather than adding dimensions and keeps tokens server-side", () => {
  const result = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", `
    import assert from 'node:assert/strict';
    import Module, { createRequire } from 'node:module';
    const require = createRequire(import.meta.url);
    const originalResolve = Module._resolveFilename;
    // Next bundles its server-only marker; tsx does not apply Next's alias.
    Module._resolveFilename = function(name, ...args) {
      return name === 'server-only' ? require.resolve('next/dist/compiled/server-only/empty.js') : originalResolve.call(this, name, ...args);
    };
    const { getVercelTrafficReport } = await import('./lib/analytics/vercelReport.ts');
    const requests = [];
    const fetcher = async (input, options) => {
      const url = new URL(input);
      requests.push(url);
      assert.equal(options.headers.Authorization, 'Bearer private-test-token');
      assert.equal(options.cache, 'no-store');
      assert.equal(url.searchParams.get('projectId'), 'prj_test');
      assert.equal(url.searchParams.get('teamId'), 'team_test');
      assert.match(url.searchParams.get('filter'), /production/);
      assert.match(url.searchParams.get('filter'), /webanalytics/);
      const by = url.searchParams.get('by');
      const data = url.pathname.endsWith('/count') ? { pageviews: 500, visitors: 30 }
        : by === 'environment' ? [{ environment: 'production', pageviews: 100, visitors: 8 }]
        : by === 'day' ? [{ timestamp: '2026-10-01T00:00:00Z', pageviews: 50, visitors: 7 }, { timestamp: '2026-10-02T00:00:00Z', pageviews: 50, visitors: 7 }]
        : by === 'country' ? [{ country: 'DE', pageviews: 90, visitors: 8 }, { country: 'Others', pageviews: 10, visitors: 3 }]
        : by === 'route' ? [{ route: '/game/[gameId]', pageviews: 100, visitors: 8 }] : [];
      return Response.json({ data });
    };
    const report = await getVercelTrafficReport(new Date('2026-10-07T12:00:00Z'), fetcher, { token: 'private-test-token', projectId: 'prj_test', teamId: 'team_test' }, 7);
    assert.equal(report.period, 7);
    assert.deepEqual(report.totals, { pageviews: 100, visitors: 8 });
    assert.deepEqual(report.lifetime, { pageviews: 500, visitors: 30 });
    assert.equal(report.routes[0].label, '/game/[gameId]');
    assert.equal(report.countries[1].label, 'Others');
    assert.equal(report.since, '2026-10-01T00:00:00.000Z');
    assert.equal(requests.length, 10);
    assert.equal(JSON.stringify(report).includes('private-test-token'), false);
    await assert.rejects(getVercelTrafficReport(new Date(), async () => new Response('', { status: 403 }), { token: 'test', projectId: 'test' }), /403/);
  `], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
