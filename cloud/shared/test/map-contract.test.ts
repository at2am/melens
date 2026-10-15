import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  MapContractError, MAX_REQUEST_BYTES, MAX_RESPONSE_BYTES, SERVICE_BBOX,
  REGISTERED_LAYER_COUNT, areaFilterSchema, bboxSchema, cursorBindingSchema, errorResponseSchema, geometrySchema, layerIdSchema,
  mapItemSchema, mapReadContextSchema, normalizedViewportIdentity, parseMapItem,
  parseMapItemPage, parseMapItemResponse, parseMapLayerCatalog, parseViewportQuery,
  parseViewportQueryJson, parseViewportResponse, snapshotBindingSchema, unlocatedQuerySchema,
  validateSnapshotCursor,
} from '../src/contracts/map-contract.js';
import type { CursorBinding, MapItem, SnapshotBinding, SnapshotCursorResolvers, ViewportQuery } from '../src/contracts/map-contract.js';

function fixture(name: string): unknown {
  const file = new URL(`../../../../specs/002-map-data-presentation/contracts/examples/${name}.sample.json`, import.meta.url);
  const value: unknown = JSON.parse(readFileSync(file, 'utf8'));
  return value;
}

function request(): ViewportQuery {
  return parseViewportQuery(fixture('viewport-query'));
}

function sensor(): Extract<MapItem, { kind: 'pedestrian' }> {
  const response = parseViewportResponse(fixture('viewport'));
  const item = response.layers.flatMap((layer) => layer.items).find((item) => item.kind === 'pedestrian');
  assert.ok(item);
  return item;
}

test('all seven frozen viewport envelopes parse with source/time and measured zero preserved', () => {
  for (const name of ['viewport', 'partial', 'no-matching', 'not-covered', 'unavailable', 'unknown', 'historical']) {
    const response = parseViewportResponse(fixture(name));
    assert.equal(response.schemaVersion, 1);
    assert.equal(response.dataMode, 'sample');
  }
  const response = parseViewportResponse(fixture('viewport'));
  const firstLayer = response.layers.at(0);
  assert.ok(firstLayer);
  assert.equal(firstLayer.totalMatching, 2);
  assert.equal(firstLayer.unresolvedCount, 1);
  const zero = firstLayer.items.find((item) => item.kind === 'pedestrian' && item.details.totalCount === 0);
  assert.ok(zero);
  assert.equal(zero.time.sourceTimezone, null);
});

test('catalog, detail, ten variants and scoped list/member envelopes agree with frozen examples', () => {
  assert.equal(parseMapLayerCatalog(fixture('catalog')).layers.length, 10);
  assert.equal(parseMapItemResponse(fixture('item')).item.kind, 'pedestrian');
  const unlocated = parseMapItemPage(fixture('unlocated'));
  const missingSensor = unlocated.items.at(0);
  assert.ok(missingSensor);
  assert.equal(missingSensor.geometry, null);
  assert.equal(missingSensor.kind, 'pedestrian');
  if (missingSensor.kind === 'pedestrian') assert.equal(missingSensor.details.totalCount, null);
  assert.equal(parseMapItemPage(fixture('members')).items.length, 2);
  const variants = fixture('item-variants');
  assert.ok(Array.isArray(variants));
  assert.deepEqual(variants.map((value: unknown) => parseMapItem(value).kind),
    ['pedestrian', 'anomaly', 'disruption', 'event', 'planning', 'parking', 'boundary', 'news', 'areaIndicator',
      'aggregate']);
  const error = errorResponseSchema.parse(fixture('error'));
  assert.equal(error.error.requestId, 'sample-request');
  assert.equal(errorResponseSchema.parse({ ...error, error: { ...error.error, requestId: null } }).error.requestId, null);
});

