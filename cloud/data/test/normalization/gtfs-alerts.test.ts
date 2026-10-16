import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

import {
  SOURCE_ID as STATIC_SOURCE_ID,
  normalizeGtfsSnapshot,
  parseGtfsSnapshot,
} from '../../src/connectors/tv_gtfs_static/index.js';
import {
  SOURCE_ID as REALTIME_SOURCE_ID,
  normalizeAlertFeeds,
  type AlertSelector,
  type ParsedAlertFeed,
} from '../../src/connectors/tv_gtfs_realtime/index.js';
import { parseConnectorInput } from '../../src/core/connector.js';
import {
  compareFullGtfsSnapshots,
  joinGtfsAlertLocations,
} from '../../src/normalization/gtfs-alerts.js';
import { validateGeoRecordGeography } from '../../src/validation/geography.js';

const fetchedAt = '2026-09-28T00:06:00.000Z';
const feedTimestamp = '2026-09-28T00:05:00.000Z';
const selector: AlertSelector = {
  agencyId: '2', routeId: '2-FLI', routeType: 2, stopId: '19499',
  directionId: 0, tripId: 'TRIP-FLI-01', tripRouteId: '2-FLI',
  tripStartDate: null, tripStartTime: null,
};

async function staticVersion() {
  const raw = JSON.parse(await readFile(new URL('../fixtures/tv_gtfs_static.json', import.meta.url), 'utf8'));
  const snapshot = parseGtfsSnapshot(raw);
  const normalized = normalizeGtfsSnapshot(snapshot, parseConnectorInput({
    sourceId: STATIC_SOURCE_ID, window: { kind: 'snapshot', revision: 'latest' },
    checkpoint: null, runId: 'static-test-run',
  }), fetchedAt);
  return { snapshot, normalized };
}

function feed(version: string | null, selectors: AlertSelector[] = [selector]): ParsedAlertFeed {
  return { gtfsRealtimeVersion: '2.0', feedTimestamp, feedVersion: version,
    alerts: [{ id: 'M-17', activePeriods: [], communicationPeriods: [],
      impactPeriods: [{ start: feedTimestamp, end: '2026-09-28T00:30:00.000Z' }],
      selectors, cause: null, effect: 1, header: 'Train disruption',
      description: null, url: null }] };
}

function normalizedAlerts(parsed: ParsedAlertFeed) {
  return normalizeAlertFeeds([{ mode: 'metro_train', resourceUrl: 'https://example.test/metro',
    parsed, fetchedAt }], parseConnectorInput({ sourceId: REALTIME_SOURCE_ID,
    window: { kind: 'snapshot', revision: feedTimestamp },
    checkpoint: null, runId: 'realtime-test-run' }));
}

test('an exact stop, route, trip and static feed version yields a sourced point', async () => {
  const version = await staticVersion();
  const alerts = normalizedAlerts(feed(version.normalized.feedVersion));
  const joined = joinGtfsAlertLocations({ alerts: alerts.geoRecords,
    alertSources: alerts.geoRecordSources, staticVersions: [version] });
  assert.equal(joined.mappings[0]?.status, 'located');
  assert.deepEqual(joined.mappings[0]?.stopIds, ['19499']);
  assert.deepEqual(joined.mappings[0]?.routeIds, ['2-FLI']);
  const point = joined.geoRecords[0];
  assert.ok(point);
  assert.equal(point.location_confidence, 'official_join');
  assert.equal(point.location_role, 'event_site');
  assert.equal(point.centroid_lat, -37.8183);
  assert.equal(point.centroid_lon, 144.9671);
  assert.equal(validateGeoRecordGeography(point).valid, true);
  assert.equal(joined.geoRecordSources.some(link =>
    link.evidence_role === 'gtfs_static_stop_location'
      && link.source_record_id === `${STATIC_SOURCE_ID}:stop:19499`), true);
  assert.equal(joined.geoRecordSources.every(link => link.version_id === point.version_id), true);
});

