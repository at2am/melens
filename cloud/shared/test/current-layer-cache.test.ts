import assert from 'node:assert/strict';
import test from 'node:test';

import { loadMapConfig } from '../src/config.js';
import type { PreparedViewQuery } from '../src/query/bigquery-adapter.js';
import { createCurrentLayerCache, instantMicros, prepareLayerLoad } from '../src/query/current-layer-cache.js';
import { intersectsBox, prepareGeometry } from '../src/query/geo-box.js';
import { MapQueryError, type ViewQueryResult } from '../src/query/query-runner.js';
import { cacheSourceCoverage, type PublicSourceCoverage, type SourceCoverageSnapshot } from '../src/query/source-coverage.js';

const config = loadMapConfig({ MAP_PROJECT_ID: 'melens-testing' });
const box = [144.95, -37.82, 144.97, -37.80] as const;
const request = {
  requestId: 'cache-test', bbox: [...box], zoom: 15, layers: ['planning'], mode: 'current',
  window: { from: '2026-10-15T00:00:00Z', to: '2026-10-16T00:00:00Z' },
};

test('box intersection matches ST_INTERSECTSBOX for points, crossing lines and enclosing polygons', () => {
  const point = (x: number, y: number) => prepareGeometry(JSON.stringify({ type: 'Point', coordinates: [x, y] }));
  assert.equal(intersectsBox(point(144.96, -37.81), box), true);
  assert.equal(intersectsBox(point(144.97, -37.80), box), true, 'the box edge is inside');
  assert.equal(intersectsBox(point(144.99, -37.81), box), false);
  // A line through the box with no vertex inside it.
  const crossing = prepareGeometry(JSON.stringify({ type: 'LineString', coordinates: [[144.90, -37.81], [145.00, -37.81]] }));
  assert.equal(intersectsBox(crossing, box), true);
  const beside = prepareGeometry(JSON.stringify({ type: 'LineString', coordinates: [[144.90, -37.70], [145.00, -37.70]] }));
  assert.equal(intersectsBox(beside, box), false);
  // A polygon that encloses the whole viewport, and the same polygon with the viewport in its hole.
  const outer = [[144.9, -37.9], [145.1, -37.9], [145.1, -37.7], [144.9, -37.7], [144.9, -37.9]];
  const hole = [[144.94, -37.83], [144.98, -37.83], [144.98, -37.79], [144.94, -37.79], [144.94, -37.83]];
  assert.equal(intersectsBox(prepareGeometry(JSON.stringify({ type: 'Polygon', coordinates: [outer] })), box), true);
  assert.equal(intersectsBox(prepareGeometry(JSON.stringify({ type: 'Polygon', coordinates: [outer, hole] })), box), false);
  assert.equal(intersectsBox(prepareGeometry(JSON.stringify({ type: 'MultiPolygon', coordinates: [[hole]] })), box), true);
  assert.throws(() => prepareGeometry(JSON.stringify({ type: 'Point', coordinates: ['x', 1] })));
});

test('a disruption load keeps live reports and works in progress ahead of pending works', () => {
  const load = prepareLayerLoad('disruption', config, 100);
  assert.match(load.query, /ORDER BY CASE WHEN g\.assertion_kind = 'report' THEN 0\s+WHEN g\.record_status = 'active' THEN 1 ELSE 2 END, g\.geo_record_id/);
  assert.match(prepareLayerLoad('planning', config, 100).query, /ORDER BY g\.geo_record_id, g\.version_id/);
});

test('instants keep BigQuery microseconds', () => {
  assert.equal(instantMicros('2026-10-15T00:00:00.000001Z')! - instantMicros('2026-10-15T00:00:00Z')!, 1);
  assert.equal(instantMicros(null), null);
  assert.throws(() => instantMicros('yesterday'));
});

