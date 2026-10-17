import assert from 'node:assert/strict';
import test from 'node:test';

import { mapItemSchema } from '../src/contracts/map-contract.js';
import { MapAdapterError, type PublicSourceReference } from '../src/query/adapter-common.js';
import { adaptDisruptionRow, adaptDisruptionRows } from '../src/query/disruptions.js';
import { adaptEventRow, adaptEventRows } from '../src/query/events.js';
import { adaptPedestrianRow, adaptPedestrianRows } from '../src/query/pedestrian.js';
import type { ViewRow } from '../src/query/query-runner.js';
import { findPublicSource, type PublicSourceCoverage, type SourceCoverageSnapshot } from '../src/query/source-coverage.js';

const minuteSource: PublicSourceReference = { sourceId: 'melbourne.pedestrian.minute',
  url: 'https://example.test/pedestrian', attribution: 'City of Melbourne', versionRef: null };
const locationSource: PublicSourceReference = { sourceId: 'melbourne.pedestrian.locations',
  url: 'https://example.test/locations', attribution: 'City of Melbourne', versionRef: 'latest-location-batch' };
const roadSource: PublicSourceReference = { sourceId: 'victoria.transport.road_unplanned',
  url: 'https://example.test/roads', attribution: 'Transport Victoria', versionRef: null };
const eventSource: PublicSourceReference = { sourceId: 'ticketmaster.events',
  url: 'https://example.test/events', attribution: 'Ticketmaster', versionRef: null };
const transitSource: PublicSourceReference = { sourceId: 'victoria.transport.gtfs_realtime',
  url: 'https://example.test/transit', attribution: 'Transport Victoria', versionRef: null };
const point = JSON.stringify({ type: 'Point', coordinates: [144.963, -37.813] });
const line = JSON.stringify({ type: 'LineString', coordinates: [[144.96, -37.81], [144.97, -37.82]] });

function observation(overrides: ViewRow = {}): ViewRow {
  return { rights_evidence: 'latest_published_record_v1', source_record_id: 'minute:42:2026-10-01T00:00:00Z',
    version_id: 'observation-native-v1', location_source_record_id: 'locations:42', location_version_id: 'location-native-v1',
    source_id: minuteSource.sourceId, batch_id: 'published-batch', sensor_id: '42',
    observed_at: '2026-10-01T00:00:00Z', direction_a_count: null, direction_b_count: 0,
    total_count: null, record_granularity: 'sensor_minute', fetched_at: '2026-10-01T00:02:00Z',
    source_last_success_at: '2026-10-01T00:02:00Z', location_source_id: locationSource.sourceId,
    location_valid_from: '2026-09-30T00:00:00Z', location_valid_to: null,
    geometry_geojson: point, location_status: 'located', source_freshness_state: 'current', ...overrides };
}

function geo(overrides: ViewRow = {}): ViewRow {
  return { geo_record_id: 'fact-1', version_id: 'version-1', source_id: roadSource.sourceId,
    topic: 'road_disruption', assertion_kind: 'report', is_prediction: false, title: 'Road impact',
    summary: null, original_url: 'https://example.test/detail', geometry_geojson: line,
    location_role: 'event_site', location_confidence: 'source_coordinate', area_refs: [],
    observed_at: null, published_at: null, valid_from: null, valid_to: null,
    fetched_at: '2026-10-01T00:02:00Z', freshness_state: 'unknown', record_status: 'active', ...overrides };
}

const resolveSource = (sourceId: string) => [minuteSource, locationSource, roadSource, eventSource, transitSource]
  .find((source) => source.sourceId === sourceId) ?? null;
const invalidRecord = (error: unknown) => error instanceof MapAdapterError && error.code === 'invalidRecord';
const notPublic = (error: unknown) => error instanceof MapAdapterError && error.code === 'notPublic';

test('pedestrian missing counts stay null, measured direction zero stays zero, no missing minutes synthesized', () => {
  const batch = adaptPedestrianRows([observation(), observation({ observed_at: '2026-10-01T00:02:00Z',
    total_count: 0, direction_a_count: 0 })], { resolveSource, mode: 'current' });
  assert.equal(batch.items.length, 2);
  const missing = batch.items.find((item) => item.time.observedAt === '2026-10-01T00:00:00Z');
  assert.equal(missing?.details.totalCount, null);
  assert.equal(missing?.details.directionACount, null);
  assert.equal(missing?.details.directionBCount, 0);
  assert.equal(batch.unresolvedCount, null);
  assert.equal(batch.unlocatedItems.length, 0);
  assert.ok(batch.items.every((item) => mapItemSchema.safeParse(item).success));
});

