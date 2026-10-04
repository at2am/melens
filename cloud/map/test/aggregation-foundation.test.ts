import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MAX_PAGE_ITEMS, MAX_RESPONSE_BYTES, SERVICE_BBOX, mapItemSchema } from '../src/contracts/map-contract.js';
import type { Bbox, LayerResult, MapItem } from '../src/contracts/map-contract.js';
import { aggregateLayer, nominalZoomBand } from '../src/services/aggregation.js';
import type { AggregateItem, ZoomBand } from '../src/services/aggregation.js';

type Sensor = Extract<MapItem, { kind: 'pedestrian' }>;
type Event = Extract<MapItem, { kind: 'event' }>;
const WINDOW = { from: '2026-10-01T00:59:00Z', to: '2026-10-01T01:00:00Z' };
const BOUNDS: Bbox = [144.9, -37.9, 145.1, -37.7];
const BANDS: ZoomBand[] = ['overview', 'district', 'neighbourhood', 'closeUp'];

function sensor(id: string, coordinates: [number, number] = [144.966, -37.818]): Sensor {
  return {
    id, versionId: 'publication-v1', layerId: 'pedestrian', kind: 'pedestrian', title: `Sensor ${id}`,
    geometry: { type: 'Point', coordinates }, location: { precision: 'point', role: 'sensor', evidence: 'Effective source location' },
    assertionKind: 'observation', lifecycle: 'active',
    time: { observedAt: WINDOW.from, reportedAt: null, validFrom: null, validTo: null, periodLabel: null,
      fetchedAt: WINDOW.to, sourceTimeText: null, sourceTimezone: null },
    sources: [{ sourceId: 'public.pedestrian', url: null, attribution: 'Public sensor observations', versionRef: 'publication-v1' }],
    details: { sensorId: id, totalCount: 12, directionACount: null, directionBCount: null, granularity: 'minute', window: { ...WINDOW },
      locationValidFrom: '2026-09-01T00:00:00Z', locationValidTo: null, locationStatus: 'located' },
  };
}

function event(id: string): Event {
  const original = sensor(id);
  return {
    ...original, kind: 'event', layerId: 'event', assertionKind: 'plan', lifecycle: 'planned',
    location: { precision: 'point', role: 'eventSite', evidence: 'Source venue location' },
    time: { ...original.time, observedAt: null },
    details: { summary: null, venueName: 'Public venue', category: 'Community', startAt: null, endAt: null, status: 'planned' },
  };
}

function layer(items: MapItem[], changes: Partial<LayerResult> = {}): LayerResult {
  return {
    layerId: items[0]?.layerId ?? 'pedestrian', state: items.length === 0 ? 'unknown' : 'available',
    freshness: 'current', completeness: 'complete', sourceIds: ['public.pedestrian'],
    coverage: { state: 'unknown', areaRefs: [], window: null, evidenceSourceIds: [] },
    observedWindow: { ...WINDOW }, updatedAt: WINDOW.to, items, unresolvedCount: null,
    nextCursor: null, totalMatching: items.length, ...changes,
  };
}

function singleAggregate(items: MapItem[], changes: Partial<LayerResult> = {}, band: ZoomBand = 'district'): AggregateItem {
  const result = aggregateLayer(layer(items, changes), { zoom: 12, bounds: BOUNDS, band });
  assert.equal(result.items.length, 1);
  const item = result.items[0];
  assert.equal(item?.kind, 'aggregate');
  if (item?.kind !== 'aggregate') throw new Error('Expected aggregate');
  assert.equal(mapItemSchema.safeParse(item).success, true);
  return item;
}

