import assert from 'node:assert/strict';
import test from 'node:test';

import { loadMapConfig } from '@melens/shared/config';
import type { BigQueryViewAdapter, PreparedViewQuery } from '@melens/shared/query/bigquery-adapter';

import { createSharedFeatureReader, type FeatureSearch } from '../src/features/reader.js';
import { readTurnFeatures } from '../src/features/turn-search.js';
import { collectingSink } from '../src/protocol/sse.js';
import { TurnRegistry } from '../src/tools/define.js';
import { CONTEXT } from './support.js';

const instant = '2026-10-15T01:00:00Z';
const source = { sourceId: 'test.event', url: 'https://example.org/events', attribution: 'Public event source', versionRef: null };
const search: Omit<FeatureSearch, 'signal'> = { requestId: 'reader-rights', bbox: [144.9, -37.9, 145.1, -37.7],
  layers: ['event'], mode: 'current', window: { from: '2026-10-15T00:00:00Z', to: '2026-10-16T00:00:00Z' } };

function fixture() {
  let withdrawn = false;
  const queries: PreparedViewQuery[] = [];
  const metadata = { source_id: source.sourceId, topic: 'event', scope: 'city',
    coverage_area_refs: ['test:municipal'], coverage_from: '2026-10-01T00:00:00Z', coverage_to: null,
    license_status: 'verified_open', access_status: 'active', health_state: 'current',
    latest_published_batch_id: 'same-batch', latest_published_at: instant,
    latest_published_window_from: '2026-10-01T00:00:00Z', latest_published_window_to: '2026-11-01T00:00:00Z',
    latest_published_output_count: 1, coverage_evidence_state: 'verified' };
  const staleRow = { geo_record_id: 'event:withdrawn', version_id: 'v1', source_id: source.sourceId, topic: 'event',
    assertion_kind: 'plan', is_prediction: false, title: 'Published event', summary: 'Published metadata', original_url: source.url,
    geometry_geojson: JSON.stringify({ type: 'Point', coordinates: [144.96, -37.81] }),
    location_role: 'event_site', location_confidence: 'source_coordinate', area_refs: ['test:municipal'],
    observed_at: null, published_at: null, valid_from: '2026-10-15T02:00:00Z', valid_to: '2026-10-15T03:00:00Z',
    fetched_at: instant, freshness_state: 'current', record_status: 'planned' };
  const adapter: BigQueryViewAdapter = {
    async dryRun() { return { bytesProcessed: 1n }; },
    async startQuery(query) {
      queries.push(query);
      return {
        async readPage() {
          const coverage = query.query.includes('v_source_coverage');
          const served = query.query.includes('v_geo_records_current_served');
          const history = query.query.includes('v_geo_records_history');
          const rows = coverage ? [metadata] : served || history || !withdrawn ? [staleRow] : [];
          return { rows: rows.map((row) => ({ record: JSON.stringify(row) })), complete: true, hasMore: false };
        },
        async cancel() {},
      };
    },
  };
  const reader = createSharedFeatureReader({ config: loadMapConfig({ MAP_PROJECT_ID: 'melens-testing' }),
    adapter, publicSources: [source], clock: () => new Date(instant) });
  return { reader, queries, withdraw() { withdrawn = true; } };
}

function turn() {
  return new TurnRegistry({ turnId: 'same-turn-id', uid: 'test-user',
    request: { input: { kind: 'text', text: 'Find events' }, context: CONTEXT },
    sink: collectingSink('same-turn-id'), signal: new AbortController().signal, clock: () => new Date(instant) });
}

test('the real agent reader omits a withdrawn live record even when the served copy still contains it', async () => {
  const f = fixture();
  const query = { ...search, signal: new AbortController().signal };
  assert.deepEqual((await f.reader.search(query)).flatMap((layer) => layer.items.map((item) => item.id)), ['event:withdrawn']);
  f.withdraw();
  assert.deepEqual((await f.reader.search(query)).flatMap((layer) => layer.items), []);
  const dataQueries = f.queries.filter((query) => !query.query.includes('v_source_coverage'));
  assert.equal(dataQueries.length, 2);
  assert.ok(dataQueries.every((query) => query.query.includes('`melens-testing.melens_query.v_geo_records_current`')));
  assert.ok(dataQueries.every((query) => !query.query.includes('_served')));
});

test('same-turn identical searches still share work while the next turn rechecks live rights', async () => {
  const f = fixture();
  const first = turn();
  const pending = readTurnFeatures(f.reader, first, search);
  assert.equal(readTurnFeatures(f.reader, first, { ...search, requestId: 'equivalent' }), pending);
  assert.equal((await pending)[0]?.items.length, 1);
  assert.equal(f.queries.length, 2);
  f.withdraw();
  assert.deepEqual((await readTurnFeatures(f.reader, turn(), search)).flatMap((layer) => layer.items), []);
  assert.equal(f.queries.length, 4);
});

test('the authoritative reader retains eligible historical records', async () => {
  const f = fixture();
  f.withdraw();
  const layers = await f.reader.search({ ...search, mode: 'historical', signal: new AbortController().signal });
  assert.deepEqual(layers.flatMap((layer) => layer.items.map((item) => item.id)), ['event:withdrawn']);
  assert.match(f.queries[1]!.query, /`melens-testing\.melens_query\.v_geo_records_history`/);
});
