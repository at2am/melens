import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { strToU8, zipSync } from 'fflate';

import { fetchOfficialGtfsArchive } from '../../src/connectors/tv_gtfs_static/archive.js';
import {
  SOURCE_ID,
  TvGtfsStaticConnector,
  gtfsRouteTypeToMode,
  normalizeGtfsSnapshot,
  parseGtfsSnapshot,
  parseGtfsZip,
  type GtfsStaticSnapshot,
} from '../../src/connectors/tv_gtfs_static/index.js';
import { parseConnectorInput } from '../../src/core/connector.js';
import { HttpClient, type HttpRequest, type HttpResponse } from '../../src/core/http.js';
import { SourceRegistry, loadConnector, parseSourceManifest } from '../../src/core/registry.js';
import { normalizeAlertFeeds, type ParsedAlertFeed } from '../../src/connectors/tv_gtfs_realtime/index.js';
import { joinGtfsAlertLocations } from '../../src/normalization/gtfs-alerts.js';
import { validateGeoRecordGeography } from '../../src/validation/geography.js';

const input = parseConnectorInput({
  sourceId: SOURCE_ID,
  window: { kind: 'snapshot', revision: 'latest' },
  checkpoint: null,
  runId: 'fixture-test-run',
});
const fetchedAt = '2026-09-29T00:00:00.000Z';

async function loadFixture(): Promise<GtfsStaticSnapshot> {
  const fixtureUrl = new URL('../fixtures/tv_gtfs_static.json', import.meta.url);
  const content = await readFile(fileURLToPath(fixtureUrl), 'utf8');
  return parseGtfsSnapshot(JSON.parse(content));
}

test('registry discovers tv_gtfs_static with review_required status', async () => {
  const manifestUrl = new URL('../../src/connectors/tv_gtfs_static/source.json', import.meta.url);
  const manifest = JSON.parse(await readFile(fileURLToPath(manifestUrl), 'utf8'));
  const dataSource = parseSourceManifest(manifest);

  assert.equal(dataSource.source_id, SOURCE_ID);
  assert.equal(dataSource.license_status, 'review_required');
  assert.equal(dataSource.access_status, 'candidate');
  assert.equal(dataSource.topic, 'transport');
  assert.equal(dataSource.scope, 'victoria');

  const registeredSource = {
    dataSource,
    directory: fileURLToPath(new URL('../../src/connectors/tv_gtfs_static', import.meta.url)),
    manifestPath: fileURLToPath(manifestUrl),
    entrypointPath: fileURLToPath(new URL('../../src/connectors/tv_gtfs_static/index.js', import.meta.url)),
  };
  const registry = new SourceRegistry([registeredSource]);
  const entry = registry.get(SOURCE_ID);

  assert.ok(entry, `Source ${SOURCE_ID} must be registered`);
  assert.equal(entry.dataSource.source_id, SOURCE_ID);

  const connector = await loadConnector(entry);
  assert.equal(connector.sourceId, SOURCE_ID);
  assert.equal(typeof connector.collect, 'function');
});

test('mode mapping correctly translates GTFS route types to canonical modes', () => {
  assert.equal(gtfsRouteTypeToMode(0), 'tram');
  assert.equal(gtfsRouteTypeToMode(1), 'metro');
  assert.equal(gtfsRouteTypeToMode(2), 'train');
  assert.equal(gtfsRouteTypeToMode(3), 'bus');
  assert.equal(gtfsRouteTypeToMode(4), 'ferry');
  assert.equal(gtfsRouteTypeToMode(5), 'cable_tram');
  assert.equal(gtfsRouteTypeToMode(6), 'gondola');
  assert.equal(gtfsRouteTypeToMode(7), 'funicular');
  assert.equal(gtfsRouteTypeToMode(400), 'train');
  assert.equal(gtfsRouteTypeToMode(700), 'bus');
  assert.equal(gtfsRouteTypeToMode(1000), 'ferry');
  assert.equal(gtfsRouteTypeToMode(999), 'other');
});