test('sensor uses exact observation-effective coordinates and the native historical location version', () => {
  const old = adaptPedestrianRow(observation({ geometry_geojson: JSON.stringify({ type: 'Point',
    coordinates: [144.95, -37.82] }), location_valid_to: '2026-10-01T01:00:00Z' }),
  { source: minuteSource, locationSource });
  assert.deepEqual(old.geometry, { type: 'Point', coordinates: [144.95, -37.82] });
  assert.equal(old.sources.find((source) => source.sourceId === locationSource.sourceId)?.versionRef, 'location-native-v1');
  assert.equal(old.details.locationValidTo, '2026-10-01T01:00:00Z');
  assert.equal(old.location.role, 'sensor');
});

test('hourly granularity and microsecond count-window bounds are preserved', () => {
  const hourlySource = { ...minuteSource, sourceId: 'melbourne.pedestrian.hourly' };
  const item = adaptPedestrianRow(observation({ source_id: hourlySource.sourceId,
    record_granularity: 'sensor_hour', observed_at: '2026-10-01T00:00:00.123456Z' }),
  { source: hourlySource, locationSource });
  assert.equal(item.details.granularity, 'hour');
  assert.deepEqual(item.details.window,
    { from: '2026-10-01T00:00:00.123456Z', to: '2026-10-01T01:00:00.123456Z' });
});

test('sensor interval that covers the start but not the count window becomes unlocated', () => {
  const batch = adaptPedestrianRows([observation({ location_valid_to: '2026-10-01T00:00:59.999999Z' })],
    { resolveSource, mode: 'current' });
  assert.equal(batch.items.length, 0);
  assert.equal(batch.unlocatedItems.length, 1);
  assert.equal(batch.unlocatedItems[0]?.geometry, null);
  assert.equal(batch.unlocatedItems[0]?.details.locationStatus, 'unlocated');
  assert.equal(batch.unresolvedCount, null);
});

test('effective validity to the exact window boundary is drawable', () => {
  const item = adaptPedestrianRow(observation({ location_valid_to: '2026-10-01T00:01:00Z' }),
    { source: minuteSource, locationSource });
  assert.equal(item.geometry?.type, 'Point');
});

test('ambiguous, inactive and unlocated sensors have null geometry and retain their status', () => {
  for (const location_status of ['ambiguous', 'inactive', 'unlocated'] as const) {
    const item = adaptPedestrianRow(observation({ location_status }), { source: minuteSource, locationSource });
    assert.equal(item.geometry, null);
    assert.equal(item.location.precision, 'unlocated');
    assert.equal(item.details.locationStatus, location_status);
  }
});

test('invalid sensor counts, wrong geometry and malformed source timestamps fail safely', () => {
  for (const overrides of [{ direction_a_count: 2, direction_b_count: 3, total_count: 4 },
    { total_count: -1 }, { geometry_geojson: line }, { observed_at: '2026-10-01 00:00:00' }]) {
    assert.throws(() => adaptPedestrianRow(observation(overrides), { source: minuteSource, locationSource }), invalidRecord);
  }
});

test('pedestrian stable identity is unchanged across correction batches and equivalent UTC formatting', () => {
  const a = adaptPedestrianRow(observation(), { source: minuteSource, locationSource });
  const b = adaptPedestrianRow(observation({ batch_id: 'corrected-batch', observed_at: '2026-10-01T00:00:00.000000Z',
    total_count: 7, direction_a_count: 7 }), { source: minuteSource, locationSource });
  assert.equal(a.id, b.id);
  assert.notEqual(a.versionId, b.versionId);
});

test('missing public observation or location admission cannot fabricate a zero or public item', () => {
  assert.throws(() => adaptPedestrianRows([observation()], { resolveSource: () => null, mode: 'current' }), notPublic);
  assert.throws(() => adaptPedestrianRows([observation()], {
    resolveSource: (sourceId) => sourceId === minuteSource.sourceId ? minuteSource : null, mode: 'current' }), notPublic);
});

