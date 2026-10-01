import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

import { z } from 'zod';

import { connector as minuteConnector } from '../../src/connectors/com_pedestrian_minute/index.js';
import {
  PedestrianHourlyConnector,
  SOURCE_ID as HOURLY_SOURCE_ID,
} from '../../src/connectors/com_pedestrian_hourly/index.js';
import {
  PedestrianLocationsConnector,
  SOURCE_ID as LOCATION_SOURCE_ID,
} from '../../src/connectors/com_pedestrian_locations/index.js';
import {
  normalizeRoadSnapshot,
  parseRoadPage,
} from '../../src/connectors/tv_road_unplanned/index.js';
import {
  normalizeGtfsSnapshot,
  parseGtfsSnapshot,
  SOURCE_ID as STATIC_SOURCE_ID,
} from '../../src/connectors/tv_gtfs_static/index.js';
import {
  normalizeAlertFeeds,
  parseAlertFeed,
  SOURCE_ID as REALTIME_SOURCE_ID,
  type ParsedAlertFeed,
} from '../../src/connectors/tv_gtfs_realtime/index.js';
import { parseConnectorInput } from '../../src/core/connector.js';
import { OpenDataSoftClient, type OdsQuery, type OdsRecords } from '../../src/core/opendatasoft.js';
import { joinGtfsAlertLocations } from '../../src/normalization/gtfs-alerts.js';
import { joinPedestrianObservations } from '../../src/normalization/pedestrian.js';
import { validateGeoRecordGeography } from '../../src/validation/geography.js';

/**
 * T069 is an offline prerequisite proof for UC-04/UC-05. These fixtures and
 * synthetic transitions cannot establish a live KeyID fetch, a published
 * BigQuery batch, or the product's end-to-end P0 acceptance.
 */
const fixturePageSchema = z.object({
  total_count: z.number().int().nonnegative(),
  results: z.array(z.record(z.string(), z.unknown())),
});

async function fixture(name: string): Promise<unknown> {
  return JSON.parse(await readFile(new URL(`../fixtures/${name}`, import.meta.url), 'utf8'));
}

class FixtureOdsClient extends OpenDataSoftClient {
  constructor(
    private readonly records: readonly unknown[],
    private readonly fetchedAt: string,
  ) { super(); }

  override async fetchRecords(_query: OdsQuery): Promise<OdsRecords> {
    return {
      records: [...this.records],
      totalCount: this.records.length,
      pageCount: 1,
      fetchedAt: this.fetchedAt,
      lastModified: null,
    };
  }
}