test('fixture parses timetable version, routes, stops, and links modes to stops', async () => {
  const snapshot = await loadFixture();
  const normalized = normalizeGtfsSnapshot(snapshot, input, fetchedAt);

  assert.equal(normalized.feedVersion, 'PTV_GTFS_20260928_v1');
  assert.equal(normalized.validFrom, '2026-09-28T00:00:00.000Z');
  assert.equal(normalized.validTo, '2026-12-31T23:59:59.000Z');

  // Verify stops are enriched with routes and transport modes
  const flinders = normalized.stops.find(s => s.stop_id === '19499');
  assert.ok(flinders, 'Flinders Street must be present');
  assert.deepEqual(flinders.modes, ['train']);
  assert.deepEqual(flinders.route_ids, ['2-FLI', '2-LIL']);

  const bourkeSwanston = normalized.stops.find(s => s.stop_id === '18260');
  assert.ok(bourkeSwanston, 'Bourke St/Swanston St tram stop must be present');
  assert.deepEqual(bourkeSwanston.modes, ['tram']);
  assert.deepEqual(bourkeSwanston.route_ids, ['3-19', '3-96']);

  const melbCentralBus = normalized.stops.find(s => s.stop_id === '20500');
  assert.ok(melbCentralBus, 'Melbourne Central bus stop must be present');
  assert.deepEqual(melbCentralBus.modes, ['bus']);
  assert.deepEqual(melbCentralBus.route_ids, ['4-200']);
});

test('normalized records produce valid geography and retain review_required gate', async () => {
  const snapshot = await loadFixture();
  const normalized = normalizeGtfsSnapshot(snapshot, input, fetchedAt);

  assert.equal(normalized.geoRecords.length, snapshot.stops.length);
  for (const geo of normalized.geoRecords) {
    assert.equal(geo.rights_status, 'review_required');
    assert.equal(geo.public_query_allowed, false);
    assert.equal(geo.topic, 'transport');
    assert.equal(geo.location_role, 'sensor_site');
    assert.equal(geo.location_confidence, 'source_coordinate');

    const validation = validateGeoRecordGeography(geo);
    assert.equal(validation.valid, true, `Geography must be valid for stop ${geo.title}: ${validation.issues.join(', ')}`);
    assert.ok(validation.geographicRecord !== null);
  }

  // Check source records integrity
  assert.equal(normalized.sourceRecords.length, 1 + snapshot.routes.length + snapshot.stops.length);
  for (const record of normalized.sourceRecords) {
    assert.equal(record.rights_status, 'review_required');
    assert.equal(record.record_status, 'active');
    assert.ok(record.source_record_id.startsWith(SOURCE_ID));
  }

  // Check geoRecordSources links: official_stop_location and serving_route
  const stopLinks = normalized.geoRecordSources.filter(l => l.evidence_role === 'official_stop_location');
  const routeLinks = normalized.geoRecordSources.filter(l => l.evidence_role === 'serving_route');
  assert.equal(stopLinks.length, snapshot.stops.length);
  assert.ok(routeLinks.length > 0, 'Serving route links must be present');
});

test('connector collect execution succeeds and returns complete feed_snapshot', async () => {
  const snapshot = await loadFixture();
  const connector = new TvGtfsStaticConnector(async () => snapshot);
  const result = await connector.collect(input);

  assert.equal(result.kind, 'success');
  if (result.kind === 'success') {
    assert.equal(result.sourceId, SOURCE_ID);
    assert.equal(result.completeness.complete, true);
    assert.equal(result.completeness.method, 'feed_snapshot');
    assert.equal(result.geoRecords.length, snapshot.stops.length);
    assert.equal(result.sourceRecords.length, 1 + snapshot.routes.length + snapshot.stops.length);
    assert.equal(result.sourceRevision, 'PTV_GTFS_20260928_v1');
    assert.equal(result.sourceLatestUpdateAt, '2026-09-28T00:00:00.000Z');
  }

  // A provider that returns no archive must fail closed.
  const unavailableConnector = new TvGtfsStaticConnector(async () => null);
  const autoResult = await unavailableConnector.collect(input);
  assert.equal(autoResult.kind, 'failure');
  if (autoResult.kind === 'failure') assert.equal(autoResult.code, 'upstream_unavailable');
});

function modeArchive(mode: 2 | 3): Uint8Array {
  const routeType = mode === 2 ? 2 : 0;
  return zipSync({
    'routes.txt': strToU8(`route_id,route_short_name,route_type\n${mode}-r,R${mode},${routeType}\n`),
    'stops.txt': strToU8(`stop_id,stop_name,stop_lat,stop_lon\n${mode}-s,Stop ${mode},-37.8,144.96\n`),
    'trips.txt': strToU8(`route_id,trip_id,service_id\n${mode}-r,${mode}-t,weekday\n`),
    'stop_times.txt': strToU8(`trip_id,arrival_time,departure_time,stop_id,stop_sequence\n${mode}-t,12:00:00,12:00:00,${mode}-s,1\n${mode}-t,13:00:00,13:00:00,${mode}-s,1\n`),
  }, { level: 6 });
}

class ArchiveRangeClient extends HttpClient {
  readonly ranges: string[] = [];
  changed = false;

