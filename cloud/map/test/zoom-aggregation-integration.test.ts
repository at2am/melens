import assert from 'node:assert/strict';
import test from 'node:test';

import { loadMapConfig } from '@melens/shared/config';
import { MAX_RESPONSE_BYTES, type MapItem, type ViewportResponse } from '@melens/shared/contracts/map-contract';
import { createMapService } from '../src/map-service.js';
import type { BigQueryViewAdapter, PreparedViewQuery } from '@melens/shared/query/bigquery-adapter';
import { adaptPlanningRows } from '@melens/shared/query/planning';
import { adaptEventRows } from '@melens/shared/query/events';
import { parseSourceCoverage } from '@melens/shared/query/source-coverage';
import { aggregateLayer } from '../src/services/aggregation.js';
import { createSnapshotStore, MapServiceError } from '../src/services/snapshot-store.js';
import { createViewportService } from '../src/services/viewport.js';

const TIME = '2026-10-01T01:00:00Z';
const BOUNDS = [144.9, -37.9, 145.1, -37.7];
const QUERY = { requestId: 'zoom-1', bbox: BOUNDS, zoom: 12, layers: ['planning'],
  mode: 'historical', window: { from: '2026-10-01T00:00:00Z', to: TIME }, pageSize: 1000 };

function registry(topic: string, count: number) {
  return { source_id: `test.${topic}`, topic, scope: 'city-of-melbourne', coverage_area_refs: ['com:municipal'],
    coverage_from: '2026-09-01T00:00:00Z', coverage_to: '2026-11-01T00:00:00Z',
    license_status: 'verified_open', access_status: 'active', health_state: 'current',
    latest_published_batch_id: 'batch-1', latest_published_at: TIME,
    latest_published_window_from: '2026-09-01T00:00:00Z', latest_published_window_to: '2026-11-01T00:00:00Z',
    latest_published_output_count: count, coverage_evidence_state: 'verified' };
}

function fixture(options: { planning?: number; events?: number; summary?: string;
  separatePoints?: boolean; separateWindows?: boolean } = {}) {
  const counts = { planning: options.planning ?? 2, event: options.events ?? 0 };
  const metadata = Object.entries(counts).filter(([, count]) => count > 0).map(([topic, count]) => registry(topic, count));
  const rows = Object.entries(counts).flatMap(([topic, count]) => Array.from({ length: count }, (_, index) => ({
    geo_record_id: `${topic}:${String(index).padStart(4, '0')}`, version_id: `version-${index}`, source_id: `test.${topic}`, topic,
    assertion_kind: 'plan', is_prediction: false, title: `Published ${topic} ${index}`, summary: options.summary ?? 'Published summary',
    original_url: null, geometry_geojson: JSON.stringify({ type: 'Point',
      coordinates: [144.98 + (options.separatePoints === true ? index * 0.001 : 0), -37.81] }),
    location_role: 'event_site', location_confidence: 'source_coordinate', area_refs: ['com:municipal'],
    observed_at: null, published_at: null, valid_from: options.separateWindows === true
      ? `2026-10-01T00:${String(Math.floor(index / 2)).padStart(2, '0')}:00Z` : '2026-10-01T00:00:00Z',
    valid_to: null, fetched_at: TIME, freshness_state: 'current', record_status: 'planned',
  })));
  const queries: PreparedViewQuery[] = [];
  const adapter: BigQueryViewAdapter = {
    async dryRun() { return { bytesProcessed: 1n }; },
    async startQuery(query) {
      queries.push(query);
      const keys = query.params.publicRecordKeysJson === undefined ? null
        : JSON.parse(String(query.params.publicRecordKeysJson)) as { id: string; versionId: string; sourceId: string }[];
      const selected = query.query.includes('v_source_coverage') ? metadata
        : keys === null ? rows.filter((row) => row.topic === query.params.topic)
          : rows.filter((row) => keys.some((key) => key.id === row.geo_record_id
            && key.versionId === row.version_id && key.sourceId === row.source_id && row.record_status !== 'withdrawn'));
      return { async readPage({ maxRows }) {
        const limit = Math.min(Number(query.params.resultLimit), maxRows);
        return { rows: selected.slice(0, limit).map((row) => ({ record: JSON.stringify(row) })),
          complete: true, hasMore: selected.length > limit };
      }, async cancel() {} };
    },
  };
  const clock = () => new Date(TIME);
  const store = createSnapshotStore({ clock });
  const service = createMapService({ config: loadMapConfig({ MAP_PROJECT_ID: 'melens-testing' }), adapter, clock,
    snapshotStore: store, publicSources: metadata.map((row) => ({ sourceId: row.source_id,
      url: `https://example.org/${row.topic}`, attribution: `Public ${row.topic} records`, versionRef: null })) });
  return { service, rows, queries, store };
}