test('nominal four bands have exact boundaries; validated band override admits resolved hysteresis', () => {
  assert.equal(nominalZoomBand(0), 'overview');
  assert.equal(nominalZoomBand(10.999), 'overview');
  assert.equal(nominalZoomBand(11), 'district');
  assert.equal(nominalZoomBand(14), 'neighbourhood');
  assert.equal(nominalZoomBand(17), 'closeUp');
  assert.equal(nominalZoomBand(22), 'closeUp');
  for (const value of [NaN, Infinity, -0.1, 22.1]) assert.throws(() => nominalZoomBand(value), RangeError);
  assert.equal(aggregateLayer(layer([]), { zoom: 14.1, bounds: BOUNDS, band: 'district' }).band, 'district');
  assert.throws(() => aggregateLayer(layer([]), { zoom: 12, bounds: BOUNDS, band: 'invalid' as ZoomBand }), TypeError);
});

test('deterministic groups retain actual points and stable member versions for every input permutation', () => {
  const input = [sensor('B', [144.96601, -37.81801]), sensor('A')];
  const forward = aggregateLayer(layer(input), { zoom: 12, bounds: BOUNDS });
  const reverse = aggregateLayer(layer([...input].reverse()), { zoom: 12, bounds: BOUNDS });
  assert.deepEqual(forward.items, reverse.items);
  assert.deepEqual([...forward.groups], [...reverse.groups]);
  const aggregate = forward.items[0];
  assert.ok(aggregate?.kind === 'aggregate');
  assert.deepEqual(aggregate.details.memberIds, ['A', 'B']);
  assert.deepEqual(aggregate.geometry, { type: 'MultiPoint', coordinates: [[144.966, -37.818], [144.96601, -37.81801]] });
  assert.deepEqual(forward.groups.get(aggregate.id)?.members.map((member) => [member.id, member.versionId]),
    [['A', 'publication-v1'], ['B', 'publication-v1']]);
  assert.equal(aggregate.details.memberCursor, null);
  assert.equal(aggregate.details.resultRange.scope, 'viewport');
  assert.deepEqual(aggregate.details.bounds, [144.966, -37.81801, 144.96601, -37.818]);
});

test('partial groups expose only loaded membership and never claim a full total from layer totalMatching', () => {
  const aggregate = singleAggregate([sensor('A'), sensor('B')], {
    completeness: 'partial', totalMatching: 50, nextCursor: 'opaque-layer-continuation',
  });
  assert.deepEqual(aggregate.details.resultRange, { scope: 'viewport', returnedCount: 2, totalMatching: null });
  assert.equal(aggregate.details.metric.value, 2);
  assert.equal(aggregate.details.metric.unit, 'sensors');
  const complete = singleAggregate([sensor('A'), sensor('B')]);
  assert.equal(complete.details.resultRange.totalMatching, 2);
});

test('sensor count deduplicates source-scoped sensor identity, preserves records and measured zero/null', () => {
  const a = sensor('observation-A');
  const b = sensor('observation-B');
  a.details.sensorId = b.details.sensorId = 'same-source-sensor';
  a.details.totalCount = 0;
  b.details.totalCount = null;
  const result = aggregateLayer(layer([a, b]), { zoom: 12, bounds: BOUNDS });
  const aggregate = result.items[0];
  assert.ok(aggregate?.kind === 'aggregate');
  assert.equal(aggregate.details.metric.value, 1);
  assert.equal(aggregate.details.resultRange.returnedCount, 2);
  assert.match(aggregate.details.metric.definition, /passages.*repeated persons.*not summed/);
  const members = result.groups.get(aggregate.id)?.members;
  assert.equal(members?.[0]?.kind === 'pedestrian' ? members[0].details.totalCount : undefined, 0);
  assert.equal(members?.[1]?.kind === 'pedestrian' ? members[1].details.totalCount : undefined, null);
});

test('different windows, readout granularity, source definitions and lifecycle stay separate', () => {
  const base = sensor('minute');
  const hour = sensor('hour');
  hour.details.granularity = 'hour';
  const differentWindow = sensor('later');
  differentWindow.details.window = { from: WINDOW.to, to: '2026-10-01T01:01:00Z' };
  const source = sensor('other-source');
  source.sources[0]!.sourceId = 'public.other-pedestrian';
  const historical = sensor('resolved');
  historical.lifecycle = 'resolved';
  const result = aggregateLayer(layer([base, hour, differentWindow, source, historical]), { zoom: 12, bounds: BOUNDS });
  assert.equal(result.groups.size, 0);
  assert.equal(result.items.length, 5);
});