test('T069 offline UC-04: minute and hour observations retain source time and location version without zero filling', async t => {
  const minutePage = fixturePageSchema.parse(await fixture('com_pedestrian_minute.json'));
  const locationPage = fixturePageSchema.parse(await fixture('com_pedestrian_locations.json'));
  const hourlyPage = fixturePageSchema.parse(await fixture('com_pedestrian_hourly.json'));
  const originalLocation = locationPage.results.find(row => row.location_id === 3);
  assert.ok(originalLocation);

  // The explicit effective date on this synthetic second snapshot is evidence
  // of a move. The live source's natural-language notes are not such evidence.
  const movedLocation = {
    ...originalLocation,
    valid_from: '2026-09-28T14:00:00.000Z',
    latitude: -37.815,
    longitude: 144.97,
    location: { lat: -37.815, lon: 144.97 },
  };
  const firstConnector = new PedestrianLocationsConnector({
    client: new FixtureOdsClient([originalLocation], '2026-09-28T13:58:00.000Z'),
    isolated: true,
  });
  const locationInput = parseConnectorInput({ sourceId: LOCATION_SOURCE_ID,
    window: { kind: 'snapshot', revision: 'latest' }, checkpoint: null,
    runId: 'p0-location-first' });
  const firstLocations = await firstConnector.collect(locationInput);
  assert.equal(firstLocations.kind, 'success');
  if (firstLocations.kind !== 'success') return;
  const secondConnector = new PedestrianLocationsConnector({
    client: new FixtureOdsClient([movedLocation], '2026-09-28T14:01:00.000Z'),
    previousLocations: firstLocations.sensorLocations,
    isolated: true,
  });
  const secondLocations = await secondConnector.collect({ ...locationInput, runId: 'p0-location-second' });
  assert.equal(secondLocations.kind, 'success');
  if (secondLocations.kind !== 'success') return;
  const locations = secondConnector.getAllLocations();
  assert.equal(locations.length, 2);
  assert.equal(locations[0]?.valid_to, '2026-09-28T14:00:00.000Z');
  assert.equal(locations[1]?.valid_from, '2026-09-28T14:00:00.000Z');
  assert.notEqual(locations[0]?.version_id, locations[1]?.version_id);
  assert.equal(secondLocations.geoRecordSources[0]?.evidence_role, 'official_sensor_location');

  // Use the real minute connector against an isolated in-process HTTP response.
  // One missing minute and one present null reading must remain distinct.
  const nullMinute = { location_id: 3,
    sensing_datetime: '2026-09-28T14:02:00+00:00',
    direction_1: null, direction_2: null, total_of_directions: null };
  const minuteRows = [...minutePage.results, nullMinute];
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    assert.match(url.pathname, /pedestrian-counting-system-past-hour-counts-per-minute/);
    const latest = url.searchParams.get('order_by') === 'sensing_datetime DESC';
    const body = latest
      ? { total_count: 1, results: [nullMinute] }
      : { total_count: minuteRows.length, results: minuteRows };
    return new Response(JSON.stringify(body), {
      status: 200, headers: { 'content-type': 'application/json' },
    });
  });
  const minute = await minuteConnector.collect(parseConnectorInput({
    sourceId: 'melbourne.pedestrian.minute',
    window: { kind: 'time', from: '2026-09-28T13:59:00.000Z',
      to: '2026-09-28T14:03:00.000Z' },
    checkpoint: null, runId: 'p0-minute',
  }));
  assert.equal(minute.kind, 'success');
  if (minute.kind !== 'success') return;
  assert.equal(minute.pedestrianObservations.length, 3);
  assert.deepEqual(minute.pedestrianObservations.map(row => row.observed_at), [
    '2026-09-28T13:59:00.000Z', '2026-09-28T14:00:00.000Z',
    '2026-09-28T14:02:00.000Z',
  ]);
  assert.equal(minute.pedestrianObservations[2]?.total_count, null);
  assert.equal(minute.pedestrianObservations[0]?.direction_b_count, 0);
  assert.equal(minute.sourceRecords[0]?.observed_at, minute.pedestrianObservations[0]?.observed_at);
  assert.equal(minute.sourceLatestUpdateAt, '2026-09-28T14:02:00.000Z');

  const minuteJoined = joinPedestrianObservations({
    observations: minute.pedestrianObservations, locations, granularity: 'minute',
  });
  assert.deepEqual(minuteJoined.map(row => row.locationStatus), ['located', 'located', 'located']);
  assert.equal(minuteJoined[0]?.location?.version_id, locations[0]?.version_id);
  assert.equal(minuteJoined[1]?.location?.version_id, locations[1]?.version_id);
  assert.equal(minuteJoined[2]?.observation.total_count, null);
  assert.ok(!minuteJoined.some(row => row.observation.observed_at === '2026-09-28T14:01:00.000Z'));

  const originalHourly = hourlyPage.results[0];
  assert.ok(originalHourly);
  const hourlyRow = { ...originalHourly, id: 32026092823,
    location_id: 3, sensing_date: '2026-09-28', hourday: 23 };
  const hourlyConnector = new PedestrianHourlyConnector({
    client: new FixtureOdsClient([hourlyRow], '2026-09-29T00:00:00.000Z'),
  });
  const hourly = await hourlyConnector.collect(parseConnectorInput({
    sourceId: HOURLY_SOURCE_ID,
    window: { kind: 'time', from: '2026-09-28T13:00:00.000Z',
      to: '2026-09-28T14:00:00.000Z' },
    checkpoint: null, runId: 'p0-hourly',
  }));
  assert.equal(hourly.kind, 'success');
  if (hourly.kind !== 'success') return;
  assert.equal(hourly.pedestrianObservations.length, 1);
  const hourlyJoined = joinPedestrianObservations({
    observations: hourly.pedestrianObservations, locations, granularity: 'hour',
  });
  assert.equal(hourlyJoined[0]?.observation.observed_at, '2026-09-28T13:00:00.000Z');
  // The hour predates the first location snapshot; installation date does not
  // establish where this sensor was during that earlier hour.
  assert.equal(hourlyJoined[0]?.locationStatus, 'unlocated');
  assert.equal(hourlyJoined[0]?.location, null);
  assert.equal(hourlyJoined[0]?.granularity, 'hour');
  assert.equal(hourlyJoined[0]?.observation.total_count, 94);
  assert.equal(hourly.sourceRecords[0]?.observed_at, hourlyJoined[0]?.observation.observed_at);
  assert.equal(minuteJoined.length + hourlyJoined.length, 4);
});

