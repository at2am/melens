import assert from 'node:assert/strict';
import test from 'node:test';

import { loadMapConfig } from '@melens/shared/config';
import type { BigQueryViewAdapter, PreparedViewQuery } from '@melens/shared/query/bigquery-adapter';

import { createSharedFeatureReader, type FeatureReader, type FeatureSearch } from '../src/features/reader.js';
import { readTurnFeatures, turnSearchTime } from '../src/features/turn-search.js';
import { resolveFeature, toolSpecs } from '../src/tools/catalog.js';
import { TurnRegistry, runTool } from '../src/tools/define.js';
import { collectingSink } from '../src/protocol/sse.js';
import { CONTEXT, eventItem, fakeReader } from './support.js';

const instant = '2026-10-10T07:40:00.000Z';
const source = { sourceId: 'test.event', url: 'https://example.org/events', attribution: 'Public event source', versionRef: null };
const ids = Array.from({ length: 30 }, (_, index) => `event:${index}`);

function registry(options: { signal?: AbortSignal; uid?: string } = {}) {
  let ticks = Date.parse(instant);
  return new TurnRegistry({ turnId: 'same-turn-id', uid: options.uid ?? 'first-user',
    request: { input: { kind: 'text', text: 'Highlight these events' }, context: CONTEXT },
    sink: collectingSink('same-turn-id'), signal: options.signal ?? new AbortController().signal,
    clock: () => new Date(ticks++) });
}

function deferred() {
  let release = () => {};
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release: () => release() };
}

function fixture(options: { failEventReads?: number; eventGate?: Promise<void>; eventStarted?: () => void } = {}) {
  const queries: PreparedViewQuery[] = [];
  let dryRuns = 0;
  let cancelled = 0;
  let failures = options.failEventReads ?? 0;
  const metadata = { source_id: source.sourceId, topic: 'event', scope: 'city-of-melbourne',
    coverage_area_refs: ['com:municipal'], coverage_from: '2026-09-01T00:00:00Z', coverage_to: '2026-11-01T00:00:00Z',
    license_status: 'verified_open', access_status: 'active', health_state: 'current',
    latest_published_batch_id: 'batch-1', latest_published_at: instant,
    latest_published_window_from: '2026-09-01T00:00:00Z', latest_published_window_to: '2026-11-01T00:00:00Z',
    latest_published_output_count: 30, coverage_evidence_state: 'verified' };
  const rows = ids.map((id) => ({ geo_record_id: id, version_id: 'version-1', source_id: source.sourceId, topic: 'event',
    assertion_kind: 'plan', is_prediction: false, title: id, summary: 'Published concert', original_url: source.url,
    geometry_geojson: JSON.stringify({ type: 'Point', coordinates: [144.96, -37.81] }),
    location_role: 'event_site', location_confidence: 'source_coordinate', area_refs: ['com:municipal'],
    observed_at: null, published_at: null, valid_from: '2026-10-10T08:00:00Z', valid_to: '2026-10-10T10:00:00Z',
    fetched_at: instant, freshness_state: 'current', record_status: 'planned' }));
  const adapter: BigQueryViewAdapter = {
    async dryRun() { dryRuns += 1; return { bytesProcessed: 1n }; },
    async startQuery(query) {
      queries.push(query);
      const coverage = query.query.includes('v_source_coverage');
      return {
        async readPage() {
          if (!coverage) {
            options.eventStarted?.();
            await options.eventGate;
            if (failures > 0) { failures -= 1; throw new Error('Temporary event read failure'); }
          }
          return { rows: (coverage ? [metadata] : rows).map((row) => ({ record: JSON.stringify(row) })), complete: true, hasMore: false };
        },
        async cancel() { cancelled += 1; },
      };
    },
  };
  const reader = createSharedFeatureReader({ config: loadMapConfig({ MAP_PROJECT_ID: 'melens-testing' }),
    adapter, publicSources: [source], clock: () => new Date(instant) });
  const counts = () => ({ coverage: queries.filter((query) => query.query.includes('v_source_coverage')).length,
    events: queries.filter((query) => query.params.topic === 'event').length, dryRuns, cancelled });
  return { reader, queries, counts };
}

