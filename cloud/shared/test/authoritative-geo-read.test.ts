import assert from 'node:assert/strict';
import test from 'node:test';

import { loadMapConfig } from '../src/config.js';
import { parseViewportQuery } from '../src/contracts/map-contract.js';
import type { BigQueryViewAdapter, PreparedViewQuery } from '../src/query/bigquery-adapter.js';
import { createViewQueryRunner, MapQueryError } from '../src/query/query-runner.js';

const config = loadMapConfig({ MAP_PROJECT_ID: 'melens-testing' });
const request = parseViewportQuery({ requestId: 'authoritative-geo', bbox: [144.9, -37.9, 145.1, -37.7],
  zoom: 14, layers: ['planning', 'disruption', 'event', 'news'], mode: 'current',
  window: { from: '2026-10-15T00:00:00Z', to: '2026-10-16T00:00:00Z' } });

function fixture() {
  const queries: PreparedViewQuery[] = [];
  const adapter: BigQueryViewAdapter = {
    async dryRun() { return { bytesProcessed: 1n }; },
    async startQuery(query) {
      queries.push(query);
      return { async readPage() { return { rows: [], complete: true, hasMore: false }; }, async cancel() {} };
    },
  };
  return { queries, adapter };
}

test('the server-owned authoritative reader uses the live current gate while map defaults stay served', async () => {
  const f = fixture();
  const display = createViewQueryRunner({ config, adapter: f.adapter });
  const authoritative = createViewQueryRunner({ config, adapter: f.adapter, currentGeoRead: 'authoritative' });
  for (const queryId of ['planning', 'disruption', 'event', 'news'] as const) {
    await display.run({ queryId, request });
    await authoritative.run({ queryId, request });
    const [shown, checked] = f.queries.slice(-2);
    assert.ok(shown && checked);
    assert.match(shown.query, /`melens-testing\.melens_query\.v_geo_records_current_served`/);
    assert.match(checked.query, /`melens-testing\.melens_query\.v_geo_records_current`/);
    assert.doesNotMatch(checked.query, /_served|melens_ingest/);
    assert.equal(checked.maximumBytesBilled, shown.maximumBytesBilled);
    assert.equal(checked.jobTimeoutMs, shown.jobTimeoutMs);
    assert.deepEqual(checked.params, shown.params);
  }
});

test('the authoritative current policy leaves historical reads unchanged', async () => {
  const f = fixture();
  const display = createViewQueryRunner({ config, adapter: f.adapter });
  const authoritative = createViewQueryRunner({ config, adapter: f.adapter, currentGeoRead: 'authoritative' });
  const input = { queryId: 'event', request: { ...request, mode: 'historical' } };
  await display.run(input);
  await authoritative.run(input);
  assert.deepEqual(f.queries[0], f.queries[1]);
  assert.match(f.queries[1]!.query, /`melens-testing\.melens_query\.v_geo_records_history`/);
});

test('caller input cannot select the internal current-geo policy', async () => {
  const f = fixture();
  const runner = createViewQueryRunner({ config, adapter: f.adapter });
  await assert.rejects(runner.run({ queryId: 'planning', request, currentGeoRead: 'authoritative' }),
    (error: unknown) => error instanceof MapQueryError && error.code === 'invalidRequest');
  assert.equal(f.queries.length, 0);
});