test('request identity, layers, coordinates, finite zoom and current/historical are bounded', () => {
  const base = request();
  for (const changes of [
    { requestId: '' }, { requestId: 'has space' }, { requestId: ' '.repeat(2) },
    { layers: [] }, { layers: ['pedestrian', 'pedestrian'] }, { layers: ['telepathy'] },
    { zoom: Number.NaN }, { zoom: Number.POSITIVE_INFINITY }, { zoom: -0.1 }, { zoom: 22.1 },
    { mode: 'realtime' }, { bbox: [-37.8, 144.9, -37.7, 145] },
    { bbox: [144, -39, 146.5001, -37] }, { bbox: [145, -38, 144, -37] },
    { bbox: [144, -37, 145, -38] }, { bbox: [144, -38, 144, -37] },
    { sql: 'SELECT * FROM staging' }, { dataMode: 'sample' },
  ]) assert.throws(() => parseViewportQuery({ ...base, ...changes }));
  assert.deepEqual(parseViewportQuery({ ...base, bbox: SERVICE_BBOX, zoom: 22, mode: 'historical' }).bbox, SERVICE_BBOX);
  assert.equal(parseViewportQuery({ ...base, zoom: 0 }).zoom, 0);
});

// `parking` is a registered v1 layer (UC-15). An earlier revision of this test rejected it as an
// unregistered id; do not reintroduce that, or the live parking layer stops working.
test('parking is a registered layer and the contract counts ten layers', () => {
  const base = request();
  assert.deepEqual(parseViewportQuery({ ...base, layers: ['parking'] }).layers, ['parking']);
  assert.equal(layerIdSchema.options.length, REGISTERED_LAYER_COUNT);
  assert.equal(REGISTERED_LAYER_COUNT, 10);
  assert.ok(layerIdSchema.options.includes('parking'));
});

test('a parking item is drawable only as a sensor point and never claims legal parking', () => {
  const variants = fixture('item-variants');
  assert.ok(Array.isArray(variants));
  const item = parseMapItem(variants.find((value: { kind?: string }) => value.kind === 'parking'));
  assert.equal(item.kind, 'parking');
  if (item.kind !== 'parking') return;
  const raw = JSON.parse(JSON.stringify(item)) as Record<string, any>;
  const rejects = (change: (copy: Record<string, any>) => void, why: string) => {
    const copy = JSON.parse(JSON.stringify(raw)) as Record<string, any>;
    change(copy);
    assert.throws(() => parseMapItem(copy), Error, why);
  };
  rejects(copy => { copy.details.legalParking = 'yes'; }, 'legal permission is never claimed');
  rejects(copy => { copy.geometry = null; copy.location = { precision: 'unlocated', role: 'unknown', evidence: null }; },
    'an unlocated sensor cannot be a parking item');
  rejects(copy => { copy.geometry = { type: 'Polygon', coordinates: [[[144, -37], [145, -37], [145, -38], [144, -37]]] };
    copy.location.precision = 'area'; }, 'a sensor is drawn only as its point');
  rejects(copy => { copy.details.state = 'noData'; copy.details.noDataReason = null; }, 'noData needs a reason');
  rejects(copy => { copy.details.noDataReason = 'notReporting'; }, 'only noData carries a reason');
  rejects(copy => { copy.details.reading = 'stale'; }, 'a stale reading cannot be drawn as vacant');
  rejects(copy => { copy.details.reading = 'unknown'; copy.details.state = 'occupied'; }, 'an unknown reading cannot be occupied');
  const silent = JSON.parse(JSON.stringify(raw)) as Record<string, any>;
  silent.details.state = 'noData'; silent.details.noDataReason = 'notReporting'; silent.details.reading = 'stale';
  assert.equal(parseMapItem(silent).kind, 'parking', 'a sensor that stopped reporting is a valid noData item');
});

test('request windows use true UTC ordered half-open intervals and exactly 31 days is permitted', () => {
  const base = request();
  for (const window of [
    { from: '2026-01-01T00:00:00+00:00', to: '2026-01-02T00:00:00Z' },
    { from: '2026-01-01T00:00:00', to: '2026-01-02T00:00:00Z' },
    { from: '2026-01-01', to: '2026-01-02' },
    { from: '2026-02-30T00:00:00Z', to: '2026-03-02T00:00:00Z' },
    { from: '2026-01-01T00:00:00Z', to: '2026-01-01T00:00:00Z' },
    { from: '2026-01-02T00:00:00Z', to: '2026-01-01T00:00:00Z' },
    { from: '2026-01-01T00:00:00Z', to: '2026-02-01T00:00:00.001Z' },
    { from: '2026-01-01T00:00:00Z', to: '2026-02-01T00:00:00.000001Z' },
    { from: '2026-01-01T00:00:00.0000001Z', to: '2026-01-02T00:00:00Z' },
  ]) assert.throws(() => parseViewportQuery({ ...base, window }));
  assert.equal(parseViewportQuery({ ...base, window: { from: '2026-01-01T00:00:00Z', to: '2026-02-01T00:00:00Z' } }).window.to,
    '2026-02-01T00:00:00Z');
  assert.equal(parseViewportQuery({ ...base, window: { from: '2026-01-01T00:00:00.000001Z', to: '2026-01-01T00:00:00.000002Z' } }).window.from,
    '2026-01-01T00:00:00.000001Z');
});