test('road line remains an affected extent, raw provider properties are omitted and unknown clocks remain null', () => {
  const item = adaptDisruptionRow(geo({ summary: JSON.stringify({ description: 'Two lanes closed',
    impact: { impactType: 'Lane closure', direction: 'Inbound' },
    created: '2026-10-01T09:00:00', last_updated: '2026-10-01T10:00:00', timezone_status: 'unverified',
    source_properties: { private_payload: 'secret'.repeat(1_000) } }) }), { source: roadSource });
  assert.equal(item.geometry?.type, 'LineString');
  assert.equal(item.location.role, 'affectedExtent');
  assert.equal(item.details.extentKind, 'roadSegment');
  assert.equal(item.details.summary, 'Two lanes closed');
  assert.match(item.details.impact ?? '', /Inbound/);
  assert.equal(item.time.observedAt, null);
  assert.equal(item.time.reportedAt, null);
  assert.equal(item.time.validFrom, null);
  assert.equal(item.time.sourceTimezone, null);
  assert.match(item.time.sourceTimeText ?? '', /2026-10-01T09:00:00/);
  assert.doesNotMatch(JSON.stringify(item), /private_payload|secret|source_properties/);
});

test('planned road intervals stay plans with documented source timezone and recurrence caveat', () => {
  const source = { ...roadSource, sourceId: 'victoria.transport.road_planned' };
  const item = adaptDisruptionRow(geo({ source_id: source.sourceId, assertion_kind: 'plan', record_status: 'planned',
    valid_from: '2026-10-10T00:00:00Z', valid_to: '2026-10-11T00:00:00Z',
    summary: JSON.stringify({ description: 'Bridge works', duration: { start: '2026-10-10T11:00:00',
      end: '2026-10-11T11:00:00' }, source_timezone: 'Australia/Melbourne',
    validity_note: 'Overall plan period; recurrence schedule determines impact times' }) }), { source });
  assert.equal(item.assertionKind, 'plan');
  assert.equal(item.lifecycle, 'planned');
  assert.equal(item.details.status, 'planned');
  assert.equal(item.time.sourceTimezone, 'Australia/Melbourne');
  assert.match(item.details.summary ?? '', /recurrence/);
});

test('transit route-only alerts stay unlocated and selector IDs are not invented service names', () => {
  const row = geo({ source_id: transitSource.sourceId, topic: 'transport', geometry_geojson: null,
    location_role: 'unknown', location_confidence: 'unverified',
    summary: JSON.stringify({ description: 'Route service disruption', effect: 'NO_SERVICE',
      selectors: [{ routeId: 'official-route-1', stopId: null }], feed_timestamp: '2026-10-01T00:00:00Z' }) });
  const batch = adaptDisruptionRows([row], { resolveSource, mode: 'current' });
  assert.equal(batch.items.length, 0);
  assert.equal(batch.unlocatedItems[0]?.details.extentKind, 'route');
  assert.deepEqual(batch.unlocatedItems[0]?.details.serviceNames, []);
  assert.equal(batch.unlocatedItems[0]?.lifecycle, 'active');
  assert.equal(batch.unlocatedItems[0]?.time.reportedAt, null);
  assert.equal(batch.unresolvedCount, null);
});

test('a transit alert as the connector writes it: numeric GTFS effect, drawn along its routes', () => {
  const routes = JSON.stringify({ type: 'MultiLineString',
    coordinates: [[[144.96, -37.81], [144.97, -37.82]], [[144.97, -37.82], [144.98, -37.83]]] });
  const item = adaptDisruptionRow(geo({ source_id: transitSource.sourceId, topic: 'transport',
    geometry_geojson: routes, location_confidence: 'official_join',
    summary: JSON.stringify({ mode: 'metro_train', feed_timestamp: '2026-10-01T00:00:00Z', feed_version: null,
      alert_id: 'M-17', cause: 9, effect: 1, description: 'Buses replace trains',
      selectors: [{ agencyId: '1', routeId: 'aus:vic:vic-02-CGB:', stopId: 'vic:rail:NME', directionId: 0 }],
      gtfs_mapping_status: 'route_with_stops', static_evidence: [] }) }), { source: transitSource });
  assert.equal(item.geometry?.type, 'MultiLineString');
  assert.equal(item.details.extentKind, 'route');
  assert.equal(item.details.impact, 'No service');
  assert.equal(item.details.summary, 'Buses replace trains');
  // An effect number outside the enum is no text rather than a guess.
  const unknown = adaptDisruptionRow(geo({ source_id: transitSource.sourceId, topic: 'transport',
    geometry_geojson: routes, location_confidence: 'official_join',
    summary: JSON.stringify({ effect: 99, selectors: [] }) }), { source: transitSource });
  assert.equal(unknown.details.impact, null);
});

test('an officially joined transit stop preserves its point and stop extent', () => {
  const item = adaptDisruptionRow(geo({ source_id: transitSource.sourceId, topic: 'transport',
    geometry_geojson: point, location_confidence: 'official_join' }), { source: transitSource });
  assert.equal(item.details.extentKind, 'stop');
  assert.equal(item.location.role, 'eventSite');
  assert.equal(item.geometry?.type, 'Point');
});