function source(sourceId: string, topic: string, publishedBatchId: string | null): PublicSourceCoverage {
  return { sourceId, topic, scope: 'melbourne', coverageAreaRefs: ['lga:melbourne'], coverageFrom: '2026-10-01T00:00:00Z',
    coverageTo: null, licenseStatus: 'verified_open', accessStatus: 'active', admitted: true, healthState: 'current',
    publishedBatchId, publishedAt: publishedBatchId === null ? null : '2026-10-15T00:00:00Z', publishedWindow: null,
    publishedOutputCount: 1, evidenceState: 'verified' };
}
function geoRow(id: string, x: number, y: number, extra: Record<string, unknown> = {}) {
  return { geo_record_id: id, version_id: 'v1', source_id: 'planning.source', topic: 'planning', record_status: 'active',
    geometry_geojson: JSON.stringify({ type: 'Point', coordinates: [x, y] }), valid_from: null, observed_at: null,
    published_at: null, valid_to: null, ...extra };
}
const complete = (rows: readonly Record<string, unknown>[]): ViewQueryResult =>
  ({ kind: 'complete', rows: rows as never, totalMatching: rows.length, resultBytes: 2 });

function harness(options: { rows?: Record<string, unknown>[]; state?: Record<string, unknown>[]; partial?: boolean;
  partialState?: boolean; partialCoverage?: boolean } = {}) {
  let now = Date.parse('2026-10-15T01:00:00Z');
  let coverage: SourceCoverageSnapshot = { completeness: 'complete', sources: [source('planning.source', 'planning', 'batch-1')] };
  const rows = options.rows ?? [geoRow('planning:b', 144.96, -37.81), geoRow('planning:a', 144.96, -37.815),
    geoRow('planning:far', 145.5, -37.0), geoRow('planning:unlocated', 0, 0, { geometry_geojson: null })]
    .sort((a, b) => a.geo_record_id < b.geo_record_id ? -1 : 1);
  let state = options.state ?? [{ source_id: 'planning.source', batch_id: 'batch-1' }];
  const loads: PreparedViewQuery[] = [];
  const fallbacks: unknown[] = [];
  const publicRows: Record<string, unknown>[] = [];
  let fail = false;
  const runner = {
    async run(input: unknown) { fallbacks.push(input); return complete(publicRows); },
    async runPrepared(query: PreparedViewQuery) {
      loads.push(query);
      if (fail) throw new Error('BigQuery unavailable');
      if (query.query.includes('v_geo_records_current_state')) return options.partialState === true
        ? { ...complete(state), kind: 'partial' as const, totalMatching: null, reason: 'rowLimit' as const }
        : complete(state);
      return options.partial === true ? { kind: 'partial', rows: [], totalMatching: null, resultBytes: 2, reason: 'rowLimit' } as ViewQueryResult
        : complete(rows);
    },
  };
  const cache = createCurrentLayerCache({ config, runner, clock: () => new Date(now),
    readCoverage: async () => options.partialCoverage === true ? { ...coverage, completeness: 'partial' } : coverage });
  return { cache, loads, fallbacks, rows, publicRows,
    publish(batchId: string) { coverage = { ...coverage, sources: [source('planning.source', 'planning', batchId)] }; },
    reflect(batchId: string) { state = [{ source_id: 'planning.source', batch_id: batchId }]; },
    advance(ms: number) { now += ms; }, fail(value: boolean) { fail = value; } };
}
const viewport = (extra: Record<string, unknown> = {}) => ({ queryId: 'planning', request, publicSourceIds: ['planning.source'], ...extra });
const ids = (result: ViewQueryResult) => result.rows.map((row) => row.geo_record_id);