function onlyAggregate(response: ViewportResponse): Extract<MapItem, { kind: 'aggregate' }> {
  assert.equal(response.layers[0]?.items.length, 1);
  const aggregate = response.layers[0]?.items[0];
  assert.ok(aggregate?.kind === 'aggregate');
  return aggregate;
}

test('production composition groups dense records in all bands and resolves exact original detail/member versions', async () => {
  const f = fixture();
  for (const zoom of [10, 12, 15, 18]) {
    const response = await f.service.queryViewport({ ...QUERY, zoom });
    const aggregate = onlyAggregate(response);
    assert.deepEqual(aggregate.details.memberIds, f.rows.map((row) => row.geo_record_id));
    assert.deepEqual(aggregate.geometry, { type: 'MultiPoint', coordinates: [[144.98, -37.81], [144.98, -37.81]] });
    assert.equal(aggregate.details.metric.unit, 'planning records');
    assert.equal(aggregate.details.resultRange.returnedCount, 2);
    assert.equal(response.layers[0]?.totalMatching, 2);
    const members = await f.service.getMembers(aggregate.id, { requestId: 'members', snapshotId: response.snapshotId, pageSize: 1000 });
    assert.equal(members.scope.kind, 'aggregateMembers');
    assert.deepEqual(members.items.map((item) => [item.id, item.versionId, item.geometry]),
      f.rows.map((row) => [row.geo_record_id, row.version_id, JSON.parse(row.geometry_geojson)]));
    const original = await f.service.getItem(f.rows[0]!.geo_record_id, { requestId: 'detail', snapshotId: response.snapshotId });
    assert.equal(original.item.kind, 'planning');
    assert.equal(original.item.versionId, f.rows[0]!.version_id);
    assert.equal(original.mode, 'historical');
  }
});

test('close-up separates real points without expanding their original spatial precision', async () => {
  const f = fixture({ separatePoints: true });
  onlyAggregate(await f.service.queryViewport({ ...QUERY, zoom: 10 }));
  const close = await f.service.queryViewport({ ...QUERY, zoom: 18 });
  assert.equal(close.layers[0]?.items.length, 2);
  assert.deepEqual(close.layers[0]?.items.map((item) => item.geometry), f.rows.map((row) => JSON.parse(row.geometry_geojson)));
  assert.ok(close.layers[0]?.items.every((item) => item.kind === 'planning' && item.location.precision === 'point'));
});

test('shared 1,000 original-row budget stays partial after groups shrink the presentation', async () => {
  const f = fixture({ planning: 501, events: 501 });
  const response = await f.service.queryViewport({ ...QUERY, layers: ['planning', 'event'] });
  const originals = response.layers.flatMap((layer) => layer.items).flatMap((item) =>
    item.kind === 'aggregate' ? item.details.memberIds : [item.id]);
  assert.equal(originals.length, 1000);
  for (const layer of response.layers) {
    assert.equal(layer.items.length, 1);
    assert.equal(layer.completeness, 'partial');
    assert.equal(layer.totalMatching, null);
    assert.equal(layer.nextCursor, null);
    const group = layer.items[0]!;
    assert.ok(group.kind === 'aggregate');
    assert.deepEqual(group.details.resultRange, { scope: 'viewport', returnedCount: 500, totalMatching: null });
    const page = await f.service.getMembers(group.id, { requestId: 'members', snapshotId: response.snapshotId, pageSize: 1000 });
    assert.equal(page.items.length, 500);
    assert.equal(page.completeness, 'partial');
    assert.equal(page.totalMatching, null);
    assert.equal(page.nextCursor, null);
    assert.equal(page.scope.kind, 'aggregateMembers');
  }
  const initialQueries = f.queries.filter((query) => query.params.publicRecordKeysJson === undefined && !query.query.includes('v_source_coverage'));
  assert.deepEqual(initialQueries.map((query) => query.params.resultLimit), [501, 501]);
});