test('version mismatch and unknown stop keep the alert without invented coordinates', async () => {
  const version = await staticVersion();
  const wrongVersion = normalizedAlerts(feed('unverified-static-version'));
  const unmatched = joinGtfsAlertLocations({ alerts: wrongVersion.geoRecords,
    alertSources: wrongVersion.geoRecordSources, staticVersions: [version] });
  assert.equal(unmatched.mappings[0]?.status, 'version_unverified');
  assert.equal(unmatched.geoRecords[0]?.geometry_geojson, null);
  assert.equal(unmatched.geoRecordSources.length, wrongVersion.geoRecordSources.length);

  const unknownStop = normalizedAlerts(feed(version.normalized.feedVersion,
    [{ ...selector, stopId: 'UNKNOWN' }]));
  const unknown = joinGtfsAlertLocations({ alerts: unknownStop.geoRecords,
    alertSources: unknownStop.geoRecordSources, staticVersions: [version] });
  assert.equal(unknown.mappings[0]?.status, 'unmapped');
  assert.equal(unknown.geoRecords[0]?.geometry_geojson, null);
});

test('archive validator is not a publisher feed version and cannot locate an alert', async () => {
  const version = await staticVersion();
  const archiveVersion = 'archive-sha256:verified-http-archive';
  const officialSnapshot = { ...version.snapshot, feed_info: [] };
  const official = { snapshot: officialSnapshot,
    normalized: normalizeGtfsSnapshot(officialSnapshot, parseConnectorInput({
      sourceId: STATIC_SOURCE_ID, window: { kind: 'snapshot', revision: 'latest' },
      checkpoint: null, runId: 'official-static-test-run',
    }), fetchedAt, { feedVersion: archiveVersion,
      tripStopMembershipComplete: false }) };
  const alerts = normalizedAlerts(feed(archiveVersion));
  const joined = joinGtfsAlertLocations({ alerts: alerts.geoRecords,
    alertSources: alerts.geoRecordSources, staticVersions: [official] });
  assert.equal(joined.mappings[0]?.status, 'version_unverified');
  assert.equal(joined.geoRecords[0]?.geometry_geojson, null);
  assert.deepEqual(joined.geoRecordSources, alerts.geoRecordSources);
});

test('flattened official feed_info cannot prove both mode versions', async () => {
  const version = await staticVersion();
  const publisherVersion = version.snapshot.feed_info[0]?.feed_version;
  assert.ok(publisherVersion);
  const archiveVersion = 'archive-sha256:verified-http-archive';
  const officialSnapshot = { ...version.snapshot,
    feed_info: [...version.snapshot.feed_info, ...version.snapshot.feed_info] };
  const official = { snapshot: officialSnapshot,
    normalized: normalizeGtfsSnapshot(officialSnapshot, parseConnectorInput({
      sourceId: STATIC_SOURCE_ID, window: { kind: 'snapshot', revision: 'latest' },
      checkpoint: null, runId: 'official-static-test-run',
    }), fetchedAt, { feedVersion: archiveVersion }) };
  const alerts = normalizedAlerts(feed(publisherVersion));
  const joined = joinGtfsAlertLocations({ alerts: alerts.geoRecords,
    alertSources: alerts.geoRecordSources, staticVersions: [official] });
  assert.equal(joined.mappings[0]?.status, 'version_unverified');
  assert.equal(joined.geoRecords[0]?.geometry_geojson, null);
  assert.deepEqual(joined.geoRecordSources, alerts.geoRecordSources);

  const partial = { ...official, snapshot: { ...officialSnapshot,
    feed_info: officialSnapshot.feed_info.slice(0, 1) } };
  const partialJoin = joinGtfsAlertLocations({ alerts: alerts.geoRecords,
    alertSources: alerts.geoRecordSources, staticVersions: [partial] });
  assert.equal(partialJoin.mappings[0]?.status, 'version_unverified');
  assert.equal(partialJoin.geoRecords[0]?.geometry_geojson, null);

  const conflicting = { ...official, snapshot: { ...officialSnapshot,
    feed_info: [officialSnapshot.feed_info[0]!,
      { ...officialSnapshot.feed_info[1]!, feed_version: 'different-publisher-version' }] } };
  const conflictingJoin = joinGtfsAlertLocations({ alerts: alerts.geoRecords,
    alertSources: alerts.geoRecordSources, staticVersions: [conflicting] });
  assert.equal(conflictingJoin.mappings[0]?.status, 'version_unverified');
  assert.equal(conflictingJoin.geoRecords[0]?.geometry_geojson, null);
});

