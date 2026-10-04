import assert from 'node:assert/strict';
import test from 'node:test';

import { mapItemSchema } from '../src/contracts/map-contract.js';
import { MapAdapterError, comparePublishedInstants, offsetPublishedInstant,
  parsePublishedGeometry, publishedInstant, type PublicSourceReference }
  from '../src/query/adapter-common.js';
import { adaptBoundaryRow, adaptBoundaryRows } from '../src/query/boundaries.js';
import { adaptPlanningRow, adaptPlanningRows } from '../src/query/planning.js';
import type { ViewRow } from '../src/query/query-runner.js';

const planningSource: PublicSourceReference = {
  sourceId: 'melbourne.development_monitor', url: 'https://public.example/development',
  attribution: 'City of Melbourne Development Activity Monitor', versionRef: null,
};
const boundarySource: PublicSourceReference = {
  sourceId: 'melbourne.clue.blocks', url: 'https://public.example/boundaries',
  attribution: 'City of Melbourne CLUE blocks', versionRef: null,
};
const point = JSON.stringify({ type: 'Point', coordinates: [144.963, -37.814] });
const polygon = JSON.stringify({ type: 'Polygon', coordinates: [
  [[144.95, -37.82], [144.97, -37.82], [144.97, -37.8], [144.95, -37.82]],
] });
const selection = { level: 'CLUE_BLOCK' as const, vintage: '2025' };

function planningRow(extra: ViewRow = {}): ViewRow {
  return {
    geo_record_id: 'melbourne.development_monitor:project-A', version_id: 'development-revision-1',
    source_id: planningSource.sourceId, topic: 'planning', assertion_kind: 'plan', is_prediction: false,
    title: 'Example Street (UNDER CONSTRUCTION)',
    summary: 'Status: under_construction (source: UNDER CONSTRUCTION). Application: application-A.',
    original_url: 'https://public.example/original-project', geometry_geojson: point,
    location_role: 'event_site', location_confidence: 'source_coordinate', area_refs: [],
    observed_at: null, published_at: null, valid_from: null, valid_to: null,
    fetched_at: '2026-10-01T08:10:00.123456Z', freshness_state: 'unknown', record_status: 'active',
    ...extra,
  };
}
function boundaryRow(extra: ViewRow = {}): ViewRow {
  return {
    boundary_id: 'com_clue_block:101:2025', version_id: 'boundary-revision-1',
    scheme: 'com_clue_block', code: '101', name: 'Example CLUE block', vintage: '2025',
    geometry_geojson: polygon, valid_from: null, valid_to: null,
    source_record_id: 'melbourne.clue.blocks:101', source_id: boundarySource.sourceId,
    fetched_at: '2026-10-01T08:00:00Z', ...extra,
  };
}
function isAdapterError(code: MapAdapterError['code'] = 'invalidRecord') {
  return (error: unknown) => error instanceof MapAdapterError && error.code === code;
}

test('planning preserves stable identity, exact source revision, original public detail and unknown clocks', () => {
  const item = adaptPlanningRow(planningRow(), { source: planningSource });
  assert.equal(item.id, 'melbourne.development_monitor:project-A');
  assert.equal(item.versionId, 'development-revision-1');
  assert.equal(item.sources[0]?.versionRef, item.versionId);
  assert.equal(item.sources[0]?.url, 'https://public.example/original-project');
  assert.equal(item.sources[0]?.attribution, planningSource.attribution);
  assert.deepEqual(item.geometry, { type: 'Point', coordinates: [144.963, -37.814] });
  assert.equal(item.location.role, 'eventSite');
  assert.equal(item.details.summary, planningRow().summary);
  assert.equal(item.details.projectStatus, null);
  assert.equal(item.details.permitId, null);
  assert.equal(item.time.observedAt, null);
  assert.equal(item.time.reportedAt, null);
  assert.equal(item.time.validFrom, null);
  assert.equal(item.time.fetchedAt, '2026-10-01T08:10:00.123456Z');
  assert.equal(mapItemSchema.safeParse(item).success, true);
});

test('unknown source clock text is retained without inferred UTC or fetched observation time', () => {
  const item = adaptPlanningRow(planningRow({
    source_time_text: 'Monthly release October 2026', source_timezone: 'unspecified',
  }), { source: planningSource });
  assert.equal(item.time.sourceTimeText, 'Monthly release October 2026');
  assert.equal(item.time.sourceTimezone, 'unspecified');
  assert.equal(item.time.observedAt, null);
  assert.equal(item.time.reportedAt, null);
});