test('resolved and withdrawn disruption history is retained while current retired rows fail closed', () => {
  for (const record_status of ['resolved', 'withdrawn', 'cancelled'] as const) {
    const row = geo({ record_status });
    assert.equal(adaptDisruptionRows([row], { resolveSource, mode: 'historical' }).items[0]?.lifecycle, record_status);
    assert.throws(() => adaptDisruptionRows([row], { resolveSource, mode: 'current' }), invalidRecord);
  }
});

test('known future active records become planned in current context without changing source clocks or history', () => {
  const row = geo({ valid_from: '2026-10-10T00:00:00Z', valid_to: '2026-10-11T00:00:00Z' });
  const current = adaptDisruptionRow(row, { source: roadSource, mode: 'current', asOf: '2026-10-01T00:00:00Z' });
  assert.equal(current.details.status, 'planned');
  assert.equal(current.lifecycle, 'planned');
  assert.equal(current.time.observedAt, null);
  assert.equal(adaptDisruptionRow(row, { source: roadSource, mode: 'historical',
    asOf: '2026-10-01T00:00:00Z' }).lifecycle, 'active');
  const event = adaptEventRow({ ...row, topic: 'event', source_id: eventSource.sourceId,
    geometry_geojson: point }, { source: eventSource, mode: 'current', asOf: '2026-10-01T00:00:00Z' });
  assert.equal(event.details.status, 'planned');
});

test('event venue, local source clock and unknown end are adapted from actual Ticketmaster row shape', () => {
  const start = '2026-10-10T09:00:00Z';
  const item = adaptEventRow(geo({ source_id: eventSource.sourceId, topic: 'event', geometry_geojson: point,
    assertion_kind: 'plan', record_status: 'planned', valid_from: start, valid_to: start,
    summary: 'Event information provided by Ticketmaster; Ticketmaster status: onsale; '
      + 'local start: 2026-10-10 20:00:00 Australia/Melbourne; venue: Forum' }),
  { source: eventSource });
  assert.equal(item.details.venueName, 'Forum');
  assert.equal(item.details.summary, null, 'The metadata summary is not shown as text');
  assert.equal(item.details.category, null);
  assert.equal(item.details.startAt, start);
  assert.equal(item.details.endAt, null);
  assert.equal(item.time.validTo, null);
  assert.equal(item.time.reportedAt, null);
  assert.equal(item.time.sourceTimezone, 'Australia/Melbourne');
  assert.equal(item.lifecycle, 'planned');
  assert.equal(mapItemSchema.safeParse(item).success, true);
});

test('unscheduled/unlocated event retains null times and unknown venue without guessed geometry', () => {
  const batch = adaptEventRows([geo({ source_id: eventSource.sourceId, topic: 'event', assertion_kind: 'plan',
    record_status: 'planned', geometry_geojson: null, location_role: 'unknown', location_confidence: 'unverified',
    summary: 'Ticketmaster status: postponed; local start: unknown Australia/Melbourne; venue: unknown' })],
  { resolveSource, mode: 'current' });
  assert.equal(batch.items.length, 0);
  assert.equal(batch.unlocatedItems[0]?.details.startAt, null);
  assert.equal(batch.unlocatedItems[0]?.details.endAt, null);
  assert.equal(batch.unlocatedItems[0]?.details.venueName, null);
  assert.equal(batch.unlocatedItems[0]?.details.summary, 'Ticketmaster status: postponed');
  assert.equal(batch.unlocatedItems[0]?.time.observedAt, null);
  assert.equal(batch.unresolvedCount, null);
});

test('cancelled event history remains cancelled, not an old active candidate', () => {
  const row = geo({ source_id: eventSource.sourceId, topic: 'event', assertion_kind: 'plan',
    record_status: 'cancelled', geometry_geojson: point });
  const item = adaptEventRows([row], { resolveSource, mode: 'historical' }).items[0];
  assert.equal(item?.lifecycle, 'cancelled');
  assert.equal(item?.details.status, 'cancelled');
  assert.throws(() => adaptEventRows([row], { resolveSource, mode: 'current' }), invalidRecord);
});

test('malformed published dynamic facts fail without leaking row contents or swallowing exact totals', () => {
  const secret = 'provider-key-private-content';
  assert.throws(() => adaptEventRow(geo({ source_id: eventSource.sourceId, topic: 'event',
    geometry_geojson: secret }), { source: eventSource }), (error) => {
    assert.ok(error instanceof MapAdapterError);
    assert.doesNotMatch(error.message, new RegExp(secret));
    return true;
  });
  assert.throws(() => adaptDisruptionRows([geo(), geo()], { resolveSource, mode: 'current' }), invalidRecord);
  assert.throws(() => adaptEventRow(geo({ source_id: eventSource.sourceId, topic: 'event',
    valid_from: '2026-10-10T01:00:00Z', valid_to: '2026-10-10T00:00:00Z' }), { source: eventSource }), invalidRecord);
});