test('statistical filters preserve longer date-only periods; boundary filters require one known geography vintage', () => {
  const base = request();
  const areaFilter = {
    indicatorId: 'weeklyRent', periodId: '2025Q3', propertyType: 'all', boundaryVintage: '2021',
    periodStart: '2025-07-01', periodEnd: '2025-10-01',
  };
  assert.equal(parseViewportQuery({ ...base, layers: ['rent'], areaFilter }).areaFilter?.periodStart, '2025-07-01');
  assert.throws(() => parseViewportQuery({ ...base, layers: ['rent'], areaFilter: null }));
  assert.throws(() => parseViewportQuery({ ...base, layers: ['census'], areaFilter: undefined }));
  assert.throws(() => areaFilterSchema.parse({ ...areaFilter, periodEnd: '2025-07-01' }));
  assert.throws(() => areaFilterSchema.parse({ ...areaFilter, periodStart: '2025-02-30' }));
  assert.throws(() => areaFilterSchema.parse({ ...areaFilter, periodStart: '2025-07-01T00:00:00Z' }));
  assert.throws(() => parseViewportQuery({ ...base, layers: ['boundary'], boundaryFilter: null }));
  assert.throws(() => parseViewportQuery({ ...base, layers: ['boundary'], boundaryFilter: { level: 'suburb', vintage: '2021' } }));
  assert.equal(parseViewportQuery({ ...base, layers: ['boundary'], boundaryFilter: { level: 'LGA', vintage: '2021' } }).boundaryFilter?.level, 'LGA');
});

test('GeoJSON supports six valid 2D geometry variants without transposed coordinates or unclosed rings', () => {
  const points = [[144.9, -37.8], [144.95, -37.8], [144.95, -37.85], [144.9, -37.8]];
  for (const geometry of [
    { type: 'Point', coordinates: points[0] }, { type: 'MultiPoint', coordinates: points },
    { type: 'LineString', coordinates: points }, { type: 'MultiLineString', coordinates: [points] },
    { type: 'Polygon', coordinates: [points] }, { type: 'MultiPolygon', coordinates: [[points]] },
  ]) assert.ok(geometrySchema.safeParse(geometry).success);
  for (const geometry of [
    { type: 'Point', coordinates: [-37.8, 144.9] }, { type: 'Point', coordinates: [144.9, -37.8, 3] },
    { type: 'Point', coordinates: [Number.NaN, -37.8] }, { type: 'LineString', coordinates: [[144.9, -37.8]] },
    { type: 'Polygon', coordinates: [[...points.slice(0, 3), [144.8, -37.8]]] },
    { type: 'GeometryCollection', geometries: [] },
  ]) assert.equal(geometrySchema.safeParse(geometry).success, false);
  assert.throws(() => bboxSchema.parse([144, -39, 146.6, -37]));
  assert.throws(() => parseMapItem({ ...sensor(), geometryPresentation: { simplified: true, originalPrecision: 'line', toleranceMeters: 2 } }));
  assert.throws(() => parseMapItem({ ...sensor(), geometryPresentation: { simplified: true, originalPrecision: 'point', toleranceMeters: null } }));
});

test('missing counts remain null; malformed sums and ineffective sensor locations are rejected', () => {
  const base = sensor();
  assert.equal(parseMapItem({ ...base, details: { ...base.details, totalCount: 0, directionACount: 0, directionBCount: 0 } }).kind, 'pedestrian');
  assert.throws(() => parseMapItem({ ...base, details: { ...base.details, totalCount: 7, directionACount: 3, directionBCount: 5 } }));
  assert.throws(() => parseMapItem({ ...base, details: { ...base.details, totalCount: -1 } }));
  assert.throws(() => parseMapItem({ ...base, geometry: null }));
  assert.throws(() => parseMapItem({ ...base, details: { ...base.details, locationStatus: 'ambiguous' } }));
  assert.throws(() => parseMapItem({ ...base, details: { ...base.details, locationValidFrom: base.details.window.to } }));
  assert.throws(() => parseMapItem({ ...base, details: { ...base.details, locationValidTo: base.details.window.from } }));
});