test('30 unknown event IDs share one coverage query and one layer query within a turn', async () => {
  const f = fixture();
  const turn = registry();
  const highlight = toolSpecs({ features: f.reader, grounding: null }).find((spec) => spec.name === 'highlight_features');
  assert.ok(highlight);
  assert.deepEqual(await runTool(highlight, turn, { ids }), { ok: true, missing: [] });
  assert.deepEqual(f.counts(), { coverage: 1, events: 1, dryRuns: 0, cancelled: 0 });
  assert.equal(turn.features.size, 30);
  assert.equal((await resolveFeature({ features: f.reader, grounding: null }, turn, 'event:29'))?.id, 'event:29');
  assert.equal(await resolveFeature({ features: f.reader, grounding: null }, turn, 'event:absent-1'), undefined);
  assert.equal(await resolveFeature({ features: f.reader, grounding: null }, turn, 'event:absent-2'), undefined);
  assert.deepEqual(f.counts(), { coverage: 1, events: 1, dryRuns: 0, cancelled: 0 });
});

test('all returned features are remembered and a different turn reads again, even with the same turn ID', async () => {
  const f = fixture();
  const deps = { features: f.reader, grounding: null };
  const first = registry();
  assert.equal((await resolveFeature(deps, first, 'event:0'))?.id, 'event:0');
  assert.equal(first.features.size, 30);
  assert.equal((await resolveFeature(deps, first, 'event:1'))?.id, 'event:1');
  assert.deepEqual(f.counts(), { coverage: 1, events: 1, dryRuns: 0, cancelled: 0 });
  await resolveFeature(deps, registry({ uid: 'other-user' }), 'event:0');
  assert.deepEqual(f.counts(), { coverage: 2, events: 2, dryRuns: 0, cancelled: 0 });
});

test('an unavailable layer is retried within the turn instead of cached as an empty success', async () => {
  const f = fixture({ failEventReads: 1 });
  const deps = { features: f.reader, grounding: null };
  const turn = registry();
  assert.equal(await resolveFeature(deps, turn, 'event:0'), undefined);
  assert.equal((await resolveFeature(deps, turn, 'event:0'))?.id, 'event:0');
  assert.deepEqual(f.counts(), { coverage: 2, events: 2, dryRuns: 0, cancelled: 1 });
});

test('same-turn keyword and limit changes filter the whole shared result independently', async () => {
  const f = fixture();
  const turn = registry();
  const search = toolSpecs({ features: f.reader, grounding: null }).find((spec) => spec.name === 'search_features');
  assert.ok(search);
  const area = { bbox: CONTEXT.viewport };
  const first = await runTool(search, turn, { area, layers: ['event'], query: 'Published', limit: 1 });
  const second = await runTool(search, turn, { area, layers: ['event'], query: 'event:29', limit: 20 });
  assert.ok(typeof first === 'object' && first !== null && 'total' in first && 'items' in first);
  assert.equal(first.total, 30);
  assert.ok(Array.isArray(first.items));
  assert.equal(first.items.length, 1);
  assert.ok(typeof second === 'object' && second !== null && 'total' in second && 'items' in second);
  assert.equal(second.total, 1);
  assert.ok(Array.isArray(second.items));
  assert.equal(second.items[0].id, 'event:29');
  assert.deepEqual(f.counts(), { coverage: 1, events: 1, dryRuns: 0, cancelled: 0 });
});

test('tool time filters keep distinct microseconds and equivalent offset instants share the read', async () => {
  const f = fixture();
  const turn = registry();
  const search = toolSpecs({ features: f.reader, grounding: null }).find((spec) => spec.name === 'search_features');
  assert.ok(search);
  const args = { area: { bbox: CONTEXT.viewport }, layers: ['event'],
    time: { from: '2026-10-10T18:40:00.000001+11:00', to: '2026-10-11T07:40:00Z' } };
  await runTool(search, turn, args);
  await runTool(search, turn, { ...args, time: { ...args.time, from: '2026-10-10T07:40:00.000002Z' } });
  await runTool(search, turn, { ...args, time: { ...args.time, from: '2026-10-10T07:40:00.000001Z' } });
  assert.deepEqual(f.queries.filter((query) => query.params.topic === 'event').map((query) => query.params.from),
    ['2026-10-10T07:40:00.000001Z', '2026-10-10T07:40:00.000002Z']);
  assert.deepEqual(f.counts(), { coverage: 2, events: 2, dryRuns: 0, cancelled: 0 });
});