  constructor(protected readonly archive: Uint8Array) { super(); }

  override async getStream(request: HttpRequest): Promise<HttpResponse<ReadableStream<Uint8Array<ArrayBuffer>>>> {
    const headers = new Headers(request.headers);
    const range = headers.get('Range');
    assert.ok(range);
    this.ranges.push(range);
    const ifRange = headers.get('If-Range');
    const full = this.changed && ifRange ? true : false;
    const match = /^bytes=(\d+)-(\d+)$/.exec(range);
    const start = match ? Number(match[1]) : Math.max(0, this.archive.length - 262144);
    const end = match ? Number(match[2]) : this.archive.length - 1;
    const boundedEnd = Math.min(end, this.archive.length - 1);
    const body = full ? this.archive : this.archive.subarray(start, boundedEnd + 1);
    const stream = new ReadableStream<Uint8Array<ArrayBuffer>>({ start(controller) {
      controller.enqueue(Uint8Array.from(body));
      controller.close();
    } });
    return { body: stream, status: full ? 200 : 206,
      fetchedAt: '2026-09-29T01:00:00.000Z', etag: '"test-archive"',
      lastModified: 'Tue, 29 Sep 2026 00:00:00 GMT', contentType: 'application/zip',
      contentRange: `bytes ${start}-${boundedEnd}/${this.archive.length}` };
  }
}

test('official nested GTFS archive is read through bounded ranges with provenance', async () => {
  const archive = zipSync({
    '1/google_transit.zip': modeArchive(2),
    '2/google_transit.zip': modeArchive(2),
    '3/google_transit.zip': modeArchive(3),
  }, { level: 6 });
  const client = new ArchiveRangeClient(archive);
  const result = await fetchOfficialGtfsArchive(client, 'https://example.test/gtfs.zip');
  assert.equal(client.ranges.length, 5);
  assert.equal(result.raw.routes.length, 2);
  assert.equal(result.raw.stops.length, 2);
  assert.equal(result.raw.trips.length, 2);
  assert.equal(result.raw.stop_times.length, 2);
  assert.equal(result.routeStopPairs, 2);
  assert.equal(result.sourceUpdatedAt, '2026-09-29T00:00:00.000Z');
  assert.match(result.archiveVersion, /^archive-sha256:[a-f0-9]{64}$/);
  assert.equal(result.tripStopMembershipComplete, false);

  const normalized = await new TvGtfsStaticConnector(async () => result).collect(input);
  assert.equal(normalized.kind, 'success');
  if (normalized.kind === 'success') {
    assert.equal(normalized.geoRecords.length, 2);
    assert.equal(normalized.sourceLatestUpdateAt, '2026-09-29T00:00:00.000Z');
    assert.equal(normalized.sourceRevision, result.archiveVersion);
    assert.equal(normalized.completeness.complete, true);
  }
});

test('official archive rejects a changed range response', async () => {
  const archive = zipSync({
    '2/google_transit.zip': modeArchive(2),
    '3/google_transit.zip': modeArchive(3),
  });
  const client = new ArchiveRangeClient(archive);
  client.changed = true;
  await assert.rejects(fetchOfficialGtfsArchive(client, 'https://example.test/gtfs.zip'),
    /archive changed or server ignored byte range/);
});

test('referential integrity violation in trips or stops triggers validation failure', async () => {
  const snapshot = await loadFixture();
  const badSnapshot: GtfsStaticSnapshot = {
    ...snapshot,
    trips: [
      ...snapshot.trips,
      { route_id: 'non-existent-route', trip_id: 'bad-trip', service_id: null, trip_headsign: null, direction_id: null },
    ],
  };

  const connector = new TvGtfsStaticConnector(async () => badSnapshot);
  const result = await connector.collect(input);

  assert.equal(result.kind, 'failure');
  if (result.kind === 'failure') {
    assert.equal(result.code, 'validation_failed');
    assert.ok(result.message.includes('unknown route'));
  }
});

test('stop_times cannot claim a complete schedule when their trip is absent', async () => {
  const snapshot = await loadFixture();
  const connector = new TvGtfsStaticConnector(async () => ({ ...snapshot,
    stop_times: [...snapshot.stop_times, { trip_id: 'missing-trip', stop_id: '19499' }],
  }));
  const result = await connector.collect(input);
  assert.equal(result.kind, 'failure');
  if (result.kind === 'failure') {
    assert.equal(result.code, 'validation_failed');
    assert.match(result.message, /unknown trip/);
  }
});

