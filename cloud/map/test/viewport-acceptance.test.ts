import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import test from 'node:test';

import { loadMapConfig } from '@melens/shared/config';
import type { MapItem, ViewportResponse } from '@melens/shared/contracts/map-contract';
import { createMapService } from '../src/map-service.js';
import { VERIFIED_RECORD_TTL_MS } from '../src/services/public-records.js';
import type { BigQueryViewAdapter, PreparedViewQuery } from '@melens/shared/query/bigquery-adapter';
import type { ViewRow } from '@melens/shared/query/query-runner';
import { createMapHttpServer } from '../src/server.js';
import { MapServiceError } from '../src/services/snapshot-store.js';

const timestamp = '2026-10-01T01:00:00.000001Z';
const request = { requestId: 'acceptance-viewport', bbox: [144.95, -37.83, 144.99, -37.8],
  zoom: 14, layers: ['planning'], mode: 'current',
  window: { from: '2026-10-01T00:45:00Z', to: '2026-10-01T01:00:00Z' }, pageSize: 1000 };

function metadata(sourceId: string, topic: string): ViewRow {
  return { source_id: sourceId, topic, scope: 'acceptance-jurisdiction', coverage_area_refs: ['acceptance:area'],
    coverage_from: '2026-09-01T00:00:00Z', coverage_to: '2026-11-01T00:00:00Z',
    license_status: 'verified_open', access_status: 'active', health_state: 'current',
    latest_published_batch_id: 'acceptance-batch', latest_published_at: timestamp,
    latest_published_window_from: '2026-09-01T00:00:00Z', latest_published_window_to: '2026-11-01T00:00:00Z',
    latest_published_output_count: 5, coverage_evidence_state: 'verified' };
}
function planning(id: string, status = 'active'): ViewRow {
  return { geo_record_id: id, version_id: 'acceptance-version', source_id: 'acceptance.planning', topic: 'planning',
    assertion_kind: 'plan', is_prediction: false, title: id, summary: 'Published public summary', original_url: null,
    geometry_geojson: JSON.stringify({ type: 'Point', coordinates: [144.97, -37.81] }),
    location_role: 'event_site', location_confidence: 'source_coordinate', area_refs: ['acceptance:area'],
    observed_at: null, published_at: null, valid_from: '2026-10-01T00:00:00.000001Z', valid_to: null,
    fetched_at: timestamp, freshness_state: 'current', record_status: status };
}
function observation(sensorId: string, count: number | null): ViewRow {
  return { rights_evidence: 'latest_published_record_v1', source_record_id: `counts:${sensorId}`,
    version_id: 'native-observation-v1', location_source_record_id: null, location_version_id: null,
    source_id: 'acceptance.pedestrian', batch_id: 'acceptance-batch', sensor_id: sensorId,
    observed_at: '2026-10-01T00:59:00.000001Z', direction_a_count: null, direction_b_count: null,
    total_count: count, record_granularity: 'sensor_minute', fetched_at: timestamp,
    source_last_success_at: timestamp, location_source_id: null, location_valid_from: null,
    location_valid_to: null, geometry_geojson: null, location_status: 'unlocated', source_freshness_state: 'current' };
}
function pedestrianRight(item: Extract<MapItem, { kind: 'pedestrian' }>): string {
  return JSON.stringify([item.sources[0]!.sourceId, item.details.sensorId, item.time.observedAt]);
}