test('a layer loads once per publication and answers viewports from memory with the SQL order and filters', async () => {
  const h = harness();
  assert.deepEqual(ids(await h.cache.runQuery(viewport())), ['planning:a', 'planning:b']);
  assert.equal(h.loads.length, 2, 'the rows and the refresh state, together');
  assert.match(h.loads[0]!.query, /v_geo_records_current_served/);
  assert.match(h.loads[0]!.query, /g\.record_status IN \('active', 'planned'\)/);
  const smaller = await h.cache.runQuery(viewport({ request: { ...request, bbox: [144.955, -37.812, 144.965, -37.808] } }));
  assert.deepEqual(ids(smaller), ['planning:b']);
  assert.deepEqual(ids(await h.cache.runQuery(viewport({ publicSourceIds: ['other.source'] }))), [], 'only admitted sources');
  const one = await h.cache.runQuery(viewport({ request: { ...request, pageSize: 1 } }));
  assert.equal(one.kind, 'partial');
  assert.deepEqual(ids(one), ['planning:a']);
  assert.equal(h.loads.length, 2, 'no further BigQuery reads');
  assert.equal(h.fallbacks.length, 0);

  h.publish('batch-2'); h.reflect('batch-2');
  await h.cache.runQuery(viewport());
  assert.equal(h.loads.length, 4, 'a new publication reloads the layer');
});

test('a geo copy that lags the registry fails closed until the matching publication is reflected', async () => {
  const h = harness();
  h.publish('batch-2');
  const unavailable = (error: unknown) => error instanceof MapQueryError && error.code === 'serviceUnavailable';
  await assert.rejects(h.cache.runQuery(viewport()), unavailable);
  assert.equal(h.loads.length, 2);
  h.advance(5_000);
  await assert.rejects(h.cache.runQuery(viewport()), unavailable);
  assert.equal(h.loads.length, 4);
  assert.equal(h.fallbacks.length, 0, 'the same stale served view cannot prove the new publication');
  h.reflect('batch-2');
  assert.deepEqual(ids(await h.cache.runQuery(viewport())), ['planning:a', 'planning:b']);
  assert.equal(h.loads.length, 6);
  h.advance(60_000);
  await h.cache.runQuery(viewport());
  assert.equal(h.loads.length, 6, 'a current copy is kept');
  h.advance(60_000);
  await h.cache.runQuery(viewport());
  assert.equal(h.loads.length, 8, 'time-dependent display limits still expire after two minutes');
});

test('the time window follows the SQL current-mode rules', async () => {
  const h = harness({ rows: [
    geoRow('planning:ended', 144.96, -37.81, { valid_from: '2026-10-01T00:00:00Z', valid_to: '2026-10-15T00:00:00Z' }),
    geoRow('planning:open', 144.96, -37.81, { valid_from: '2026-10-01T00:00:00Z' }),
    geoRow('planning:later', 144.96, -37.81, { observed_at: '2026-10-16T00:00:00Z' }),
    geoRow('planning:unknown', 144.96, -37.81),
  ] });
  // Current planning is a whole snapshot, never windowed; events are.
  assert.deepEqual(ids(await h.cache.runQuery(viewport())).length, 4);
  const event = harness({ rows: [
    geoRow('event:ended', 144.96, -37.81, { topic: 'event', valid_from: '2026-10-01T00:00:00Z', valid_to: '2026-10-15T00:00:00Z' }),
    geoRow('event:open', 144.96, -37.81, { topic: 'event', valid_from: '2026-10-01T00:00:00Z' }),
    geoRow('event:later', 144.96, -37.81, { topic: 'event', observed_at: '2026-10-16T00:00:00Z' }),
    geoRow('event:unknown', 144.96, -37.81, { topic: 'event' }),
  ], state: [{ source_id: 'planning.source', batch_id: 'batch-1' }] });
  const result = await event.cache.runQuery({ queryId: 'event', request: { ...request, layers: ['event'] },
    publicSourceIds: ['planning.source'] });
  assert.deepEqual(ids(result), ['event:open', 'event:unknown']);
});