test('a GTFS ZIP cannot silently select one of two tables with the same name', () => {
  const archive = zipSync({
    'a/routes.txt': strToU8('route_id,route_type\na,2\n'),
    'b/routes.txt': strToU8('route_id,route_type\nb,2\n'),
    'stops.txt': strToU8('stop_id,stop_name,stop_lat,stop_lon\ns,Stop,-37.8,144.96\n'),
  });
  assert.throws(() => parseGtfsZip(archive), /Duplicate GTFS table: routes\.txt/);
});

test('official nested mode ZIP rejects duplicate table names', async () => {
  const duplicateMode = zipSync({
    'a/routes.txt': strToU8('route_id,route_type\na,2\n'),
    'b/routes.txt': strToU8('route_id,route_type\nb,2\n'),
    'stops.txt': strToU8('stop_id,stop_name,stop_lat,stop_lon\ns,Stop,-37.8,144.96\n'),
    'trips.txt': strToU8('route_id,trip_id\nb,t\n'),
    'stop_times.txt': strToU8('trip_id,stop_id\nt,s\n'),
  });
  const archive = zipSync({
    '2/google_transit.zip': duplicateMode,
    '3/google_transit.zip': modeArchive(3),
  });
  await assert.rejects(fetchOfficialGtfsArchive(new ArchiveRangeClient(archive),
    'https://example.test/gtfs.zip'), /duplicate GTFS table: routes\.txt/);
});

test('official archive rejects a range response with corrupted entry CRC32 checksum', async () => {
  const archive = zipSync({
    '2/google_transit.zip': modeArchive(2),
    '3/google_transit.zip': modeArchive(3),
  }, { level: 0 });
  class CorruptChecksumClient extends ArchiveRangeClient {
    override async getStream(request: HttpRequest) {
      const res = await super.getStream(request);
      const reader = res.body.getReader();
      const chunks: Uint8Array[] = [];
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        chunks.push(part.value);
      }
      const combined = Buffer.concat(chunks);
      // Corrupt a byte in the payload range fetch for 2/google_transit.zip (range 3)
      if (this.ranges.length === 3 && combined.length > 50) {
        const idx = Math.floor(combined.length / 2);
        const val = combined[idx];
        if (val !== undefined) combined[idx] = val ^ 0xff;
      }
      const stream = new ReadableStream<Uint8Array<ArrayBuffer>>({ start(c) { c.enqueue(combined); c.close(); } });
      return { ...res, body: stream };
    }
  }
  const client = new CorruptChecksumClient(archive);
  await assert.rejects(
    fetchOfficialGtfsArchive(client, 'https://example.test/gtfs.zip'),
    /checksum or size mismatch|unsupported or oversized ZIP entry/,
  );
});

test('official archive rejects a range response with corrupted local header', async () => {
  const archive = zipSync({
    '2/google_transit.zip': modeArchive(2),
    '3/google_transit.zip': modeArchive(3),
  });
  class CorruptHeaderClient extends ArchiveRangeClient {
    override async getStream(request: HttpRequest) {
      const res = await super.getStream(request);
      const reader = res.body.getReader();
      const chunks: Uint8Array[] = [];
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        chunks.push(part.value);
      }
      const combined = Buffer.concat(chunks);
      // Corrupt local header signature for the first entry header request (which is range 2)
      if (this.ranges.length === 2 && combined.length >= 4) {
        combined[0] = 0x00;
        combined[1] = 0x00;
      }
      const stream = new ReadableStream<Uint8Array<ArrayBuffer>>({ start(c) { c.enqueue(combined); c.close(); } });
      return { ...res, body: stream };
    }
  }
  const client = new CorruptHeaderClient(archive);
  await assert.rejects(
    fetchOfficialGtfsArchive(client, 'https://example.test/gtfs.zip'),
    /local header mismatch/,
  );
});

test('official archive rejects a server response without strong validator', async () => {
  const archive = zipSync({
    '2/google_transit.zip': modeArchive(2),
    '3/google_transit.zip': modeArchive(3),
  });
  class NoValidatorClient extends ArchiveRangeClient {
    override async getStream(request: HttpRequest) {
      const res = await super.getStream(request);
      return { ...res, etag: null, lastModified: null };
    }
  }
  const client = new NoValidatorClient(archive);
  await assert.rejects(
    fetchOfficialGtfsArchive(client, 'https://example.test/gtfs.zip'),
    /server did not provide archive validator/,
  );
});