test('T069 offline UC-05: unplanned road impacts preserve event time and source geography', async () => {
  const page = parseRoadPage(await fixture('tv_road_unplanned.json'));
  const normalized = normalizeRoadSnapshot(page.data.features, parseConnectorInput({
    sourceId: 'victoria.transport.road_unplanned',
    window: { kind: 'snapshot', revision: 'fixture' },
    checkpoint: null, runId: 'p0-road',
  }), '2026-09-28T00:08:00.000Z');
  assert.equal(normalized.latestUpdate, '2026-09-28T00:05:00.000Z');
  assert.equal(normalized.geoRecords.length, 2);
  const active = normalized.geoRecords.find(row => row.record_status === 'active');
  const resolved = normalized.geoRecords.find(row => row.record_status === 'resolved');
  assert.ok(active);
  assert.ok(resolved);
  assert.equal(active.observed_at, '2026-09-28T00:00:00.000Z');
  assert.equal(active.source_updated_at, '2026-09-28T00:01:00.000Z');
  assert.equal(active.location_role, 'event_site');
  assert.equal(active.location_confidence, 'source_coordinate');
  assert.equal(validateGeoRecordGeography(active).valid, true);
  assert.equal(resolved.valid_to, '2026-09-28T00:04:00.000Z');
  assert.equal(validateGeoRecordGeography(resolved).valid, true);
  assert.ok(normalized.geoRecordSources.some(link => link.geo_record_id === active.geo_record_id
    && link.evidence_role === 'parent_incident'));
  assert.ok(normalized.geoRecordSources.some(link => link.geo_record_id === active.geo_record_id
    && link.evidence_role === 'child_impact'));
});