test('publisher feed_info must agree with the normalized static version', async () => {
  const version = await staticVersion();
  const mismatched = { ...version,
    normalized: { ...version.normalized, feedVersion: 'different-normalized-version' } };
  const alerts = normalizedAlerts(feed(version.snapshot.feed_info[0]?.feed_version ?? null));
  const joined = joinGtfsAlertLocations({ alerts: alerts.geoRecords,
    alertSources: alerts.geoRecordSources, staticVersions: [mismatched] });
  assert.equal(joined.mappings[0]?.status, 'version_unverified');
  assert.equal(joined.geoRecords[0]?.geometry_geojson, null);
});

test('sparse official stop times cannot claim a trip-specific stop match', async () => {
  const version = await staticVersion();
  const sparse = { snapshot: version.snapshot,
    normalized: { ...version.normalized, tripStopMembershipComplete: false } };
  const alerts = normalizedAlerts(feed(sparse.normalized.feedVersion));
  const joined = joinGtfsAlertLocations({ alerts: alerts.geoRecords,
    alertSources: alerts.geoRecordSources, staticVersions: [sparse] });
  assert.equal(joined.mappings[0]?.status, 'unmapped');
  assert.equal(joined.geoRecords[0]?.geometry_geojson, null);
  assert.equal(joined.geoRecordSources.some(link =>
    link.evidence_role === 'gtfs_static_stop_location'), false);
});

test('mixed route and stop selectors cannot locate the whole alert at one stop', async () => {
  const version = await staticVersion();
  const alerts = normalizedAlerts(feed(version.normalized.feedVersion,
    [selector, { ...selector, stopId: null, tripId: null,
      tripStartDate: null, tripStartTime: null }]));
  const joined = joinGtfsAlertLocations({ alerts: alerts.geoRecords,
    alertSources: alerts.geoRecordSources, staticVersions: [version] });
  // Both selectors name the route: the alert belongs to it, and without a shape nothing is drawn.
  assert.equal(joined.mappings[0]?.status, 'route_with_stops');
  assert.equal(joined.geoRecords[0]?.geometry_geojson, null);
});

test('malformed trip-instance constraints cannot supply an alert location', async () => {
  const version = await staticVersion();
  for (const constraints of [
    { tripStartDate: '19000101', tripStartTime: '99:99:99' },
    { tripStartDate: '20260230', tripStartTime: '07:50:00' },
  ]) {
    const alerts = normalizedAlerts(feed(version.normalized.feedVersion,
      [{ ...selector, ...constraints }]));
    const joined = joinGtfsAlertLocations({ alerts: alerts.geoRecords,
      alertSources: alerts.geoRecordSources, staticVersions: [version] });
    assert.equal(joined.mappings[0]?.status, 'invalid_alert');
    assert.equal(joined.geoRecords[0]?.geometry_geojson, null);
    assert.deepEqual(joined.geoRecordSources, alerts.geoRecordSources);
  }
});

test('valid trip-instance constraints stay unresolved without static calendar and frequency proof', async () => {
  const version = await staticVersion();
  for (const constraints of [
    { tripStartDate: '20260928', tripStartTime: null },
    { tripStartDate: null, tripStartTime: '07:50:00' },
    { tripStartDate: '20260928', tripStartTime: '25:15:35' },
  ]) {
    const alerts = normalizedAlerts(feed(version.normalized.feedVersion,
      [{ ...selector, ...constraints }]));
    const joined = joinGtfsAlertLocations({ alerts: alerts.geoRecords,
      alertSources: alerts.geoRecordSources, staticVersions: [version] });
    assert.equal(joined.mappings[0]?.status, 'trip_instance_unverified');
    assert.equal(joined.geoRecords[0]?.geometry_geojson, null);
    assert.equal(joined.geoRecords[0]?.location_confidence, 'unverified');
    assert.equal(joined.geoRecordSources.some(link =>
      link.evidence_role === 'gtfs_static_stop_location'), false);
    assert.deepEqual(joined.geoRecordSources, alerts.geoRecordSources);
  }
});

test('a matched stop alongside an unverified trip instance cannot locate the whole alert', async () => {
  const version = await staticVersion();
  const alerts = normalizedAlerts(feed(version.normalized.feedVersion, [
    selector, { ...selector, tripStartDate: '20260928', tripStartTime: '07:50:00' },
  ]));
  const joined = joinGtfsAlertLocations({ alerts: alerts.geoRecords,
    alertSources: alerts.geoRecordSources, staticVersions: [version] });
  assert.equal(joined.mappings[0]?.status, 'trip_instance_unverified');
  assert.equal(joined.geoRecords[0]?.geometry_geojson, null);
});