test('official archive rejects Content-Range header mismatch', async () => {
  const archive = zipSync({
    '2/google_transit.zip': modeArchive(2),
    '3/google_transit.zip': modeArchive(3),
  });
  class BadContentRangeClient extends ArchiveRangeClient {
    override async getStream(request: HttpRequest) {
      const res = await super.getStream(request);
      return { ...res, contentRange: `bytes 0-100/${this.archive.length}` };
    }
  }
  const client = new BadContentRangeClient(archive);
  await assert.rejects(
    fetchOfficialGtfsArchive(client, 'https://example.test/gtfs.zip'),
    /Content-Range or response length mismatch/,
  );
});

test('missing feed_info in official archive fails closed on calendar validity and cannot counterfeit GTFS version for alert joins', async () => {
  const archive = zipSync({
    '2/google_transit.zip': modeArchive(2),
    '3/google_transit.zip': modeArchive(3),
  }, { level: 6 });
  const client = new ArchiveRangeClient(archive);
  const result = await fetchOfficialGtfsArchive(client, 'https://example.test/gtfs.zip');

  // 1. Upstream nested archives lack feed_info.txt
  assert.equal(result.raw.feed_info.length, 0);

  // 2. Normalization fails closed on timetable validity window
  const normalized = normalizeGtfsSnapshot(parseGtfsSnapshot(result.raw), input, result.fetchedAt, {
    feedVersion: result.archiveVersion,
    sourceUpdatedAt: result.sourceUpdatedAt,
    tripStopMembershipComplete: result.tripStopMembershipComplete,
  });
  assert.equal(normalized.validFrom, null);
  assert.equal(normalized.validTo, null);
  assert.equal(normalized.tripStopMembershipComplete, false);

  const versionRecord = normalized.sourceRecords.find(r => r.source_record_id.includes('feed_version'));
  assert.ok(versionRecord);
  assert.equal(versionRecord.valid_from, null);
  assert.equal(versionRecord.valid_to, null);
  assert.equal(versionRecord.time_missing_reason, 'Feed info does not specify calendar start date');

  // 3. The archive revision hash starts with archive-sha256: and is derived from HTTP validator
  assert.match(normalized.feedVersion, /^archive-sha256:[a-f0-9]{64}$/);

  // 4. Alert join fails closed when static archive lacks feed_info (cannot fake GTFS version with archive ETag)
  const alertInput = parseConnectorInput({
    sourceId: 'victoria.transport.gtfs_realtime',
    window: { kind: 'snapshot', revision: '2026-09-29T01:00:00.000Z' },
    checkpoint: null,
    runId: 'alert-run',
  });
  const mockFeed: ParsedAlertFeed = {
    gtfsRealtimeVersion: '2.0',
    feedTimestamp: '2026-09-29T01:00:00.000Z',
    feedVersion: normalized.feedVersion,
    alerts: [{
      id: 'ALT-1',
      activePeriods: [],
      communicationPeriods: [],
      impactPeriods: [],
      selectors: [{
        agencyId: '2',
        routeId: '2-r',
        routeType: 2,
        stopId: '2-s',
        directionId: null,
        tripId: null,
        tripRouteId: null,
        tripStartDate: null,
        tripStartTime: null,
      }],
      cause: null,
      effect: 1,
      header: 'Disruption',
      description: null,
      url: null,
    }],
  };
  const normalizedAlertsResult = normalizeAlertFeeds([
    { mode: 'metro_train', resourceUrl: 'https://example.test/metro', parsed: mockFeed, fetchedAt: result.fetchedAt },
  ], alertInput);

  const joined = joinGtfsAlertLocations({
    alerts: normalizedAlertsResult.geoRecords,
    alertSources: normalizedAlertsResult.geoRecordSources,
    staticVersions: [{
      snapshot: parseGtfsSnapshot(result.raw),
      normalized,
    }],
  });

  // Must fail closed to version_unverified with no coordinates invented
  assert.equal(joined.mappings[0]?.status, 'version_unverified');
  assert.equal(joined.geoRecords[0]?.geometry_geojson, null);

  // Even if alert attempts to use raw ETag string, it fails closed
  const etagFeed: ParsedAlertFeed = {
    ...mockFeed,
    feedVersion: '"test-archive"',
  };
  const etagAlerts = normalizeAlertFeeds([
    { mode: 'metro_train', resourceUrl: 'https://example.test/metro', parsed: etagFeed, fetchedAt: result.fetchedAt },
  ], alertInput);
  const etagJoined = joinGtfsAlertLocations({
    alerts: etagAlerts.geoRecords,
    alertSources: etagAlerts.geoRecordSources,
    staticVersions: [{
      snapshot: parseGtfsSnapshot(result.raw),
      normalized,
    }],
  });
  assert.equal(etagJoined.mappings[0]?.status, 'version_unverified');
  assert.equal(etagJoined.geoRecords[0]?.geometry_geojson, null);
});