test('non-parking public-record checks observe same-publication withdrawal through the live runner', async () => {
  const h = harness();
  await h.cache.runQuery(viewport());
  h.publicRows.push(geoRow('planning:b', 144.96, -37.81));
  const proof = { family: 'publicRecords', queryId: 'planning', request,
    recordKeys: [{ id: 'planning:b', versionId: 'v1', sourceId: 'planning.source' }] };
  assert.deepEqual(ids(await h.cache.runQuery(proof)), ['planning:b']);
  h.publicRows.splice(0);
  assert.deepEqual(ids(await h.cache.runQuery(proof)), [], 'the warm display entry cannot grant a withdrawn record');
  assert.deepEqual(h.fallbacks, [proof, proof]);
  assert.equal(h.loads.length, 2);
});

test('everything the cache does not hold runs its fixed query', async () => {
  const h = harness();
  await h.cache.runQuery(viewport({ request: { ...request, mode: 'historical' } }));
  await h.cache.runQuery({ queryId: 'boundary', request: { ...request, layers: ['boundary'] }, publicSourceIds: [] });
  await h.cache.runQuery({ family: 'unlocated', queryId: 'planning', request, approvedScope: {} });
  await h.cache.runQuery({ family: 'publicRecords', queryId: 'news', request: { ...request, layers: ['news'] },
    recordKeys: [{ id: 'x', versionId: 'v', sourceId: 's' }] });
  await h.cache.runQuery(viewport({ publicSourceIds: undefined }));
  await h.cache.runQuery({ queryId: 'planning', request: { bbox: 'not a request' } });
  assert.equal(h.fallbacks.length, 6);
  assert.equal(h.loads.length, 0);
});

test('a layer too large to hold uses bounded SQL only after its publication state is verified', async () => {
  const large = harness({ partial: true });
  await large.cache.runQuery(viewport());
  await large.cache.runQuery(viewport());
  assert.equal(large.fallbacks.length, 2);
  assert.equal(large.loads.length, 2, 'a layer found too large is not reloaded for every request');
  const staleLarge = harness({ partial: true });
  staleLarge.publish('batch-2');
  await assert.rejects(staleLarge.cache.runQuery(viewport()),
    (error: unknown) => error instanceof MapQueryError && error.code === 'serviceUnavailable');
  assert.equal(staleLarge.fallbacks.length, 0);
});

test('failed or incomplete geo state cannot bind an unverified copy to a snapshot', async () => {
  const unavailable = (error: unknown) => error instanceof MapQueryError && error.code === 'serviceUnavailable';
  for (const h of [harness({ partialState: true }), harness({ partialCoverage: true })]) {
    await assert.rejects(h.cache.runQuery(viewport()), unavailable);
    assert.equal(h.fallbacks.length, 0);
  }
  const failing = harness();
  failing.fail(true);
  await assert.rejects(failing.cache.runQuery(viewport()), unavailable);
  assert.equal(failing.fallbacks.length, 0);
  failing.fail(false);
  assert.deepEqual(ids(await failing.cache.runQuery(viewport())), ['planning:a', 'planning:b'], 'a failure is not kept');
});

test('concurrent requests share one load', async () => {
  const h = harness();
  await Promise.all([h.cache.runQuery(viewport()), h.cache.runQuery(viewport()), h.cache.runQuery(viewport())]);
  assert.equal(h.loads.length, 2);
});