test('noMatching requires verified area/time coverage, complete query and exact empty totals', () => {
  const base = parseViewportResponse(fixture('no-matching'));
  const layer = base.layers.at(0);
  assert.ok(layer);
  for (const changes of [
    { completeness: 'partial' }, { totalMatching: null }, { totalMatching: 1 },
    { unresolvedCount: null }, { unresolvedCount: 1 }, { nextCursor: 'next' }, { items: [sensor()] },
    { coverage: { ...layer.coverage, state: 'unknown' } },
    { coverage: { ...layer.coverage, areaRefs: [] } },
    { coverage: { ...layer.coverage, evidenceSourceIds: [] } },
    { coverage: { ...layer.coverage, window: null } },
  ]) assert.throws(() => parseViewportResponse({ ...base, layers: [{ ...layer, ...changes }] }));
  const narrow = { ...layer.coverage, window: { from: '2026-10-01T00:59:30Z', to: '2026-10-01T01:00:00Z' } };
  assert.throws(() => parseViewportResponse({ ...base, requestId: request().requestId, layers: [{ ...layer, coverage: narrow }] }, { expectedRequest: request() }));
});

test('response identity, partial totals, pagination and live/sample flags remain truthful', () => {
  const base = parseViewportResponse(fixture('viewport'));
  const layer = base.layers.at(0);
  assert.ok(layer);
  assert.throws(() => parseViewportResponse(base, { production: true }));
  assert.throws(() => parseMapLayerCatalog(fixture('catalog'), { production: true }));
  assert.throws(() => parseMapItemResponse(fixture('item'), { production: true }));
  assert.throws(() => parseMapItemPage(fixture('unlocated'), { production: true }));
  assert.equal(parseViewportResponse({ ...base, dataMode: 'live' }, { production: true }).dataMode, 'live');
  assert.throws(() => parseViewportResponse({ ...base, schemaVersion: 2 }));
  assert.throws(() => parseViewportResponse({ ...base, layers: [layer, layer] }));
  assert.throws(() => parseViewportResponse({ ...base, layers: [{ ...layer, totalMatching: 1 }] }));
  assert.throws(() => parseViewportResponse({ ...base, layers: [{ ...layer, items: [], totalMatching: null }] }));
  assert.throws(() => parseViewportResponse({ ...base, layers: [{ ...layer, state: 'notCovered', items: [], totalMatching: null }] }));
  assert.throws(() => parseViewportResponse({ ...base, layers: [{ ...layer, nextCursor: 'cursor' }] }));
  assert.throws(() => parseViewportResponse({ ...base, layers: [{ ...layer, items: [...layer.items].reverse() }] }));
  assert.throws(() => parseViewportResponse({ ...base, layers: [{ ...layer, items: [sensor(), sensor()] }] }));
  assert.throws(() => parseViewportResponse(base, { expectedRequest: { ...request(), requestId: 'different' } }));
  assert.throws(() => parseViewportResponse(base, { expectedRequest: { ...request(), mode: 'historical' } }));
  assert.throws(() => parseViewportResponse(base, { expectedRequest: { ...request(), requestId: base.requestId, cursor: 'cursor.A', snapshotId: 'different.snapshot' } }));
  assert.throws(() => parseViewportResponse({ ...base, layers: [{ ...layer, items: Array.from({ length: 1_001 }, (_, index) => ({ ...sensor(), id: `sensor.${String(index).padStart(4, '0')}` })) }] }));
  const values = fixture('item-variants');
  assert.ok(Array.isArray(values));
  const planning = values.map((value: unknown) => parseMapItem(value)).find((item) => item.kind === 'planning');
  assert.ok(planning);
  const pedestrianItems = Array.from({ length: 600 }, (_, index) => ({ ...sensor(), id: `sensor.${String(index).padStart(4, '0')}` }));
  const planningItems = Array.from({ length: 600 }, (_, index) => ({ ...planning, id: `planning.${String(index).padStart(4, '0')}` }));
  assert.throws(() => parseViewportResponse({ ...base, layers: [
    { ...layer, completeness: 'partial', items: pedestrianItems, totalMatching: null },
    { ...layer, layerId: 'planning', completeness: 'partial', items: planningItems, totalMatching: null },
  ] }));
  const added = parseViewportResponse({ ...base, futureOptionalField: 'allowed' });
  assert.equal(added.schemaVersion, 1);
});