test('FULL_DATASET disappearance is membership change, not cancellation', () => {
  const previous = feed('v1');
  const current: ParsedAlertFeed = { ...feed('v1'),
    feedTimestamp: '2026-09-28T00:10:00.000Z', alerts: [] };
  assert.deepEqual(compareFullGtfsSnapshots({ previous, current }),
    { currentAlertIds: [], disappearedAlertIds: ['M-17'] });
  assert.throws(() => compareFullGtfsSnapshots({ previous: current, current: previous }));
});

test('alerts naming stations match through their platforms, and several stations on a line draw the line', async () => {
  const raw = JSON.parse(await readFile(new URL('../fixtures/tv_gtfs_static.json', import.meta.url), 'utf8'));
  const line: [number, number][] = [[144.9525, -37.8184], [144.9671, -37.8183]];
  // As the official feed: stations (location_type 1) hold their platforms, and alerts name the stations.
  const snapshot = parseGtfsSnapshot({ ...raw, feed_info: [],
    stops: [...raw.stops.map((stop: { stop_id: string }) => stop.stop_id === '19499'
      ? { ...stop, location_type: 0, parent_station: 'vic:rail:FSS' }
      : stop.stop_id === '19854' ? { ...stop, location_type: 0, parent_station: 'vic:rail:SSS' } : stop),
    { stop_id: 'vic:rail:FSS', stop_name: 'Flinders Street', stop_lat: -37.8183, stop_lon: 144.9671, location_type: 1 },
    { stop_id: 'vic:rail:SSS', stop_name: 'Southern Cross', stop_lat: -37.8184, stop_lon: 144.9525, location_type: 1 }],
    route_shapes: [{ route_id: '2-FLI', lines: [line] }] });
  const normalized = normalizeGtfsSnapshot(snapshot, parseConnectorInput({
    sourceId: STATIC_SOURCE_ID, window: { kind: 'snapshot', revision: 'latest' },
    checkpoint: null, runId: 'static-test-run',
  }), fetchedAt, { feedVersion: 'archive-sha256:fixture', sourceUpdatedAt: fetchedAt, tripStopMembershipComplete: false });
  const routeGeo = normalized.geoRecords.find(geo => geo.geo_record_id === `${STATIC_SOURCE_ID}:route:2-FLI`);
  const routeFact = normalized.sourceRecords.find(record => record.source_record_id === routeGeo?.geo_record_id);
  assert.ok(routeGeo?.geometry_geojson && routeFact);
  const version = { snapshot: { ...snapshot, trips: [], stop_times: [] }, normalized,
    matchRule: 'latest_published_archive' as const,
    routeShapes: new Map([['2-FLI', { geometryGeojson: routeGeo.geometry_geojson, record: routeFact,
      feedVersion: normalized.feedVersion }]]) };
  const station = (stopId: string, routeId: string | null = '2-FLI'): AlertSelector => ({ agencyId: null, routeId,
    routeType: null, stopId, directionId: 1, tripId: null, tripRouteId: null, tripStartDate: null, tripStartTime: null });
  const join = (selectors: AlertSelector[]) => {
    const alerts = normalizedAlerts(feed(null, selectors));
    return joinGtfsAlertLocations({ alerts: alerts.geoRecords, alertSources: alerts.geoRecordSources,
      staticVersions: [version] });
  };

  const one = join([station('vic:rail:FSS')]);
  assert.equal(one.mappings[0]?.status, 'located');
  assert.equal(one.geoRecords[0]?.centroid_lon, 144.9671);

  const between = join([station('vic:rail:FSS'), station('vic:rail:SSS')]);
  assert.equal(between.mappings[0]?.status, 'route_with_stops');
  assert.deepEqual(between.mappings[0]?.stopIds, ['vic:rail:FSS', 'vic:rail:SSS']);
  assert.deepEqual(JSON.parse(between.geoRecords[0]?.geometry_geojson ?? 'null'),
    { type: 'MultiLineString', coordinates: [line] });
  assert.equal(validateGeoRecordGeography(between.geoRecords[0]!).valid, true);

  // A stop without its route might lie on a line the alert never named, so nothing is drawn.
  const unnamed = join([station('vic:rail:FSS'), station('vic:rail:SSS', null)]);
  assert.equal(unnamed.mappings[0]?.status, 'ambiguous');
  assert.equal(unnamed.geoRecords[0]?.geometry_geojson, null);
});