/** Direct SQL responses; publication-cache behavior is tested in current-cache-rights.test.ts. */
function publishedFixture(options: { rows?: ViewRow[]; unavailableTraffic?: boolean; partial?: boolean;
  independentPedestrianRights?: boolean; productionAggregation?: boolean } = {}) {
  let elapsed = 0;
  const sources = [metadata('acceptance.planning', 'planning'), metadata('acceptance.traffic', 'transport'),
    metadata('acceptance.pedestrian', 'pedestrian'), metadata('acceptance.boundary', 'boundary')];
  const rows = options.rows ?? [planning('acceptance:first'), planning('acceptance:second')];
  const unlocated = [observation('unknown', null), observation('zero', 0)];
  const boundaries: ViewRow[] = [{ rights_evidence: 'latest_published_record_v1', boundary_id: 'ASGS_LGA:24600:2021', version_id: 'acceptance-boundary-version',
    source_id: 'acceptance.boundary', source_record_id: 'acceptance.boundary:24600', scheme: 'ASGS_LGA',
    code: '24600', name: 'Synthetic acceptance area', vintage: '2021', valid_from: null, valid_to: null,
    fetched_at: timestamp, geometry_geojson: JSON.stringify({ type: 'Polygon', coordinates: [
      [[144.96, -37.82], [144.98, -37.82], [144.98, -37.80], [144.96, -37.82]],
    ] }) }];
  // This permission ledger is independent of the readable view rows and batch watermark.
  const rights = new Set(['unknown', 'zero'].map((sensorId) =>
    JSON.stringify(['acceptance.pedestrian', sensorId, '2026-10-01T00:59:00.000001Z'])));
  const rightsChecks: (readonly MapItem[])[] = [];
  const checkPublicRecords = async (items: readonly MapItem[]) => {
    rightsChecks.push([...items]);
    return items.every((item) => item.kind === 'pedestrian' && rights.has(pedestrianRight(item)));
  };
  const queries: PreparedViewQuery[] = [];
  const adapter: BigQueryViewAdapter = {
    async dryRun() { return { bytesProcessed: 1n }; },
    async startQuery(query) {
      queries.push(query);
      if (options.unavailableTraffic === true && query.params.topic === 'transport') {
        throw new Error('Private backend diagnostic must remain private.');
      }
      let selected: ViewRow[];
      const keysValue = query.params.publicRecordKeysJson;
      if (typeof keysValue === 'string') {
        const keys = JSON.parse(keysValue) as { id: string; versionId: string; sourceId: string;
          sensorId?: string; observedAt?: string }[];
        selected = [...rows, ...unlocated, ...boundaries].filter((row) => keys.some((key) =>
          row.source_id === key.sourceId && (key.sensorId === undefined
            ? (row.geo_record_id ?? row.boundary_id) === key.id && row.version_id === key.versionId && row.record_status !== 'withdrawn'
            : row.sensor_id === key.sensorId && row.observed_at === key.observedAt)));
      } else if (query.query.includes('v_source_coverage')) selected = sources;
      else if (query.query.includes('v_pedestrian_observations')) selected = unlocated;
      else if (query.query.includes('v_boundaries')) selected = boundaries;
      else {
        selected = rows.filter((row) => row.topic === query.params.topic);
        if (query.query.includes('v_geo_records_current')) {
          selected = selected.filter((row) => ['active', 'planned'].includes(String(row.record_status)));
        } else {
          selected = selected.filter((row) => row.record_status !== 'withdrawn' && row.valid_from !== null);
        }
      }
      return { async readPage({ maxRows }) { return {
        rows: selected.slice(0, Math.min(maxRows, Number(query.params.resultLimit)))
          .map((row) => ({ record: JSON.stringify(row) })),
        complete: true,
        hasMore: options.partial === true && !query.query.includes('v_source_coverage') && keysValue === undefined,
      }; }, async cancel() {} };
    },
  };
  const service = createMapService({ adapter, config: loadMapConfig({ MAP_PROJECT_ID: 'melens-testing' }),
    currentLayerCache: false,
    // Flat-record acceptance deliberately separates paging/state semantics from T025 grouping.
    ...(options.productionAggregation === true ? {} : {
      aggregateLayer: (layer) => ({ items: layer.items, groups: new Map() }),
    }),
    ...(options.independentPedestrianRights === true ? { checkPublicRecords } : {}),
    clock: () => new Date(Date.parse(timestamp) + elapsed), resolveArea: () => 'contains', publicSources: sources.map((row) => ({
      sourceId: String(row.source_id), url: 'https://example.org/public-source', attribution: 'Synthetic public source', versionRef: null,
    })) });
  return { service, sources, rows, unlocated, boundaries, queries, rights, rightsChecks,
    advance(milliseconds: number) { elapsed += milliseconds; } };
}

