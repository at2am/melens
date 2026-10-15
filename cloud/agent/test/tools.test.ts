import assert from 'node:assert/strict';
import test from 'node:test';
import { z } from 'zod';

import { melbourneDayOfWeek, toInstant, toMelbourneIso } from '../src/agent/time.js';
import { centroid, compactFeature, haversineMeters, matchesKeywords } from '../src/features/compact.js';
import { toGenaiSchema } from '../src/tools/schema.js';
import { toolSpecs } from '../src/tools/catalog.js';
import { eventItem, fakeReader } from './support.js';

test('Melbourne local time follows daylight saving and round-trips to UTC instants', () => {
  assert.equal(toMelbourneIso('2026-10-10T07:40:00Z'), '2026-10-10T18:40:00+11:00');
  assert.equal(toMelbourneIso('2026-07-01T07:40:00Z'), '2026-07-01T17:40:00+10:00');
  assert.equal(toInstant('2026-10-10T18:40:00+11:00'), '2026-10-10T07:40:00.000Z');
  assert.equal(melbourneDayOfWeek(new Date('2026-10-10T07:40:00Z')), 'sat');
});

test('compact features carry a centroid, Melbourne times, the first public URL and the distance', () => {
  const item = eventItem('event:1', 'Mahler 5', 144.9683, -37.8211, '2026-10-10T08:30:00Z', '2026-10-10T10:30:00Z');
  const compact = compactFeature(item, { lat: -37.8136, lng: 144.9631 });
  assert.deepEqual(compact, { id: 'event:1', layer: 'event', title: 'Mahler 5', summary: 'Hamer Hall. Live music in the city', lat: -37.8211, lng: 144.9683,
    valid_from: '2026-10-10T19:30:00+11:00', valid_to: '2026-10-10T21:30:00+11:00', is_prediction: false,
    source_url: 'https://example.org/events/event:1', distance_m: haversineMeters({ lat: -37.8136, lng: 144.9631 }, { lat: -37.8211, lng: 144.9683 }) });
  assert.ok(compact!.distance_m! > 900 && compact!.distance_m! < 1_100);
  assert.deepEqual(centroid({ type: 'LineString', coordinates: [[144.9, -37.8], [145.0, -37.9]] }), { lat: -37.85, lng: 144.95 });
  assert.equal(compactFeature({ ...item, geometry: null, location: { precision: 'unlocated', role: 'unknown', evidence: null } }, null), null);
  assert.ok(matchesKeywords(compact!, 'mahler hall'));
  assert.ok(!matchesKeywords(compact!, 'jazz'));
});

test('a parking sensor reads Vacant, Occupied or No data, and never as legal parking', () => {
  const sensor = (details: Record<string, unknown>) => compactFeature({ id: 'parking:kerbside:1', versionId: 'v1',
    layerId: 'parking', kind: 'parking', title: 'Parking sensor 1', geometry: { type: 'Point', coordinates: [144.9631, -37.8136] },
    location: { precision: 'point', role: 'sensor', evidence: null }, assertionKind: 'observation', lifecycle: 'active',
    time: { observedAt: null, reportedAt: null, validFrom: null, validTo: null, periodLabel: null, fetchedAt: null,
      sourceTimeText: null, sourceTimezone: null },
    sources: [{ sourceId: 'melbourne.parking.sensors', url: null, attribution: 'City of Melbourne', versionRef: null }],
    details: { sensorId: 'kerbside:1', state: 'vacant', noDataReason: null, reading: 'current',
      lastReportedAt: '2026-10-10T07:38:00.000Z', statusChangedAt: '2026-10-10T07:30:00.000Z', zoneNumber: 7,
      legalParking: 'unknown', mayBeObstructed: true, ...details } } as never, null);
  const vacant = sensor({});
  assert.equal(vacant?.layer, 'parking');
  assert.match(vacant?.summary ?? '', /^Vacant \(live sensor, sensor reported 2026-10-10T18:38/);
  assert.match(vacant?.summary ?? '', /legal parking and time limits are not known/);
  assert.match(sensor({ state: 'occupied' })?.summary ?? '', /^Occupied/);
  assert.equal(sensor({ state: 'noData', noDataReason: 'notReporting', reading: 'stale' })?.summary,
    'No data: the sensor is not reporting');
  assert.equal(sensor({ state: 'noData', noDataReason: 'publicHoliday', reading: 'unknown' })?.summary,
    'No data: sensors do not operate on public holidays');
});

test('tool declarations are Gemini schemas with the right types, enums, bounds and required lists', () => {
  const specs = toolSpecs({ features: fakeReader([]), grounding: null });
  assert.deepEqual(specs.map((spec) => spec.name), ['search_features', 'get_feature', 'get_anomaly', 'nearby_context', 'show_layers', 'focus_map', 'draw_route',
    'highlight_features', 'show_card', 'ask_user', 'area_brief', 'analyse_anomaly', 'maps_grounding', 'search_grounding']);
  const search = toGenaiSchema(specs[0]!.schema) as Record<string, unknown>;
  assert.equal(search.type, 'OBJECT');
  assert.deepEqual(search.required, ['area']);
  const properties = search.properties as Record<string, Record<string, unknown>>;
  assert.equal(properties.area?.type, 'OBJECT');
  // `parking` (UC-15) is a searchable v1 layer; it is not in the default layers, so it is asked for by name.
  assert.deepEqual((properties.layers?.items as Record<string, unknown>).enum,
    ['pedestrian', 'anomaly', 'disruption', 'event', 'news', 'planning', 'parking']);
  assert.deepEqual(properties.limit, { description: '1 to 50, default 20', type: 'INTEGER', minimum: 1, maximum: 50 });
  assert.equal(JSON.stringify(search).includes('additionalProperties'), false);
  const nullable = toGenaiSchema(z.strictObject({ note: z.string().nullable(), kind: z.union([z.literal('a'), z.literal('b')]) })) as Record<string, unknown>;
  const nullableProps = nullable.properties as Record<string, Record<string, unknown>>;
  assert.deepEqual(nullableProps.note, { type: 'STRING', nullable: true });
  assert.deepEqual(nullableProps.kind?.anyOf, [{ type: 'STRING', enum: ['a'] }, { type: 'STRING', enum: ['b'] }]);
});