test('equivalent fractional UTC spellings group, but distinct microsecond windows never merge', () => {
  const a = sensor('A');
  const b = sensor('B');
  a.details.window = { from: '2026-10-01T00:59:00.000001Z', to: '2026-10-01T01:00:00.0Z' };
  b.details.window = { from: '2026-10-01T00:59:00.000001Z', to: '2026-10-01T01:00:00Z' };
  const aggregate = singleAggregate([a, b]);
  assert.equal(aggregate.details.window?.from, '2026-10-01T00:59:00.000001Z');
  assert.equal(aggregate.details.window?.to, WINDOW.to);
  b.details.window.from = '2026-10-01T00:59:00.000002Z';
  assert.equal(aggregateLayer(layer([a, b]), { zoom: 12, bounds: BOUNDS }).groups.size, 0);
});

test('all bands keep dense colocated groups accessible; close view splits spatially separated points', () => {
  const input = [sensor('A'), sensor('B'), sensor('C')];
  for (const band of BANDS) {
    const aggregate = singleAggregate(input, {}, band);
    assert.deepEqual(aggregate.details.memberIds, ['A', 'B', 'C']);
    const [west, south, east, north] = aggregate.details.bounds;
    assert.ok(west <= 144.966 && east >= 144.966 && south <= -37.818 && north >= -37.818);
    assert.ok(east - west < 1e-10 && north - south < 1e-10);
    assert.equal(aggregate.location.role, 'unknown');
    assert.match(aggregate.location.evidence ?? '', /navigation.*not a new affected area/);
  }
  const separated = aggregateLayer(layer([sensor('A'), sensor('B', [144.967, -37.818])]), { zoom: 18, bounds: BOUNDS });
  assert.equal(separated.groups.size, 0);
  assert.equal(separated.items.length, 2);
});

test('degenerate navigation bounds at service envelope edges never leave the service envelope', () => {
  for (const coordinates of [[144, -39], [146.5, -37]] satisfies [number, number][]) {
    const result = aggregateLayer(layer([sensor('A', coordinates), sensor('B', coordinates)]), { zoom: 18, bounds: SERVICE_BBOX });
    const aggregate = result.items[0];
    assert.ok(aggregate?.kind === 'aggregate');
    assert.ok(aggregate.details.bounds[0] >= SERVICE_BBOX[0] && aggregate.details.bounds[1] >= SERVICE_BBOX[1]);
    assert.ok(aggregate.details.bounds[2] <= SERVICE_BBOX[2] && aggregate.details.bounds[3] <= SERVICE_BBOX[3]);
    assert.deepEqual(aggregate.geometry, { type: 'MultiPoint', coordinates: [coordinates, coordinates] });
  }
});

test('colocated group navigation padding stays inside a viewport whose edge equals the member point', () => {
  const bounds: Bbox = [144.966, -37.818, 144.97, -37.81];
  const result = aggregateLayer(layer([sensor('A'), sensor('B')]), { zoom: 18, bounds });
  const aggregate = result.items[0];
  assert.ok(aggregate?.kind === 'aggregate');
  assert.equal(aggregate.details.bounds[0], bounds[0]);
  assert.equal(aggregate.details.bounds[1], bounds[1]);
  assert.ok(aggregate.details.bounds[2] <= bounds[2] && aggregate.details.bounds[3] <= bounds[3]);
});