test('parking is current only when every row carries the published batch', async () => {
  let coverage: SourceCoverageSnapshot = { completeness: 'complete',
    sources: [source('melbourne.parking.sensors', 'parking', 'p-1')] };
  let batch = 'p-1';
  let loads = 0;
  let now = 0;
  const cache = createCurrentLayerCache({ config, clock: () => new Date(now), readCoverage: async () => coverage,
    runner: { async run() { throw new Error('unexpected'); }, async runPrepared(query) {
      loads += 1;
      assert.match(query.query, /v_parking_sensor_current/);
      return complete([{ sensor_id: 'kerbside:1', source_id: 'melbourne.parking.sensors', batch_id: batch, version_id: 'v',
        latitude: -37.81, longitude: 144.96 }, { sensor_id: 'kerbside:2', source_id: 'melbourne.parking.sensors',
        batch_id: batch, version_id: 'v', latitude: null, longitude: null }]);
    } } });
  const parking = { queryId: 'parking', request: { ...request, layers: ['parking'] }, publicSourceIds: ['melbourne.parking.sensors'] };
  assert.deepEqual((await cache.runQuery(parking)).rows.map((row) => row.sensor_id), ['kerbside:1']);
  coverage = { ...coverage, sources: [source('melbourne.parking.sensors', 'parking', 'p-2')] };
  await cache.runQuery(parking);
  assert.equal(loads, 2);
  await cache.runQuery(parking);
  assert.equal(loads, 2, 'the swap had not landed: kept for five seconds');
  now += 5_000; batch = 'p-2';
  await cache.runQuery(parking);
  now += 60_000;
  await cache.runQuery(parking);
  assert.equal(loads, 3);
  const checked = await cache.runQuery({ family: 'publicRecords', queryId: 'parking', request: parking.request,
    recordKeys: [{ id: 'x', versionId: 'v', sourceId: 'melbourne.parking.sensors', sensorId: 'kerbside:2' }] });
  assert.deepEqual(checked.rows.map((row) => row.sensor_id), ['kerbside:2']);
});

test('an expired registry read is served while one background read replaces it', async () => {
  let now = 0;
  let reads = 0;
  let release: (() => void) | null = null;
  const read = async () => {
    reads += 1;
    const value = reads;
    if (value === 2) await new Promise<void>((resolve) => { release = resolve; });
    return { completeness: 'complete', sources: [], value } as unknown as SourceCoverageSnapshot;
  };
  const cached = cacheSourceCoverage(read, { ttlMs: 30_000, staleMs: 120_000, clock: () => new Date(now) });
  const value = async () => (await cached(request as never) as unknown as { value: number }).value;
  assert.equal(await value(), 1);
  now += 30_000;
  assert.equal(await value(), 1, 'served at once');
  assert.equal(await value(), 1);
  assert.equal(reads, 2, 'one background read');
  release!();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(await value(), 2);
  now += 30_000 + 120_000;
  assert.equal(await value(), 3, 'past the stale window a request waits for a fresh read');
});

test('anomaly results are held per publication of the anomaly sources, in their SQL order', async () => {
  let coverage: SourceCoverageSnapshot = { completeness: 'complete', sources: [source('melens.anomaly.replay', 'anomaly', 'r-1')] };
  let loads = 0;
  const cache = createCurrentLayerCache({ config, readCoverage: async () => coverage,
    runner: { async run() { throw new Error('unexpected'); }, async runPrepared(query) {
      loads += 1;
      assert.match(query.query, /v_anomaly_current/);
      assert.match(query.query, /ORDER BY a\.window_to DESC, a\.result_id/);
      return complete([
        { result_id: 'anomaly:2', source_id: 'melens.anomaly.replay', batch_id: 'r-1', lat: -37.81, lon: 144.96 },
        { result_id: 'anomaly:1', source_id: 'melens.anomaly.replay', batch_id: 'r-1', lat: -37.81, lon: 144.96 },
        { result_id: 'anomaly:far', source_id: 'melens.anomaly.replay', batch_id: 'r-1', lat: -37.0, lon: 145.5 },
      ]);
    } } });
  const anomaly = { queryId: 'anomaly', request: { ...request, layers: ['anomaly'] }, publicSourceIds: ['melens.anomaly.replay'] };
  assert.deepEqual((await cache.runQuery(anomaly)).rows.map((row) => row.result_id), ['anomaly:2', 'anomaly:1']);
  await cache.runQuery(anomaly);
  assert.equal(loads, 1, 'the producer read and its recheck share one load');
  coverage = { ...coverage, sources: [source('melens.anomaly.replay', 'anomaly', 'r-2')] };
  await cache.runQuery(anomaly);
  assert.equal(loads, 2);
});