test('T069 offline UC-05: a static stop locates a matching alert, while absent evidence keeps alerts unlocated', async () => {
  const snapshot = parseGtfsSnapshot(await fixture('tv_gtfs_static.json'));
  const normalized = normalizeGtfsSnapshot(snapshot, parseConnectorInput({
    sourceId: STATIC_SOURCE_ID,
    window: { kind: 'snapshot', revision: 'latest' },
    checkpoint: null, runId: 'p0-gtfs-static',
  }), '2026-09-28T00:06:00.000Z');
  assert.equal(normalized.feedVersion, 'PTV_GTFS_20260928_v1');
  assert.equal(normalized.validFrom, '2026-09-28T00:00:00.000Z');
  const stop = normalized.geoRecords.find(row => row.geo_record_id === `${STATIC_SOURCE_ID}:stop:19499`);
  assert.ok(stop);
  assert.equal(stop.location_role, 'sensor_site');
  assert.equal(stop.location_confidence, 'source_coordinate');
  assert.equal(validateGeoRecordGeography(stop).valid, true);

  const feed: ParsedAlertFeed = {
    gtfsRealtimeVersion: '2.0',
    feedTimestamp: '2026-09-28T00:05:00.000Z',
    feedVersion: normalized.feedVersion,
    alerts: [{
      id: 'P0-SYNTHETIC-STOP',
      activePeriods: [], communicationPeriods: [],
      impactPeriods: [{ start: '2026-09-28T00:05:00.000Z', end: '2026-09-28T01:30:00.000Z' }],
      selectors: [{ agencyId: '2', routeId: '2-FLI', routeType: 2,
        stopId: '19499', directionId: 0, tripId: 'TRIP-FLI-01',
        tripRouteId: '2-FLI', tripStartDate: null, tripStartTime: null }],
      cause: null, effect: 1, header: 'Synthetic rail alert',
      description: null, url: null,
    }],
  };
  const rtInput = parseConnectorInput({ sourceId: REALTIME_SOURCE_ID,
    window: { kind: 'snapshot', revision: 'fixture' },
    checkpoint: null, runId: 'p0-gtfs-realtime' });
  function joinedFor(candidate: ParsedAlertFeed) {
    const realtime = normalizeAlertFeeds([{ mode: 'metro_train',
      resourceUrl: 'https://opendata.transport.vic.gov.au/dataset/gtfs-realtime',
      parsed: candidate, fetchedAt: '2026-09-28T00:08:00.000Z' }], rtInput);
    return { realtime, joined: joinGtfsAlertLocations({ alerts: realtime.geoRecords,
      alertSources: realtime.geoRecordSources,
      staticVersions: [{ snapshot, normalized }] }) };
  }
  const { realtime, joined } = joinedFor(feed);
  assert.equal(realtime.latestUpdate, feed.feedTimestamp);
  assert.equal(realtime.geoRecords[0]?.observed_at, null);
  assert.equal(realtime.geoRecords[0]?.source_updated_at, feed.feedTimestamp);
  assert.equal(realtime.geoRecords[0]?.valid_from, feed.alerts[0]?.impactPeriods[0]?.start);
  assert.equal(joined.mappings[0]?.status, 'located');
  assert.equal(joined.geoRecords[0]?.geometry_geojson, stop.geometry_geojson);
  assert.equal(joined.geoRecords[0]?.location_confidence, 'official_join');
  assert.ok(joined.geoRecordSources.some(link => link.evidence_role === 'gtfs_static_stop_location'
    && link.source_record_id === stop.geo_record_id));

  const unknown = joinedFor({ ...feed, alerts: [{ ...feed.alerts[0]!,
    selectors: [{ ...feed.alerts[0]!.selectors[0]!, stopId: 'UNKNOWN-STOP' }] }] });
  assert.equal(unknown.joined.mappings[0]?.status, 'unmapped');
  assert.equal(unknown.joined.geoRecords[0]?.geometry_geojson, null);
  const wrongVersion = joinedFor({ ...feed, feedVersion: 'unverified-version' });
  assert.equal(wrongVersion.joined.mappings[0]?.status, 'version_unverified');
  assert.equal(wrongVersion.joined.geoRecords[0]?.geometry_geojson, null);

  // The supplied protobuf fixture also exercises the decoder; its different
  // archive version has no justified coordinate in this static fixture.
  const encoded = z.object({ metro_feed_base64: z.string() }).parse(await fixture('tv_gtfs_realtime.json'));
  const decoded = parseAlertFeed(Buffer.from(encoded.metro_feed_base64, 'base64'));
  assert.ok(decoded.feedTimestamp);
  assert.ok(decoded.alerts.length > 0);
  const native = joinedFor(decoded);
  assert.equal(native.joined.mappings[0]?.status, 'version_unverified');
  assert.equal(native.joined.geoRecords[0]?.geometry_geojson, null);
});
