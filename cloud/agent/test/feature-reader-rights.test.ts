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

/**
 * One event source. `published` is the registry's latest batch, `reflected` the batch the served copy's state
 * table reports, and `servedRows` what the copy holds; the history view always keeps the record.
 */
function fixture() {
  const state = { published: 'batch-1', reflected: 'batch-1', withdrawn: false, now: new Date(instant).getTime() };
  const queries: PreparedViewQuery[] = [];
  const metadata = () => ({ source_id: source.sourceId, topic: 'event', scope: 'city',
    coverage_area_refs: ['test:municipal'], coverage_from: '2026-10-01T00:00:00Z', coverage_to: null,
    license_status: 'verified_open', access_status: 'active', health_state: 'current',
    latest_published_batch_id: state.published, latest_published_at: instant,
    latest_published_window_from: '2026-10-01T00:00:00Z', latest_published_window_to: '2026-11-01T00:00:00Z',
    latest_published_output_count: 1, coverage_evidence_state: 'verified' });
  const eventRow = { geo_record_id: 'event:withdrawn', version_id: 'v1', source_id: source.sourceId, topic: 'event',
    assertion_kind: 'plan', is_prediction: false, title: 'Published event', summary: 'Published metadata', original_url: source.url,
    geometry_geojson: JSON.stringify({ type: 'Point', coordinates: [144.96, -37.81] }),
    location_role: 'event_site', location_confidence: 'source_coordinate', area_refs: ['test:municipal'],
    observed_at: null, published_at: null, valid_from: '2026-10-15T02:00:00Z', valid_to: '2026-10-15T03:00:00Z',
    fetched_at: instant, freshness_state: 'current', record_status: 'planned' };
  const rowsFor = (query: string): object[] => {
    if (query.includes('v_source_coverage')) return [metadata()];
    if (query.includes('v_geo_records_current_state')) return [{ source_id: source.sourceId, batch_id: state.reflected }];
    if (query.includes('v_geo_records_history')) return [eventRow];
    if (query.includes('v_geo_records_current_served')) return state.withdrawn ? [] : [eventRow];
    throw new Error(`Unexpected query: ${query}`);
  };
  const adapter: BigQueryViewAdapter = {
    async dryRun() { return { bytesProcessed: 1n }; },
    async startQuery(query) {
      queries.push(query);
      return {
        async readPage() {
          return { rows: rowsFor(query.query).map((row) => ({ record: JSON.stringify(row) })), complete: true, hasMore: false };
        },
        async cancel() {},
      };
    },
  };
  const reader = createSharedFeatureReader({ config: loadMapConfig({ MAP_PROJECT_ID: 'melens-testing' }),
    adapter, publicSources: [source], clock: () => new Date(state.now) });
  const dataQueries = () => queries.filter((query) => !query.query.includes('v_source_coverage'));
  return { reader, queries, dataQueries, state };
}

const ids = (layers: Awaited<ReturnType<ReturnType<typeof fixture>['reader']['search']>>) =>
  layers.flatMap((layer) => layer.items.map((item) => item.id));

function turn(f: ReturnType<typeof fixture>) {
  return new TurnRegistry({ turnId: 'same-turn-id', uid: 'test-user',
    request: { input: { kind: 'text', text: 'Find events' }, context: CONTEXT },
    sink: collectingSink('same-turn-id'), signal: new AbortController().signal, clock: () => new Date(f.state.now) });
}

test('current searches read the served copy, proven against its publication state, never the history-wide current view', async () => {
  const f = fixture();
  assert.deepEqual(ids(await f.reader.search({ ...search, signal: new AbortController().signal })), ['event:withdrawn']);
  const views = f.dataQueries().map((query) => query.query);
  assert.ok(views.some((query) => query.includes('`melens-testing.melens_query.v_geo_records_current_served`')));
  assert.ok(views.some((query) => query.includes('`melens-testing.melens_query.v_geo_records_current_state`')));
  assert.ok(views.every((query) => !query.includes('`melens-testing.melens_query.v_geo_records_current`')));
});

test('searches across turns share one load per publication, and a new publication with a withdrawal reloads it', async () => {
  const f = fixture();
  assert.deepEqual(ids(await readTurnFeatures(f.reader, turn(f), search)), ['event:withdrawn']);
  const loads = f.dataQueries().length;
  assert.deepEqual(ids(await readTurnFeatures(f.reader, turn(f), search)), ['event:withdrawn']);
  assert.equal(f.dataQueries().length, loads, 'A second turn is answered from memory');
  // The source publishes a batch that withdraws the record; once the registry read expires, the copy reloads.
  Object.assign(f.state, { published: 'batch-2', reflected: 'batch-2', withdrawn: true });
  f.state.now += 5 * 60_000;
  assert.deepEqual(ids(await readTurnFeatures(f.reader, turn(f), search)), []);
  assert.ok(f.dataQueries().length > loads);
});

test('a served copy that does not yet reflect the latest publication is not answered from', async () => {
  const f = fixture();
  f.state.reflected = 'batch-0';
  const [layer] = await f.reader.search({ ...search, signal: new AbortController().signal });
  assert.equal(layer?.state, 'unavailable');
  assert.deepEqual(layer?.items, []);
});

test('historical searches retain eligible records from the history view', async () => {
  const f = fixture();
  f.state.withdrawn = true;
  const layers = await f.reader.search({ ...search, mode: 'historical', signal: new AbortController().signal });
  assert.deepEqual(ids(layers), ['event:withdrawn']);
  assert.ok(f.dataQueries().some((query) => /`melens-testing\.melens_query\.v_geo_records_history`/.test(query.query)));
});

test('warming loads the shared layers, so a later search reads them from memory', async () => {
  const f = fixture();
  await f.reader.warm?.();
  const loads = f.dataQueries().length;
  assert.ok(loads > 0);
  assert.deepEqual(ids(await f.reader.search({ ...search, signal: new AbortController().signal })), ['event:withdrawn']);
  assert.equal(f.dataQueries().length, loads, 'The event layer was already loaded');
});
