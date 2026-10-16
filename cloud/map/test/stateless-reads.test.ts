import assert from 'node:assert/strict';
import test from 'node:test';

import { loadMapConfig } from '@melens/shared/config';
import { parseUnlocatedQuery, parseViewportQuery, type MapItem, type ViewportResponse } from '@melens/shared/contracts/map-contract';
import type { BigQueryViewAdapter, PreparedViewQuery } from '@melens/shared/query/bigquery-adapter';
import type { ViewRow } from '@melens/shared/query/query-runner';
import { createMapService } from '../src/map-service.js';
import { CURSOR_PLACEHOLDER, cursorOffset, cursorToken, readContext, unlocatedToken, viewportToken }
  from '../src/services/read-token.js';
import { MapServiceError } from '../src/services/viewport.js';

const publishedAt = '2026-10-01T01:00:01.000Z';
const window = { from: '2026-10-01T00:00:00.000Z', to: '2026-10-01T01:00:00.000Z' };

function fixture(layer: 'anomaly' | 'planning') {
  const sourceId = `cache-rights.${layer}`;
  const publication = {
    source_id: sourceId, topic: layer, scope: 'city-of-melbourne', coverage_area_refs: ['com:municipal'],
    coverage_from: '2026-09-01T00:00:00Z', coverage_to: null,
    license_status: 'verified_open', access_status: 'active', health_state: 'current',
    latest_published_batch_id: 'unchanged-batch', latest_published_at: publishedAt,
    latest_published_window_from: '2026-09-01T00:00:00Z', latest_published_window_to: '2026-11-01T00:00:00Z',
    latest_published_output_count: 2, coverage_evidence_state: 'verified',
  };
  const rows: ViewRow[] = [1, 2, 3].map((index) => layer === 'anomaly' ? {
    result_id: `result-${index}`, source_id: sourceId, batch_id: 'unchanged-batch', sensor_id: `sensor-${index}`,
    sensor_name: `Sensor ${index}`, lat: -37.81, lon: 144.97,
    window_from: window.from, window_to: window.to, observation_id: `observation-${index}`,
    baseline_definition_id: 'same-hour-past-seven-days', baseline_value: 10, observed_value: 30, delta: 20,
    direction: 'higher', classification: 'anomalous', is_replay: false, replay_label: null,
    location_evidence: 'Published sensor coordinates valid for the count window', published_at: publishedAt,
  } : {
    geo_record_id: `planning:result-${index}`, version_id: `version-${index}`, source_id: sourceId, topic: 'planning',
    assertion_kind: 'plan', is_prediction: false, title: `Planning record ${index}`, summary: 'Published plan',
    original_url: null, geometry_geojson: JSON.stringify({ type: 'Point', coordinates: [144.97, -37.81] }),
    location_role: 'event_site', location_confidence: 'source_coordinate', area_refs: ['com:municipal'],
    observed_at: null, published_at: null, valid_from: window.from, valid_to: null,
    fetched_at: publishedAt, freshness_state: 'current', record_status: 'active',
  });
  const withdrawn = new Set<string>();
  const queries: PreparedViewQuery[] = [];
  let sourcePublic = true;
  let now = Date.parse(publishedAt);
  const adapter: BigQueryViewAdapter = {
    async dryRun() { return { bytesProcessed: 1n }; },
    async startQuery(query) {
      queries.push(query);
      const currentRows = rows.filter((row) => !withdrawn.has(String(row.result_id ?? row.geo_record_id)));
      let selected: readonly ViewRow[];
      if (query.query.includes('v_source_coverage')) {
        selected = [{ ...publication, access_status: sourcePublic ? 'active' : 'paused' }];
      } else if (query.query.includes('v_geo_records_current_state')) {
        selected = [{ source_id: sourceId, batch_id: publication.latest_published_batch_id }];
      } else selected = currentRows;
      return {
        async readPage({ maxRows }) {
          const limit = Math.min(maxRows, Number(query.params.resultLimit));
          return { rows: selected.slice(0, limit).map((row) => ({ record: JSON.stringify(row) })),
            complete: true, hasMore: selected.length > limit };
        },
        async cancel() {},
      };
    },
  };
  const service = createMapService({ config: loadMapConfig({ MAP_PROJECT_ID: 'melens-testing' }), adapter,
    currentLayerCache: true, clock: () => new Date(now), resolveArea: () => 'contains',
    publicSources: [{ sourceId, url: 'https://example.org/published-source', attribution: 'Reviewed source', versionRef: null }] });
  const request = { requestId: `cached-${layer}`, bbox: [144.95, -37.83, 144.99, -37.8],
    zoom: 14, layers: [layer], mode: 'current', window, pageSize: 1000 };
  return { service, request, queries, publication, withdraw(id: string) { withdrawn.add(id); },
    revokeSource() { sourcePublic = false; }, advance(milliseconds: number) { now += milliseconds; } };
}

function aggregate(response: ViewportResponse, members: number): Extract<MapItem, { kind: 'aggregate' }> {
  assert.equal(response.layers[0]?.state, 'available');
  assert.equal(response.layers[0]?.items.length, 1);
  const item = response.layers[0]?.items[0];
  assert.ok(item?.kind === 'aggregate');
  assert.equal(item.details.memberIds.length, members);
  return item;
}