test('pending reads are shared and a turn abort cancels their single underlying query', async () => {
  const gate = deferred();
  const started = deferred();
  const controller = new AbortController();
  const f = fixture({ eventGate: gate.promise, eventStarted: started.release });
  const turn = registry({ signal: controller.signal });
  const deps = { features: f.reader, grounding: null };
  const pending = Promise.all(ids.map((id) => resolveFeature(deps, turn, id)));
  await started.promise;
  assert.deepEqual(f.counts(), { coverage: 1, events: 1, dryRuns: 0, cancelled: 0 });
  controller.abort(new Error('Turn cancelled'));
  await assert.rejects(pending);
  assert.equal(f.counts().cancelled, 1);
  gate.release();
  turn.rememberFeatures([eventItem('event:known', 'Known', 144.96, -37.81, instant, '2026-10-10T10:00:00Z')]);
  await assert.rejects(resolveFeature(deps, turn, 'event:known'));
});

test('query keys include exact bounds, layers, mode, microsecond window and reader identity', async () => {
  const turn = registry();
  const reader = fakeReader([]);
  const query: Omit<FeatureSearch, 'signal'> = { requestId: 'first', bbox: [144.95, -37.83, 144.98, -37.80],
    layers: ['event', 'news'], mode: 'current', window: { from: instant, to: '2026-10-11T07:40:00Z' } };
  await readTurnFeatures(reader, turn, query);
  await readTurnFeatures(reader, turn, { ...query, requestId: 'second', layers: ['news', 'event'],
    window: { ...query.window, from: '2026-10-10T07:40:00Z' } });
  assert.equal(reader.queries.length, 1, 'Only layer order, request ID and fractional zero spelling changed');
  await readTurnFeatures(reader, turn, { ...query, bbox: [144.94, -37.83, 144.98, -37.80] });
  await readTurnFeatures(reader, turn, { ...query, layers: ['event'] });
  await readTurnFeatures(reader, turn, { ...query, mode: 'historical' });
  await readTurnFeatures(reader, turn, { ...query, window: { ...query.window, from: '2026-10-10T07:40:00.000001Z' } });
  await readTurnFeatures(reader, turn, { ...query, window: { ...query.window, to: '2026-10-11T07:40:00.000001Z' } });
  assert.equal(reader.queries.length, 6);
  const otherReader = fakeReader([]);
  await readTurnFeatures(otherReader, turn, query);
  assert.equal(otherReader.queries.length, 1);
  const pinned = turnSearchTime(turn).getTime();
  assert.notEqual(turn.now().getTime(), turn.now().getTime(), 'The live clock keeps advancing');
  assert.equal(turnSearchTime(turn).getTime(), pinned);
});

test('rejected reads clear their pending entry and mixed parking reads keep the direct path', async () => {
  const turn = registry();
  const reader = fakeReader([]);
  let fail = true;
  const retrying: FeatureReader = { search(query) {
    if (fail) { fail = false; return Promise.reject(new Error('Coverage unavailable')); }
    return reader.search(query);
  } };
  const query: Omit<FeatureSearch, 'signal'> = { requestId: 'retry', bbox: [144.95, -37.83, 144.98, -37.80],
    layers: ['event'], mode: 'current', window: { from: instant, to: '2026-10-11T07:40:00Z' } };
  await assert.rejects(readTurnFeatures(retrying, turn, query));
  await readTurnFeatures(retrying, turn, query);
  assert.equal(reader.queries.length, 1);
  const mixed = { ...query, layers: ['event', 'parking'] satisfies FeatureSearch['layers'] };
  await readTurnFeatures(reader, turn, mixed);
  await readTurnFeatures(reader, turn, mixed);
  assert.equal(reader.queries.length, 3);
});