test('request and uncompressed response budgets include raw UTF-8 bytes and reject malformed UTF-8', () => {
  const base = request();
  assert.equal(parseViewportQueryJson(JSON.stringify(base)).requestId, base.requestId);
  assert.throws(() => parseViewportQueryJson(`${' '.repeat(MAX_REQUEST_BYTES)}${JSON.stringify(base)}`));
  assert.throws(() => parseViewportQueryJson(Uint8Array.from([123, 34, 255, 34, 58, 49, 125])));
  assert.throws(() => parseViewportResponse({ ...parseViewportResponse(fixture('viewport')), largeOptionalField: 'x'.repeat(MAX_RESPONSE_BYTES) }));
});

test('scoped lists reject invented locations and duplicate/ambiguous scope; unknown request fields are rejected', () => {
  const page = parseMapItemPage(fixture('unlocated'));
  const item = page.items.at(0);
  assert.ok(item);
  assert.throws(() => parseMapItemPage({ ...page, scope: { kind: 'unlocated', areaRefs: [], sourceJurisdiction: null } }));
  assert.throws(() => parseMapItemPage({ ...page, items: [{ ...item, geometry: { type: 'Point', coordinates: [144.96, -37.81] } }] }));
  const base = request();
  assert.ok(unlocatedQuerySchema.safeParse({ requestId: base.requestId, layers: base.layers, mode: base.mode, window: base.window, scope: { sourceJurisdiction: 'City of Melbourne' } }).success);
  assert.equal(unlocatedQuerySchema.safeParse({ requestId: base.requestId, layers: base.layers, mode: base.mode, window: base.window, scope: { areaRefs: ['lga.A'], sourceJurisdiction: 'Melbourne' } }).success, false);
  assert.equal(mapReadContextSchema.safeParse({ requestId: 'read', snapshotId: 'snapshot', rawSql: 'SELECT 1' }).success, false);
});

function cursorContext() {
  const original = parseViewportQuery({ ...request(), layers: ['pedestrian', 'event'] });
  const continuation = parseViewportQuery({ ...original, layers: ['pedestrian'], requestId: 'new-id', cursor: 'cursor.A', snapshotId: 'snapshot.A' });
  const snapshot: SnapshotBinding = {
    id: 'snapshot.A', queryFamily: 'viewport', queryIdentity: normalizedViewportIdentity(original), selectedLayers: ['pedestrian', 'event'],
    sourceVersionWatermark: 'published.batch.A', publicSourceIds: ['public.source.A'],
    createdAt: '2026-10-01T01:00:00Z', expiresAt: '2026-10-01T01:05:00Z',
  };
  const cursor: CursorBinding = {
    id: 'cursor.A', queryFamily: 'viewport', snapshotId: snapshot.id, queryIdentity: snapshot.queryIdentity,
    layerId: 'pedestrian', sourceVersionWatermark: snapshot.sourceVersionWatermark,
    after: { id: 'item.A', versionId: 'version.A' },
  };
  const resolvers: SnapshotCursorResolvers = {
    resolveSnapshot: async (id) => id === snapshot.id ? snapshot : null,
    resolveCursor: async (id) => id === cursor.id ? cursor : null,
    isStillPublic: async () => true,
  };
  const now = new Date('2026-10-01T01:01:00Z');
  return { original, continuation, snapshot, cursor, resolvers, now };
}