test('public records cannot acquire private ingest or provider payload metadata', () => {
  const privateText = 'private-provider-marker';
  const row = planningRow({ batch_id: privateText, raw_uri: privateText, source_updated_at: privateText,
    api_key: privateText, provider_payload: { raw: privateText }, project_status: 'approved',
    permit_id: 'fabricated-from-private-payload' });
  const item = adaptPlanningRow(row, { source: planningSource });
  assert.doesNotMatch(JSON.stringify(item), /private-provider-marker|fabricated-from-private-payload/);
  assert.equal(item.details.projectStatus, null);
  assert.equal(item.details.permitId, null);
});

test('null planning location stays outside drawable items and never uses a centroid', () => {
  const batch = adaptPlanningRows([planningRow({ geometry_geojson: null,
    location_role: 'unknown', location_confidence: 'unverified', centroid_lat: -37.814,
    centroid_lon: 144.963 })], { resolveSource: () => planningSource });
  assert.equal(batch.items.length, 0);
  assert.equal(batch.unlocatedItems.length, 1);
  assert.equal(batch.unlocatedItems[0]?.geometry, null);
  assert.equal(batch.unlocatedItems[0]?.location.precision, 'unlocated');
  assert.equal(batch.unresolvedCount, null);
  assert.deepEqual(batch.sourceIds, [planningSource.sourceId]);
});

test('row conversion and batch admission reject source mismatch and missing public metadata safely', () => {
  assert.throws(() => adaptPlanningRow(planningRow(), { source: boundarySource }), isAdapterError('notPublic'));
  assert.throws(() => adaptPlanningRows([planningRow()], { resolveSource: () => null }), isAdapterError('notPublic'));
  assert.throws(() => adaptPlanningRows([planningRow()], { resolveSource: () => boundarySource }), isAdapterError('notPublic'));
  try { adaptPlanningRow(planningRow({ geometry_geojson: 'private-input-marker' }), { source: planningSource }); }
  catch (error) {
    assert.ok(error instanceof MapAdapterError);
    assert.doesNotMatch(error.message, /private-input-marker|geo_record_id|JSON|SQL/);
  }
});

test('retired planning versions remain historical and cannot silently return as current', () => {
  for (const lifecycle of ['cancelled', 'resolved', 'withdrawn']) {
    assert.throws(() => adaptPlanningRow(planningRow({ record_status: lifecycle }),
      { source: planningSource, mode: 'current' }), isAdapterError());
    assert.equal(adaptPlanningRow(planningRow({ record_status: lifecycle }),
      { source: planningSource, mode: 'historical' }).lifecycle, lifecycle);
  }
});

test('planning provenance rejects guessed points, wrong topics, prediction contradictions and invalid intervals', () => {
  for (const extra of [
    { topic: 'news' }, { assertion_kind: 'plan', is_prediction: true },
    { location_confidence: 'unverified' }, { location_role: 'unknown' },
    { location_role: 'area_only', location_confidence: 'resolved_area' },
    { observed_at: '2026-10-01T18:00:00+10:00' },
    { valid_from: '2026-10-01T00:00:00.123456Z', valid_to: '2026-10-01T00:00:00.123455Z' },
  ]) assert.throws(() => adaptPlanningRow(planningRow(extra), { source: planningSource }), isAdapterError());
});

test('planning batch uses contract codepoint order and rejects duplicate identity/version', () => {
  const rows = ['a', 'Z', 'A'].map((id) => planningRow({ geo_record_id: id }));
  const batch = adaptPlanningRows(rows, { resolveSource: () => planningSource });
  assert.deepEqual(batch.items.map((item) => item.id), ['A', 'Z', 'a']);
  assert.throws(() => adaptPlanningRows([planningRow(), planningRow()],
    { resolveSource: () => planningSource }), isAdapterError());
});

test('boundary preserves source polygon, vintage-specific ID and unknown source clocks', () => {
  const item = adaptBoundaryRow(boundaryRow({ batch_id: 'private-batch' }), { selection, source: boundarySource });
  assert.equal(item.id, 'com_clue_block:101:2025');
  assert.equal(item.details.boundaryId, item.id);
  assert.equal(item.details.boundaryLevel, 'CLUE_BLOCK');
  assert.equal(item.details.vintage, '2025');
  assert.equal(item.geometry?.type, 'Polygon');
  assert.equal(item.time.periodLabel, '2025');
  assert.equal(item.time.observedAt, null);
  assert.equal(item.time.reportedAt, null);
  assert.equal(item.time.validFrom, null);
  assert.equal(item.sources[0]?.url, boundarySource.url);
  assert.equal(item.sources[0]?.versionRef, item.versionId);
  assert.doesNotMatch(JSON.stringify(item), /private-batch|source_record_id/);
  assert.equal(mapItemSchema.safeParse(item).success, true);
});