test('source line and polygon extents remain unchanged in every band without invented simplification', () => {
  const original = event('road');
  const road: Extract<MapItem, { kind: 'disruption' }> = {
    ...original, kind: 'disruption', layerId: 'disruption',
    geometry: { type: 'LineString', coordinates: [[144.96, -37.82], [144.961, -37.819], [144.962, -37.82]] },
    location: { precision: 'line', role: 'affectedExtent', evidence: 'Confirmed affected road segment' },
    details: { summary: 'Closure', impact: 'Closed', serviceNames: ['Road'], status: 'planned', extentKind: 'roadSegment' },
  };
  const polygon: Extract<MapItem, { kind: 'areaIndicator' }> = {
    ...original, id: 'statistical-area', kind: 'areaIndicator', layerId: 'rent', assertionKind: 'observation', lifecycle: 'active',
    geometry: { type: 'Polygon', coordinates: [[[144.96, -37.82], [144.97, -37.82], [144.97, -37.81], [144.96, -37.82]]] },
    location: { precision: 'area', role: 'statisticalArea', evidence: 'Matched official boundary' },
    details: { indicatorId: 'weeklyRent', value: 500, valueState: 'observed', unit: 'AUD/week', periodId: '2025Q3',
      periodLabel: '2025 Q3', propertyType: 'all', boundaryId: 'area-1', boundaryVintage: '2021', mappingState: 'matched',
      definition: 'Historical median weekly rent over the official statistical area' },
  };
  for (const band of BANDS) for (const item of [road, polygon]) {
    const result = aggregateLayer(layer([item]), { zoom: 12, bounds: BOUNDS, band });
    assert.deepEqual(result.items, [item]);
    assert.equal(result.items[0]?.geometryPresentation, undefined);
    assert.equal(result.groups.size, 0);
  }
});

test('unlocated/inactive/outside points and mention-only news are excluded before geographic grouping', () => {
  const missing = sensor('missing');
  missing.geometry = null;
  missing.location.precision = 'unlocated';
  missing.details.locationStatus = 'unlocated';
  const inactive = sensor('inactive');
  inactive.details.locationStatus = 'inactive';
  const outside = sensor('outside', [145.2, -37.818]);
  const result = aggregateLayer(layer([sensor('located'), missing, inactive, outside]), { zoom: 12, bounds: BOUNDS });
  assert.deepEqual(result.excludedIds, ['inactive', 'missing', 'outside']);
  assert.deepEqual(result.items.map((item) => item.id), ['located']);
  const original = event('mention');
  const mention: Extract<MapItem, { kind: 'news' }> = {
    ...original, layerId: 'news', kind: 'news', assertionKind: 'report', lifecycle: 'active',
    location: { precision: 'point', role: 'mention', evidence: 'Place name mentioned only' },
    details: { eventId: 'mentioned-story', summary: null, articleRefs: [{ articleId: 'a', url: null, title: 'Mention', reportedAt: null }],
      localizationEvidence: null, dedupStatus: 'unconfirmed' },
  };
  assert.deepEqual(aggregateLayer(layer([mention]), { zoom: 12, bounds: BOUNDS }).excludedIds, ['mention']);
  const areaAssociation = { ...mention, id: 'area-association', location: { ...mention.location, role: 'areaAssociation' as const } };
  assert.equal(aggregateLayer(layer([areaAssociation]), { zoom: 12, bounds: BOUNDS }).items.length, 0);
  const reliable = { ...mention, id: 'reliable-story', location: { ...mention.location, role: 'eventSite' as const },
    details: { ...mention.details, localizationEvidence: 'Verified source incident site' } };
  const second = { ...reliable, id: 'second-story' };
  const news = aggregateLayer(layer([reliable, second]), { zoom: 12, bounds: BOUNDS });
  assert.equal(news.groups.size, 0);
  assert.equal(news.items.length, 2);
});