test('UTF-8 uncompressed 2 MiB budget preserves loaded member scope and an unknown full total', async () => {
  const f = fixture({ planning: 1000, summary: '界'.repeat(4096) });
  assert.ok(Buffer.byteLength(JSON.stringify(f.rows), 'utf8') > MAX_RESPONSE_BYTES);
  const response = await f.service.queryViewport(QUERY);
  assert.ok(Buffer.byteLength(JSON.stringify(response), 'utf8') <= MAX_RESPONSE_BYTES);
  const group = onlyAggregate(response);
  assert.ok(group.details.memberIds.length > 1 && group.details.memberIds.length < 1000);
  assert.equal(response.layers[0]?.completeness, 'partial');
  assert.equal(response.layers[0]?.totalMatching, null);
  assert.equal(group.details.resultRange.totalMatching, null);
  const page = await f.service.getMembers(group.id, { requestId: 'members', snapshotId: response.snapshotId, pageSize: 1000 });
  assert.ok(Buffer.byteLength(JSON.stringify(page), 'utf8') <= MAX_RESPONSE_BYTES);
  assert.equal(page.items.length, group.details.memberIds.length);
  assert.equal(page.completeness, 'partial');
  assert.equal(page.totalMatching, null);
  assert.equal(page.nextCursor, null);
});

test('an injected loader cannot hide excess original rows behind bounded group symbols', async () => {
  const f = fixture({ planning: 501, events: 501 });
  const coverage = parseSourceCoverage({ kind: 'complete', totalMatching: 2, resultBytes: 0,
    rows: [registry('planning', 501), registry('event', 501)] });
  const store = createSnapshotStore();
  const resolveSource = (id: string) => ({ sourceId: id, url: 'https://example.org/public',
    attribution: 'Public test records', versionRef: null });
  const viewport = createViewportService({ store, readCoverage: async () => coverage, aggregateLayer,
    async loadLayer(request, layerId) {
      const rows = f.rows.filter((row) => row.topic === layerId);
      const items = layerId === 'planning' ? adaptPlanningRows(rows, { resolveSource, mode: 'historical' }).items
        : adaptEventRows(rows, { resolveSource, mode: 'historical' }).items;
      return { result: { layerId, state: 'available', freshness: 'current', completeness: 'partial',
        sourceIds: [`test.${layerId}`], coverage: { state: 'unknown', areaRefs: [], window: null, evidenceSourceIds: [] },
        observedWindow: null, updatedAt: TIME, items: [...items], unresolvedCount: null, totalMatching: null, nextCursor: null } };
    } });
  await assert.rejects(viewport.query({ ...QUERY, layers: ['planning', 'event'] }),
    (error: unknown) => error instanceof MapServiceError && error.code === 'budgetExceeded');
  assert.equal(store.stats().snapshots, 0);
});

test('continuations bind the canonical presentation zoom and stored groups recheck original record rights', async () => {
  const f = fixture({ planning: 6, separateWindows: true });
  const request = { ...QUERY, zoom: 12, pageSize: 1 };
  const first = await f.service.queryViewport(request);
  const cursor = first.layers[0]?.nextCursor;
  assert.ok(cursor);
  const storedRequest = f.store.read(first.snapshotId).request;
  assert.ok('zoom' in storedRequest);
  assert.equal(storedRequest.zoom, 12);
  const continuation = { ...request, snapshotId: first.snapshotId, cursor };
  const second = await f.service.queryViewport(continuation);
  assert.notEqual(first.layers[0]?.items[0]?.id, second.layers[0]?.items[0]?.id);
  await assert.rejects(f.service.queryViewport({ ...continuation, zoom: 14.1 }),
    (error: unknown) => error instanceof MapServiceError && error.code === 'cursorMismatch');
  const group = first.layers[0]!.items[0]!;
  assert.ok(group.kind === 'aggregate');
  const member = f.rows.find((row) => group.details.memberIds.includes(row.geo_record_id));
  assert.ok(member);
  member.record_status = 'withdrawn';
  await assert.rejects(f.service.getMembers(group.id, { requestId: 'members', snapshotId: first.snapshotId }),
    (error: unknown) => error instanceof MapServiceError && error.code === 'notAvailable');
});