test('viewport HTTP preserves available, failed, uncovered and absent-producer states independently', async () => {
  const f = publishedFixture({ unavailableTraffic: true });
  const server = createMapHttpServer({ service: f.service, allowedOrigins: [] });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const result = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/v1/map/viewport`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...request, layers: ['planning', 'disruption', 'event', 'anomaly'] }),
    });
    assert.equal(result.status, 200);
    const body = await result.json() as ViewportResponse;
    assert.equal(body.dataMode, 'live');
    assert.deepEqual(body.layers.map((layer) => layer.state), ['available', 'unavailable', 'notCovered', 'unavailable']);
    assert.equal(body.layers[0]!.items.length, 2);
    assert.equal(body.layers[1]!.completeness, 'partial');
    assert.equal(body.layers[1]!.totalMatching, null);
    assert.equal(body.layers[2]!.totalMatching, null);
    assert.equal(JSON.stringify(body).includes('Private backend diagnostic'), false);
    assert.equal(body.layers[0]!.updatedAt, timestamp);
    assert.equal(body.layers[0]!.items[0]!.time.validFrom, '2026-10-01T00:00:00.000001Z');
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('complete empty drawable query remains unknown when unresolved records have no exact proof', async () => {
  const f = publishedFixture({ rows: [] });
  const body = await f.service.queryViewport(request);
  const layer = body.layers[0]!;
  assert.equal(layer.coverage.state, 'verified');
  assert.equal(layer.completeness, 'complete');
  assert.equal(layer.state, 'unknown');
  assert.equal(layer.unresolvedCount, null);
  assert.equal(layer.totalMatching, null);
  assert.equal(layer.nextCursor, null);
});

test('bounded partial drawable results never invent a full-query total', async () => {
  const f = publishedFixture({ partial: true });
  const body = await f.service.queryViewport({ ...request, layers: ['planning', 'event'] });
  assert.equal(body.layers[0]!.state, 'available');
  assert.equal(body.layers[0]!.items.length, 2);
  assert.equal(body.layers[0]!.completeness, 'partial');
  assert.equal(body.layers[0]!.totalMatching, null);
  assert.equal(body.layers[1]!.state, 'notCovered');
});

test('unlocated list retains missing and measured-zero counts without assigning coordinates or clocks', async () => {
  const f = publishedFixture({ independentPedestrianRights: true });
  const { bbox: _bbox, zoom: _zoom, ...context } = request;
  const body = await f.service.queryUnlocated({ ...context, layers: ['pedestrian'],
    scope: { sourceJurisdiction: 'acceptance-jurisdiction' } });
  assert.equal(body.dataMode, 'live');
  assert.equal(body.totalMatching, 2);
  assert.equal(body.completeness, 'complete');
  assert.equal(f.rightsChecks.length, 1);
  assert.deepEqual(f.rightsChecks[0]!.map((item) => item.id).sort(), body.items.map((item) => item.id).sort());
  const counts = body.items.map((item) => {
    assert.equal(item.kind, 'pedestrian');
    if (item.kind !== 'pedestrian') throw new Error('Expected a typed pedestrian item.');
    assert.equal(item.geometry, null);
    assert.equal(item.location.precision, 'unlocated');
    assert.equal(item.details.locationStatus, 'unlocated');
    assert.equal(item.time.observedAt, '2026-10-01T00:59:00.000001Z');
    assert.equal(item.time.reportedAt, null);
    return item.details.totalCount;
  });
  assert.ok(counts.includes(null));
  assert.ok(counts.includes(0));
  const query = f.queries.find((query) => query.query.includes('p.geometry IS NULL'))!;
  assert.ok(query);
  assert.deepEqual(JSON.parse(String(query.params.sourceIdsJson)), ['acceptance.pedestrian']);
});

test('current and historical contexts retain eligible lifecycle and source-time distinctions', async () => {
  const unknown = { ...planning('acceptance:unknown-clock'), valid_from: null };
  const f = publishedFixture({ rows: [planning('acceptance:active'), planning('acceptance:resolved', 'resolved'),
    planning('acceptance:cancelled', 'cancelled'), planning('acceptance:withdrawn', 'withdrawn'), unknown] });
  const current = await f.service.queryViewport(request);
  assert.deepEqual(current.layers[0]!.items.map((item) => item.id), ['acceptance:active', 'acceptance:unknown-clock']);
  assert.equal(current.layers[0]!.items[1]!.time.validFrom, null);
  assert.equal(current.layers[0]!.items[1]!.time.observedAt, null);
  const historical = await f.service.queryViewport({ ...request, requestId: 'acceptance-replay', mode: 'historical' });
  assert.equal(historical.mode, 'historical');
  assert.deepEqual(historical.layers[0]!.items.map((item) => item.lifecycle).sort(), ['active', 'cancelled', 'resolved']);
  assert.ok(!historical.layers[0]!.items.some((item) => item.id === 'acceptance:withdrawn'));
});

test('record removal with unchanged public-source watermark invalidates both detail and continuation', async () => {
  const f = publishedFixture();
  const first = await f.service.queryViewport({ ...request, pageSize: 1 });
  const item = first.layers[0]!.items[0]!;
  assert.ok(first.layers[0]!.nextCursor);
  assert.equal((await f.service.getItem(item.id, { requestId: 'public-detail', snapshotId: first.snapshotId })).item.id, item.id);
  f.rows.splice(0, 1);
  const unavailable = (error: unknown) => error instanceof MapServiceError && error.code === 'notAvailable';
  // A proof stands for one minute within the same publication, then the record's rights are read again.
  assert.equal((await f.service.getItem(item.id, { requestId: 'cached-detail', snapshotId: first.snapshotId })).item.id, item.id);
  f.advance(VERIFIED_RECORD_TTL_MS + 1);
  await assert.rejects(f.service.getItem(item.id, { requestId: 'removed-detail', snapshotId: first.snapshotId }), unavailable);
  await assert.rejects(f.service.queryViewport({ ...request, pageSize: 1, snapshotId: first.snapshotId,
    cursor: first.layers[0]!.nextCursor }), unavailable);
  assert.equal(f.sources[0]!.latest_published_batch_id, 'acceptance-batch');
});

test('same-publication content changes cannot be served from an immutable unlocated snapshot', async () => {
  const f = publishedFixture({ independentPedestrianRights: true });
  const { bbox: _bbox, zoom: _zoom, ...context } = request;
  const query = { ...context, pageSize: 1, layers: ['pedestrian'],
    scope: { sourceJurisdiction: 'acceptance-jurisdiction' } };
  const first = await f.service.queryUnlocated(query);
  assert.ok(first.nextCursor);
  assert.equal(f.rightsChecks.length, 1);
  f.unlocated[0]!.total_count = 99;
  await assert.rejects(f.service.queryUnlocated({ ...query, snapshotId: first.snapshotId, cursor: first.nextCursor }),
    (error: unknown) => error instanceof MapServiceError && error.code === 'notAvailable');
  assert.equal(f.rightsChecks.length, 2);
});

test('older boundary and pedestrian views fail closed when latest-record permission evidence is absent', async () => {
  const f = publishedFixture({ productionAggregation: true });
  assert.equal(f.boundaries.length, 1);
  assert.equal(f.unlocated.length, 2);
  for (const row of [...f.boundaries, ...f.unlocated]) delete row.rights_evidence;
  const body = await f.service.queryViewport({ ...request, layers: ['boundary', 'pedestrian'],
    boundaryFilter: { level: 'LGA', vintage: '2021' } });
  for (const layer of body.layers) {
    assert.equal(layer.state, 'unavailable');
    assert.equal(layer.completeness, 'partial');
    assert.equal(layer.totalMatching, null);
    assert.equal(layer.items.length, 0);
  }
  const { bbox: _bbox, zoom: _zoom, ...context } = request;
  await assert.rejects(f.service.queryUnlocated({ ...context, layers: ['pedestrian'],
    scope: { sourceJurisdiction: 'acceptance-jurisdiction' } }),
  (error: unknown) => error instanceof MapServiceError && error.code === 'serviceUnavailable');
  assert.equal(f.rightsChecks.length, 0);
  assert.ok(f.queries.some((query) => query.query.includes('v_boundaries')));
});

test('independent pedestrian rights revocation blocks detail and paging while public view rows remain unchanged', async () => {
  const f = publishedFixture({ independentPedestrianRights: true });
  const { bbox: _bbox, zoom: _zoom, ...context } = request;
  const query = { ...context, pageSize: 1, layers: ['pedestrian'],
    scope: { sourceJurisdiction: 'acceptance-jurisdiction' } };
  const first = await f.service.queryUnlocated(query);
  const item = first.items[0]!;
  assert.equal(item.kind, 'pedestrian');
  if (item.kind !== 'pedestrian') throw new Error('Expected a typed pedestrian item.');
  assert.equal(f.rightsChecks.length, 1);
  assert.ok(first.nextCursor);
  const originalRows = JSON.stringify(f.unlocated);
  f.rights.delete(pedestrianRight(item));
  const unavailable = (error: unknown) => error instanceof MapServiceError && error.code === 'notAvailable';
  await assert.rejects(f.service.getItem(item.id, { requestId: 'revoked-pedestrian', snapshotId: first.snapshotId }), unavailable);
  await assert.rejects(f.service.queryUnlocated({ ...query, snapshotId: first.snapshotId, cursor: first.nextCursor }), unavailable);
  assert.equal(f.rightsChecks.length, 3);
  assert.equal(JSON.stringify(f.unlocated), originalRows);
  assert.equal(f.sources[2]!.latest_published_batch_id, 'acceptance-batch');
});

test('permission-checked boundary and pedestrian views work without a supplemental verifier', async () => {
  const f = publishedFixture();
  const boundary = await f.service.queryViewport({ ...request, layers: ['boundary'],
    boundaryFilter: { level: 'LGA', vintage: '2021' } });
  assert.equal(boundary.layers[0]?.state, 'available');
  assert.equal(boundary.layers[0]?.items[0]?.kind, 'boundary');
  const { bbox: _bbox, zoom: _zoom, ...context } = request;
  const pedestrians = await f.service.queryUnlocated({ ...context, layers: ['pedestrian'],
    scope: { sourceJurisdiction: 'acceptance-jurisdiction' } });
  assert.equal(pedestrians.items.length, 2);
  assert.equal(f.rightsChecks.length, 0);
});

test('default pedestrian snapshots recheck record withdrawal with an unchanged source publication watermark', async () => {
  const f = publishedFixture();
  const { bbox: _bbox, zoom: _zoom, ...context } = request;
  const query = { ...context, pageSize: 1, layers: ['pedestrian'],
    scope: { sourceJurisdiction: 'acceptance-jurisdiction' } };
  const first = await f.service.queryUnlocated(query);
  const item = first.items[0]!;
  assert.ok(first.nextCursor);
  const stillPublic = f.unlocated.filter((row) => row.sensor_id !== (item.kind === 'pedestrian' ? item.details.sensorId : null));
  f.unlocated.splice(0, f.unlocated.length, ...stillPublic);
  const unavailable = (error: unknown) => error instanceof MapServiceError && error.code === 'notAvailable';
  await assert.rejects(f.service.getItem(item.id, { requestId: 'withdrawn-pedestrian', snapshotId: first.snapshotId }), unavailable);
  await assert.rejects(f.service.queryUnlocated({ ...query, snapshotId: first.snapshotId, cursor: first.nextCursor }), unavailable);
  assert.equal(f.sources.find((source) => source.source_id === 'acceptance.pedestrian')?.latest_published_batch_id, 'acceptance-batch');
});