test('anomaly grouping requires producer eligibility/classification and keeps baseline definitions separate', () => {
  const anomaly = (id: string): Extract<MapItem, { kind: 'anomaly' }> => ({
    ...sensor(id), kind: 'anomaly', layerId: 'anomaly',
    details: { resultId: id, sensorId: id, observationId: null, window: { ...WINDOW }, baselineDefinitionId: 'baseline-v1',
      baselineValue: 6, observedValue: 12, delta: 6, direction: 'higher', eligibility: 'eligible', classification: 'anomalous' },
  });
  const a = anomaly('A');
  const b = anomaly('B');
  const c = anomaly('C');
  c.details.baselineDefinitionId = 'baseline-v2';
  const rejected = anomaly('ineligible');
  rejected.details.eligibility = 'ineligible';
  rejected.details.classification = 'unclassified';
  const result = aggregateLayer(layer([a, b, c, rejected]), { zoom: 12, bounds: BOUNDS });
  assert.equal(result.groups.size, 1);
  assert.equal(result.items.length, 2);
  assert.deepEqual(result.excludedIds, ['ineligible']);
  const aggregate = [...result.groups.values()][0]?.aggregate;
  assert.equal(aggregate?.details.metric.unit, 'anomaly results');
  assert.equal(aggregate?.details.metric.value, 2);
  assert.deepEqual(aggregate?.details.memberIds, ['A', 'B']);
});

test('unknown/open-ended source times remain unknown and planned assertions stay explicit', () => {
  const a = event('A');
  const b = event('B');
  a.time.sourceTimeText = b.time.sourceTimeText = 'Date to be announced';
  const aggregate = singleAggregate([a, b]);
  assert.equal(aggregate.details.window, null);
  assert.equal(aggregate.time.sourceTimeText, 'Date to be announced');
  assert.equal(aggregate.time.validFrom, null);
  assert.equal(aggregate.assertionKind, 'plan');
  assert.equal(aggregate.lifecycle, 'planned');
  assert.equal(aggregate.details.metric.unit, 'event records');
});

test('member snapshots are immutable and detached from later caller mutation', () => {
  const input = [sensor('A'), sensor('B')];
  const before = structuredClone(input);
  const result = aggregateLayer(layer(input), { zoom: 12, bounds: BOUNDS });
  assert.deepEqual(input, before);
  const group = [...result.groups.values()][0];
  assert.ok(group);
  input[0]!.versionId = 'changed';
  input[0]!.details.totalCount = 90;
  input[0]!.geometry!.coordinates[0] = 145;
  assert.equal(group.members[0]?.versionId, 'publication-v1');
  assert.ok(Object.isFrozen(group.members));
  assert.ok(Object.isFrozen(group.members[0]?.geometry));
  assert.throws(() => { group.members[0]!.versionId = 'changed'; }, TypeError);
});

test('bounded input refuses oversized rows/bytes, invalid membership and conflicting stable versions', () => {
  assert.throws(() => aggregateLayer(layer(Array.from({ length: MAX_PAGE_ITEMS + 1 }, (_, i) => sensor(`s${i}`))),
    { zoom: 12, bounds: BOUNDS }), RangeError);
  const huge = event('huge');
  huge.details.summary = 'x'.repeat(MAX_RESPONSE_BYTES);
  assert.throws(() => aggregateLayer(layer([huge]), { zoom: 12, bounds: BOUNDS }), RangeError);
  const alternate = sensor('A');
  alternate.versionId = 'publication-v2';
  assert.throws(() => aggregateLayer(layer([sensor('A'), alternate]), { zoom: 12, bounds: BOUNDS }), /one version/);
  assert.throws(() => aggregateLayer(layer([sensor('A')], { layerId: 'event' }), { zoom: 12, bounds: BOUNDS }), /belong/);
  assert.throws(() => aggregateLayer(layer([]), { zoom: 12, bounds: [144, -39, 146.6, -37] }), /Melbourne/);
});

test('a full 1,000-member dense group stays bounded and all member ids are available', () => {
  const input = Array.from({ length: MAX_PAGE_ITEMS }, (_, index) => sensor(`sensor.${index.toString().padStart(4, '0')}`));
  const aggregate = singleAggregate(input, {}, 'closeUp');
  assert.equal(aggregate.details.memberIds.length, MAX_PAGE_ITEMS);
  assert.equal(aggregate.details.resultRange.returnedCount, MAX_PAGE_ITEMS);
  assert.equal(aggregate.details.metric.value, MAX_PAGE_ITEMS);
});