test('boundary accepts legitimate multipolygons without guessed centroids or simplification', () => {
  const parsedPolygon = JSON.parse(polygon) as { coordinates: number[][][] };
  const item = adaptBoundaryRow(boundaryRow({ geometry_geojson: JSON.stringify({
    type: 'MultiPolygon', coordinates: [parsedPolygon.coordinates],
  }) }), { selection, source: boundarySource });
  assert.equal(item.geometry?.type, 'MultiPolygon');
  assert.equal(item.geometryPresentation, undefined);
});

test('a boundary batch cannot mix requested vintage/level or inconsistent stable identity', () => {
  for (const extra of [
    { vintage: '2021' }, { scheme: 'ASGS_LGA' }, { boundary_id: 'com_clue_block:101:2021' },
    { boundary_id: 'unrelated-id' }, { code: '102' },
  ]) assert.throws(() => adaptBoundaryRows([boundaryRow(), boundaryRow(extra)],
    { selection, resolveSource: () => boundarySource }), isAdapterError());
});

test('boundary rejects unsupported geometry, open rings, malformed times and missing attribution', () => {
  const openPolygon = JSON.stringify({ type: 'Polygon', coordinates: [
    [[144.95, -37.82], [144.97, -37.82], [144.97, -37.8], [144.95, -37.8]],
  ] });
  for (const extra of [
    { geometry_geojson: point }, { geometry_geojson: null }, { geometry_geojson: openPolygon },
    { fetched_at: '2026-02-30T08:00:00Z' },
    { valid_from: '2026-10-01T01:00:00Z', valid_to: '2026-10-01T00:00:00Z' },
  ]) assert.throws(() => adaptBoundaryRow(boundaryRow(extra), { selection, source: boundarySource }), isAdapterError());
  assert.throws(() => adaptBoundaryRows([boundaryRow()], { selection, resolveSource: () => null }),
    isAdapterError('notPublic'));
  assert.throws(() => adaptBoundaryRow(boundaryRow(), {
    selection, source: { ...boundarySource, attribution: '' },
  }), isAdapterError('notPublic'));
});

test('empty conversion supplies no coverage, matching total or inferred unresolved zero', () => {
  assert.deepEqual(adaptBoundaryRows([], { selection, resolveSource: () => boundarySource }),
    { items: [], unlocatedItems: [], sourceIds: [], unresolvedCount: null });
  assert.deepEqual(adaptPlanningRows([], { resolveSource: () => planningSource }),
    { items: [], unlocatedItems: [], sourceIds: [], unresolvedCount: null });
});

test('microsecond comparison and offsets retain exact observation-window semantics', () => {
  assert.equal(comparePublishedInstants('2026-10-01T00:00:00.123455Z', '2026-10-01T00:00:00.123456Z'), -1);
  assert.equal(comparePublishedInstants('2026-10-01T00:00:00.120000Z', '2026-10-01T00:00:00.12Z'), 0);
  assert.equal(offsetPublishedInstant('2026-10-01T23:59:59.123456Z', 60_000), '2026-10-02T00:00:59.123456Z');
  assert.equal(offsetPublishedInstant('1969-12-31T23:59:59.999999Z', 1), '1970-01-01T00:00:00.000999Z');
});

test('published clocks and geometry cannot acquire inferred precision', () => {
  assert.equal(publishedInstant(null), null);
  for (const value of ['2026-10-01', '2026-10-01T00:00Z', '2026-10-01T00:00:00+10:00',
    '2026-10-01T00:00:00.1234567Z', '2026-02-30T00:00:00Z']) {
    assert.throws(() => publishedInstant(value), isAdapterError());
  }
  assert.equal(parsePublishedGeometry(null), null);
  for (const value of [
    { type: 'Point', coordinates: [-37.814, 144.963] },
    { type: 'Point', coordinates: [144.963, -37.814, 20] },
    { type: 'GeometryCollection', geometries: [] },
  ]) assert.throws(() => parsePublishedGeometry(value), isAdapterError());
});