/** Lets background reloads (registry, layer cache) finish. */
const settle = async () => { for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setImmediate(resolve)); };

const errorCode = (code: string) => (error: unknown) => error instanceof MapServiceError && error.code === code;

for (const layer of ['planning', 'anomaly'] as const) {
  test(`cached ${layer} rows answer viewport, detail and member reads with no further BigQuery job`, async () => {
    const f = fixture(layer);
    const first = await f.service.queryViewport(f.request);
    const group = aggregate(first, 3);
    const jobs = f.queries.length;
    await f.service.queryViewport({ ...f.request, requestId: 'again', bbox: [144.96, -37.82, 144.98, -37.8] });
    const context = { requestId: 'details', snapshotId: first.snapshotId };
    assert.equal((await f.service.getItem(group.id, context)).item.id, group.id);
    assert.equal((await f.service.getItem(group.details.memberIds[0]!, context)).item.id, group.details.memberIds[0]);
    assert.equal((await f.service.getMembers(group.id, context)).items.length, 3);
    assert.equal(f.queries.length, jobs);
  });
}

test('a reload serves the previous rows until the new ones load, and the aggregate keeps its id', async () => {
  const f = fixture('planning');
  const first = await f.service.queryViewport(f.request);
  const group = aggregate(first, 3);
  f.withdraw('planning:result-2');
  f.advance(2 * 60_000 + 1);
  // The entry is past its age: this request is answered from the previous rows while the reload runs.
  aggregate(await f.service.queryViewport({ ...f.request, requestId: 'stale' }), 3);
  await settle();
  const reloaded = aggregate(await f.service.queryViewport({ ...f.request, requestId: 'reloaded' }), 2);
  assert.equal(reloaded.id, group.id);
  assert.notEqual(reloaded.versionId, group.versionId);
  // A member read with the first token lists the cell's current members.
  const members = await f.service.getMembers(group.id, { requestId: 'members', snapshotId: first.snapshotId });
  assert.deepEqual(members.items.map((item) => item.id), ['planning:result-1', 'planning:result-3']);
  await assert.rejects(f.service.getItem('planning:result-2', { requestId: 'gone', snapshotId: first.snapshotId }), errorCode('notFound'));
});

test('a revoked source leaves the map once the registry read past its cache window is replaced', async () => {
  const f = fixture('planning');
  const planningLayer = (response: Awaited<ReturnType<typeof f.service.getCatalog>>) =>
    response.layers.find((layer) => layer.id === 'planning');
  assert.equal(planningLayer(await f.service.getCatalog())?.availability, 'available');
  f.revokeSource();
  f.advance(30_001);
  // The expired read still answers once while one background read replaces it; nobody waits for the registry.
  assert.equal(planningLayer(await f.service.getCatalog())?.availability, 'available');
  await settle();
  assert.equal(planningLayer(await f.service.getCatalog())?.availability, 'notCovered');
  assert.equal(f.queries.filter((query) => query.query.includes('v_source_coverage')).length, 2);
  const first = await f.service.queryViewport(f.request);
  assert.equal(first.layers[0]?.items.length, 0);
});

test('read tokens round-trip the request context and stay within the 256-character id limit', () => {
  const request = parseViewportQuery({ requestId: 'token', bbox: [144.95123456789012, -37.81234567890123, 144.97123456789012, -37.79123456789012],
    zoom: 15.25, layers: ['parking', 'event', 'disruption'], mode: 'current', window, pageSize: 1000,
    boundaryFilter: { level: 'LGA', vintage: '2021' } });
  const token = viewportToken(request);
  assert.ok(token.length <= 256);
  const decoded = readContext(token, 'reader');
  assert.ok(decoded.family === 'viewport');
  assert.deepEqual(decoded.request, { ...request, requestId: 'reader' });
  const query = parseUnlocatedQuery({ requestId: 'token', layers: ['news'], mode: 'current', window,
    scope: { areaRefs: ['com:municipal', 'ASGS_LGA:24600:2025'] } });
  const list = readContext(unlocatedToken(query), 'reader');
  assert.ok(list.family === 'unlocated');
  assert.deepEqual(list.query, { ...query, requestId: 'reader' });
  // A context too long for an id gets a digest, which reads as expired rather than failing the first response.
  const long = parseUnlocatedQuery({ ...query, scope: { areaRefs: Array.from({ length: 20 }, (_, i) => `ASGS_SA2:2060411${i}:2021`) } });
  assert.match(unlocatedToken(long), /^x1~/);
  assert.throws(() => readContext(unlocatedToken(long), 'reader'), errorCode('snapshotExpired'));
  assert.throws(() => readContext(token.replace('~15.25~', '~15.250~'), 'reader'), errorCode('snapshotExpired'));
  const binding = { snapshotId: token, family: 'viewport' as const, layerId: 'event' as const, aggregateId: null, pageSize: 1000 };
  assert.equal(cursorOffset(cursorToken(7, binding), binding), 7);
  assert.throws(() => cursorOffset(cursorToken(7, binding), { ...binding, layerId: 'parking' }), errorCode('cursorMismatch'));
  assert.throws(() => cursorOffset(cursorToken(7, binding).replace('~7~', '~8~'), binding), errorCode('cursorMismatch'));
  assert.ok(CURSOR_PLACEHOLDER.length >= cursorToken(999, binding).length);
});