test('T011 denied, unpublished and absent sources remain unavailable to dynamic adapters', () => {
  const candidate: PublicSourceCoverage = { sourceId: eventSource.sourceId, topic: 'event', scope: 'greater_melbourne',
    coverageAreaRefs: [], coverageFrom: null, coverageTo: null, licenseStatus: 'review_required',
    accessStatus: 'candidate', admitted: false, healthState: 'unknown', publishedBatchId: null,
    publishedAt: null, publishedWindow: null, publishedOutputCount: null, evidenceState: 'unknown' as const };
  for (const snapshot of [{ sources: [], completeness: 'complete' },
    { sources: [candidate], completeness: 'complete' },
    { sources: [{ ...candidate, licenseStatus: 'verified_open', accessStatus: 'active', admitted: true }],
      completeness: 'complete' }] satisfies SourceCoverageSnapshot[]) {
    assert.throws(() => adaptEventRows([geo({ source_id: eventSource.sourceId, topic: 'event' })], {
      mode: 'current', resolveSource: (sourceId) => findPublicSource(snapshot, sourceId) === null ? null : eventSource,
    }), notPublic);
  }
});

test('a user event carries its description, place and attendance from the JSON summary, in Melbourne time', () => {
  const userSource: PublicSourceReference = { sourceId: 'user.events', url: null, attribution: 'Published by a Melens user', versionRef: null };
  const row = geo({ source_id: userSource.sourceId, topic: 'event', geometry_geojson: point, assertion_kind: 'plan', record_status: 'planned',
    original_url: null, valid_from: '2026-10-12T07:00:00Z', valid_to: '2026-10-12T08:00:00Z', published_at: '2026-10-10T02:15:00Z',
    summary: JSON.stringify({ description: 'Easy 5 km, all paces welcome.', placeName: 'Boathouse Drive steps', attendeeCount: 3, anonymousAttendance: true }) });
  const item = adaptEventRow(row, { source: userSource, mode: 'current', asOf: '2026-10-10T07:00:00Z' });
  assert.equal(item.details.summary, 'Easy 5 km, all paces welcome.\n3 people are going');
  assert.equal(item.details.venueName, 'Boathouse Drive steps');
  assert.equal(item.details.category, 'community');
  assert.equal(item.time.sourceTimezone, 'Australia/Melbourne');
  assert.equal(item.lifecycle, 'planned');
  assert.equal(item.sources[0]?.url, null);
  assert.equal(mapItemSchema.safeParse(item).success, true);
  const nobody = adaptEventRow({ ...row, summary: JSON.stringify({ description: 'Quiet one', placeName: null, attendeeCount: 0 }) }, { source: userSource });
  assert.equal(nobody.details.summary, 'Quiet one');
  assert.equal(nobody.details.venueName, null);
  const plain = adaptEventRow({ ...row, summary: 'Written before the JSON summary existed' }, { source: userSource });
  assert.equal(plain.details.summary, 'Written before the JSON summary existed');
  assert.throws(() => adaptEventRow({ ...row, summary: '{not json' }, { source: userSource }), invalidRecord);
});

test('pedestrian rejects missing or obsolete permission evidence and incomplete native identities', () => {
  const missing = observation();
  delete missing.rights_evidence;
  assert.throws(() => adaptPedestrianRow(missing, { source: minuteSource, locationSource }), invalidRecord);
  for (const overrides of [{ rights_evidence: null }, { rights_evidence: 'published' },
    { version_id: '' }, { location_version_id: null }]) {
    assert.throws(() => adaptPedestrianRow(observation(overrides), { source: minuteSource, locationSource }), invalidRecord);
  }
});

test('native observation and location revisions change snapshot identity even when visible values stay equal', () => {
  const first = adaptPedestrianRow(observation(), { source: minuteSource, locationSource });
  for (const overrides of [{ version_id: 'observation-native-v2' }, { location_version_id: 'location-native-v2' },
    { source_record_id: 'other-native-observation' }, { location_source_record_id: 'other-native-location' }]) {
    const changed = adaptPedestrianRow(observation(overrides), { source: minuteSource, locationSource });
    assert.equal(changed.id, first.id);
    assert.notEqual(changed.versionId, first.versionId);
  }
});