test('opaque cursor validation binds normalized query, originally selected layer and published source watermark', async () => {
  const { original, continuation, snapshot, cursor, resolvers, now } = cursorContext();
  assert.equal(normalizedViewportIdentity(original), normalizedViewportIdentity(continuation));
  assert.equal(normalizedViewportIdentity(original), normalizedViewportIdentity({ ...original, window: { from: `${original.window.from.slice(0, -1)}.000Z`, to: `${original.window.to.slice(0, -1)}.000Z` } }));
  assert.notEqual(normalizedViewportIdentity(original), normalizedViewportIdentity({ ...original, window: { from: `${original.window.from.slice(0, -1)}.000001Z`, to: original.window.to } }));
  assert.equal(normalizedViewportIdentity(original), normalizedViewportIdentity({ ...original, pageSize: 1_000, areaFilter: null, boundaryFilter: null }));
  assert.equal(await validateSnapshotCursor({ request: original, resolvers, now }), null);
  assert.deepEqual(await validateSnapshotCursor({ request: continuation, resolvers, now }), { snapshot, cursor });
  for (const changes of [{ bbox: [144.8, -38, 145, -37.5] }, { zoom: 12 }, { mode: 'historical' }, { pageSize: 500 }, { layers: ['event'] }]) {
    const modified = parseViewportQuery({ ...continuation, ...changes });
    await assert.rejects(validateSnapshotCursor({ request: modified, resolvers, now }), (error: unknown) => error instanceof MapContractError && error.code === 'cursorMismatch');
  }
  await assert.rejects(validateSnapshotCursor({ request: continuation, resolvers: { ...resolvers, resolveCursor: async () => ({ ...cursor, sourceVersionWatermark: 'different.batch' }) }, now }),
    (error: unknown) => error instanceof MapContractError && error.code === 'cursorMismatch');
  await assert.rejects(validateSnapshotCursor({ request: { ...continuation, cursor: 'fabricated' }, resolvers, now }),
    (error: unknown) => error instanceof MapContractError && error.code === 'cursorMismatch');
  await assert.rejects(validateSnapshotCursor({ request: continuation, resolvers: { ...resolvers, resolveCursor: async () => ({ ...cursor, queryFamily: 'unlocated' }) }, now }),
    (error: unknown) => error instanceof MapContractError && error.code === 'cursorMismatch');
  assert.throws(() => parseViewportQuery({ ...original, cursor: 'cursor.A' }));
  assert.throws(() => parseViewportQuery({ ...original, cursor: 'cursor.A', snapshotId: 'snapshot.A' }));
});

test('snapshots expire at five minutes and publication retraction cannot be bypassed', async () => {
  const { continuation, snapshot, resolvers, now } = cursorContext();
  await assert.rejects(validateSnapshotCursor({ request: continuation, resolvers, now: new Date('2026-10-01T01:05:00Z') }),
    (error: unknown) => error instanceof MapContractError && error.code === 'snapshotExpired');
  await assert.rejects(validateSnapshotCursor({ request: continuation, resolvers: { ...resolvers, resolveSnapshot: async () => null }, now }),
    (error: unknown) => error instanceof MapContractError && error.code === 'snapshotExpired');
  await assert.rejects(validateSnapshotCursor({ request: continuation, resolvers: { ...resolvers, isStillPublic: async () => false }, now }),
    (error: unknown) => error instanceof MapContractError && error.code === 'notAvailable');
  assert.throws(() => snapshotBindingSchema.parse({ ...snapshot, expiresAt: '2026-10-01T01:05:00.001Z' }));
  assert.throws(() => cursorBindingSchema.parse({ id: 'arbitrary-token' }));
});

test('suppressed indicators and mention-only news cannot acquire fabricated values or geometry', () => {
  const values = fixture('item-variants');
  assert.ok(Array.isArray(values));
  const variants = values.map((value: unknown) => parseMapItem(value));
  const area = variants.find((item) => item.kind === 'areaIndicator');
  assert.ok(area);
  assert.throws(() => mapItemSchema.parse({ ...area, details: { ...area.details, valueState: 'suppressed', value: 0 } }));
  assert.throws(() => mapItemSchema.parse({ ...area, geometry: { type: 'Polygon', coordinates: [[[144.9, -37.8], [145, -37.8], [145, -37.9], [144.9, -37.8]]] }, location: { ...area.location, precision: 'area' } }));
  const news = variants.find((item) => item.kind === 'news');
  assert.ok(news);
  assert.throws(() => mapItemSchema.parse({ ...news, geometry: { type: 'Point', coordinates: [144.9, -37.8] }, location: { ...news.location, precision: 'point', role: 'mention' } }));
});
