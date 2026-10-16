import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { isConnector, parseConnectorInput } from '../../src/core/connector.js';
import { HttpClient, HttpFailure } from '../../src/core/http.js';
import { loadConnector, loadSourceRegistry } from '../../src/core/registry.js';
import {
  BASE_URL,
  FEEDS,
  LANDING_URL,
  MAX_FEED_BYTES,
  SOURCE_ID,
  TransportGtfsRealtimeConnector,
  WireReader,
  normalizeAlertFeeds,
  parseAlertFeed,
  parsePeriod,
  parseSelector,
  singlePeriod,
} from '../../src/connectors/tv_gtfs_realtime/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const input = parseConnectorInput({ sourceId: 'victoria.transport.gtfs_realtime',
  window: { kind: 'time', from: '2026-09-28T00:00:00Z', to: '2026-09-28T00:15:00Z' },
  checkpoint: '2026-09-28T00:00:00Z', runId: 'gtfs-fixture-run' });
const fetchedAt = '2026-09-28T00:08:00Z';

interface Fixture {
  metro_feed_base64: string;
  tram_feed_base64: string;
  empty_feed_base64: string;
  differential_feed_base64: string;
  deleted_full_feed_base64: string;
}

async function fixture(): Promise<Fixture> {
  return JSON.parse(await readFile(new URL('../fixtures/tv_gtfs_realtime.json', import.meta.url), 'utf8'));
}

test('protobuf parser retains route, stop, trip, impact periods and NO_SERVICE effect', async () => {
  const data = await fixture();
  const metro = parseAlertFeed(Buffer.from(data.metro_feed_base64, 'base64'));
  const tram = parseAlertFeed(Buffer.from(data.tram_feed_base64, 'base64'));
  assert.equal(metro.gtfsRealtimeVersion, '2.0');
  assert.equal(metro.feedTimestamp, '2026-09-28T00:05:00.000Z');
  assert.equal(metro.alerts[0]?.id, 'M-17');
  assert.equal(metro.alerts[0]?.selectors[0]?.routeId, 'R-METRO');
  assert.equal(metro.alerts[0]?.selectors[0]?.stopId, 'STOP-1');
  assert.equal(metro.alerts[0]?.selectors[0]?.tripId, 'TRIP-1');
  assert.equal(metro.alerts[0]?.selectors[0]?.directionId, 1);
  assert.deepEqual(metro.alerts[0]?.impactPeriods, [{
    start: '2026-09-28T00:10:00.000Z', end: '2026-09-28T00:30:00.000Z',
  }]);
  assert.equal(metro.alerts[0]?.effect, 1);
  assert.equal(tram.alerts[0]?.impactPeriods.length, 2);
});

test('normalization keeps each mode snapshot parent and does not invent a stop position or cancellation', async () => {
  const data = await fixture();
  const normalized = normalizeAlertFeeds([
    { mode: 'metro_train', resourceUrl: 'https://example.com/metro',
      parsed: parseAlertFeed(Buffer.from(data.metro_feed_base64, 'base64')), fetchedAt },
    { mode: 'yarra_tram', resourceUrl: 'https://example.com/tram',
      parsed: parseAlertFeed(Buffer.from(data.tram_feed_base64, 'base64')), fetchedAt },
  ], input);
  assert.equal(normalized.sourceRecords.length, 4);
  assert.equal(normalized.geoRecords.length, 2);
  assert.equal(normalized.geoRecordSources.filter(link =>
    link.evidence_role === 'parent_feed_snapshot').length, 2);
  assert.equal(normalized.geoRecordSources.filter(link =>
    link.evidence_role === 'alert_entity').length, 2);
  const metro = normalized.geoRecords[0];
  assert.equal(metro?.record_status, 'active');
  assert.equal(metro?.geometry_geojson, null);
  assert.equal(metro?.location_confidence, 'unverified');
  assert.equal(metro?.valid_from, '2026-09-28T00:10:00.000Z');
  assert.equal(metro?.valid_to, '2026-09-28T00:30:00.000Z');
  assert.equal(metro?.public_query_allowed, true);
  assert.equal(metro?.rights_status, 'verified_open');
  const tram = normalized.geoRecords[1];
  assert.equal(tram?.valid_from, null);
  assert.equal(tram?.valid_to, null);
  assert.equal(JSON.parse(tram?.summary ?? '{}').impact_periods.length, 2);

  const metroFeed = parseAlertFeed(Buffer.from(data.metro_feed_base64, 'base64'));
  const displayOnly = normalizeAlertFeeds([{ mode: 'metro_train',
    resourceUrl: 'https://example.com/metro', fetchedAt,
    parsed: { ...metroFeed, alerts: metroFeed.alerts.map(alert =>
      ({ ...alert, impactPeriods: [] })) },
  }], input);
  assert.equal(displayOnly.geoRecords[0]?.valid_from, null);
  assert.equal(displayOnly.geoRecords[0]?.valid_to, null);
  assert.equal(JSON.parse(displayOnly.geoRecords[0]?.summary ?? '{}').active_periods.length, 1);
});

test('connector requires both advertised Service Alerts feeds and a KeyID', async () => {
  const data = await fixture();
  const urls: string[] = [];
  class FixtureClient extends HttpClient {
    override async getBytes(request: { url: URL; headers?: HeadersInit }) {
      assert.deepEqual(request.headers, { KeyID: 'fixture-key' });
      urls.push(request.url.toString());
      return { body: Buffer.from(urls.length === 1 ? data.metro_feed_base64
        : data.tram_feed_base64, 'base64'), status: 200, fetchedAt,
      etag: null, lastModified: null, contentType: 'application/x-protobuf' };
    }
  }
  const result = await new TransportGtfsRealtimeConnector(new FixtureClient(),
    () => 'fixture-key').collect(input);
  assert.equal(result.kind, 'success');
  if (result.kind === 'success') {
    assert.equal(result.completeness.fetched_pages, 2);
    assert.equal(result.geoRecords.length, 2);
    assert.equal(result.checkpointAfter, '2026-09-28T00:15:00Z');
  }
  assert.equal(urls.length, 2);
  assert.equal(urls[0]?.endsWith('/metro/service-alerts'), true);
  assert.equal(urls[1]?.endsWith('/tram/service-alerts'), true);
  const withoutKey = await new TransportGtfsRealtimeConnector(new FixtureClient(),
    () => undefined).collect(input);
  assert.equal(withoutKey.kind, 'failure');
  if (withoutKey.kind === 'failure') assert.equal(withoutKey.code, 'auth_failed');
});

test('partial, differential, deleted, and truncated feeds fail closed', async () => {
  const data = await fixture();
  assert.equal(parseAlertFeed(Buffer.from(data.empty_feed_base64, 'base64')).alerts.length, 0);
  assert.throws(() => parseAlertFeed(Buffer.from(data.differential_feed_base64, 'base64')));
  assert.throws(() => parseAlertFeed(Buffer.from(data.deleted_full_feed_base64, 'base64')));
  const truncated = Buffer.from(data.metro_feed_base64, 'base64');
  assert.throws(() => parseAlertFeed(truncated.subarray(0, truncated.length - 1)));
  class PartialClient extends HttpClient {
    private count = 0;
    override async getBytes() {
      this.count += 1;
      if (this.count === 2) throw new HttpFailure('upstream_unavailable', 503, 1);
      return { body: Buffer.from(data.metro_feed_base64, 'base64'), status: 200,
        fetchedAt, etag: null, lastModified: null, contentType: 'application/x-protobuf' };
    }
  }
  const result = await new TransportGtfsRealtimeConnector(new PartialClient(),
    () => 'fixture-key').collect(input);
  assert.equal(result.kind, 'failure');
  if (result.kind === 'failure') {
    assert.equal(result.completeness.fetched_pages, 1);
    assert.equal(result.code, 'upstream_unavailable');
  }
});

test('SourceRegistry admission: registers victoria.transport.gtfs_realtime as admitted open data on a 10-minute cadence', async () => {
  const connectorsRoot = join(__dirname, '../../src/connectors');
  const registry = await loadSourceRegistry(connectorsRoot);
  const entry = registry.get(SOURCE_ID);
  assert.ok(entry, `Source ${SOURCE_ID} must be registered in SourceRegistry`);
  assert.equal(entry.dataSource.source_id, SOURCE_ID);
  assert.equal(entry.dataSource.provider, 'Transport Victoria');
  assert.equal(entry.dataSource.topic, 'transport');
  assert.equal(entry.dataSource.scope, 'victoria');
  assert.equal(entry.dataSource.cadence_seconds, 600);
  assert.equal(entry.dataSource.check_interval_seconds, 600);
  assert.equal(entry.dataSource.license_status, 'verified_open');
  assert.equal(entry.dataSource.access_status, 'active');
  assert.deepEqual(entry.dataSource.admission_evidence.secret_names, ['transport_victoria_key_id']);
  assert.equal(entry.dataSource.record_granularity, 'full_feed_snapshot_and_alert_entity');
  const loaded = await loadConnector(entry);
  assert.equal(loaded.sourceId, SOURCE_ID);
  assert.equal(isConnector(loaded), true);
});

test('coverage declaration: explicitly limits feeds to train and tram, and disclaims bus alerts', async () => {
  assert.equal(FEEDS.length, 2);
  assert.deepEqual(FEEDS.map(f => f.mode), ['metro_train', 'yarra_tram']);
  assert.equal(FEEDS.some(f => (f.mode as string).includes('bus')), false);
  assert.equal(FEEDS.some(f => (f.mode as string).includes('vline')), false);

  const manifest = JSON.parse(await readFile(new URL('../../src/connectors/tv_gtfs_realtime/source.json', import.meta.url), 'utf8'));
  assert.ok(manifest.notes.includes('Bus has Trip Updates and Vehicle Positions, not a Service Alerts feed'));
  assert.ok(manifest.notes.includes('absent bus alerts never mean no bus disruption'));

  const data = await fixture();
  class FixtureClient extends HttpClient {
    override async getBytes() {
      return { body: Buffer.from(data.metro_feed_base64, 'base64'), status: 200, fetchedAt,
        etag: null, lastModified: null, contentType: 'application/x-protobuf' };
    }
  }
  const result = await new TransportGtfsRealtimeConnector(new FixtureClient(), () => 'fixture-key').collect(input);
  assert.equal(result.kind, 'success');
  if (result.kind === 'success') {
    assert.equal(result.completeness.evidence,
      'Both advertised Metro Train and Yarra Trams FULL_DATASET alert feeds parsed; no Bus Service Alerts feed is advertised');
    // Ensure no synthetic bus records were generated
    for (const record of result.geoRecords) {
      const summary = JSON.parse(record.summary ?? '{}');
      assert.notEqual(summary.mode, 'bus');
      assert.notEqual(summary.mode, 'metro_bus');
    }
  }
});

test('WireReader and protobuf decoder enforces strict bounds and rejects malformed fields', () => {
  // Truncated varint
  assert.throws(() => new WireReader(new Uint8Array([0x80])).varint(),
    /Truncated protobuf varint/);

  // Varint exceeding 10 bytes / uint64
  assert.throws(() => new WireReader(new Uint8Array([0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x01])).varint(),
    /Protobuf varint exceeds uint64/);

  // Truncated length-delimited field
  assert.throws(() => new WireReader(new Uint8Array([0x05, 0x01, 0x02])).bytesField(),
    /Truncated protobuf length-delimited field/);

  // Invalid field number (0)
  assert.throws(() => new WireReader(new Uint8Array([0x00])).fields(() => {}),
    /Invalid protobuf field number/);

  // Feed byte length validation: empty or exceeding MAX_FEED_BYTES
  assert.throws(() => parseAlertFeed(new Uint8Array([])), /GTFS alert feed size is invalid/);
  assert.throws(() => parseAlertFeed(new Uint8Array(MAX_FEED_BYTES + 1)), /GTFS alert feed size is invalid/);
});

test('period and selector validation enforces GTFS-Realtime semantics', () => {
  // Valid period
  const validPeriodBytes = new Uint8Array([
    0x08, 0x80, 0x80, 0x80, 0x80, 0x04, // tag 1 (start) varint
    0x10, 0x80, 0x80, 0x80, 0x80, 0x05, // tag 2 (end) varint
  ]);
  const parsed = parsePeriod(new WireReader(validPeriodBytes));
  assert.ok(parsed.start);
  assert.ok(parsed.end);
  assert.ok(parsed.start < parsed.end);

  // Empty period throws
  assert.throws(() => parsePeriod(new WireReader(new Uint8Array([]))),
    /Empty GTFS alert period/);

  // Inverted period (start >= end) throws
  const invertedPeriodBytes = new Uint8Array([
    0x08, 0x80, 0x80, 0x80, 0x80, 0x05, // tag 1 (start) = later
    0x10, 0x80, 0x80, 0x80, 0x80, 0x04, // tag 2 (end) = earlier
  ]);
  assert.throws(() => parsePeriod(new WireReader(invertedPeriodBytes)),
    /Invalid GTFS alert period/);

  // Selector with directionId but no routeId throws
  const directionOnly = new Uint8Array([
    0x30, 0x01, // field 6 (directionId) = 1
  ]);
  assert.throws(() => parseSelector(new WireReader(directionOnly)),
    /GTFS direction selector has no route/);

  // Empty selector throws
  assert.throws(() => parseSelector(new WireReader(new Uint8Array([]))),
    /Empty GTFS informed entity selector/);

  // singlePeriod helper
  assert.equal(singlePeriod({
    id: 'test', activePeriods: [], communicationPeriods: [], impactPeriods: [],
    selectors: [{ agencyId: '1', routeId: 'R1', routeType: 2, stopId: null, directionId: null, tripId: null, tripRouteId: null, tripStartDate: null, tripStartTime: null }],
    cause: null, effect: 1, header: null, description: null, url: null,
  }), null);
});

test('HTTP error mapping and status codes: 401 auth_failed, 429 rate_limited, 503 upstream_unavailable', async () => {
  class StatusClient extends HttpClient {
    constructor(private readonly failure: HttpFailure) { super(); }
    override async getBytes(): Promise<never> { throw this.failure; }
  }

  // 401 Unauthorized -> auth_failed
  const authErr = await new TransportGtfsRealtimeConnector(
    new StatusClient(new HttpFailure('auth_failed', 401, 1)), () => 'fixture-key'
  ).collect(input);
  assert.equal(authErr.kind, 'failure');
  if (authErr.kind === 'failure') {
    assert.equal(authErr.code, 'auth_failed');
  }

  // 429 Rate limited -> rate_limited with retryAfterSeconds
  const rateErr = await new TransportGtfsRealtimeConnector(
    new StatusClient(new HttpFailure('rate_limited', 429, 1, 30_000)), () => 'fixture-key'
  ).collect(input);
  assert.equal(rateErr.kind, 'failure');
  if (rateErr.kind === 'failure') {
    assert.equal(rateErr.code, 'rate_limited');
    assert.equal(rateErr.retryAfterSeconds, 30);
  }

  // 503 Upstream unavailable -> upstream_unavailable with retryAfterSeconds
  const upstreamErr = await new TransportGtfsRealtimeConnector(
    new StatusClient(new HttpFailure('upstream_unavailable', 503, 3, 45_000)), () => 'fixture-key'
  ).collect(input);
  assert.equal(upstreamErr.kind, 'failure');
  if (upstreamErr.kind === 'failure') {
    assert.equal(upstreamErr.code, 'upstream_unavailable');
    assert.equal(upstreamErr.retryAfterSeconds, 45);
  }

  // Mismatched sourceId -> validation_failed
  const invalidInput = parseConnectorInput({
    sourceId: 'victoria.transport.gtfs_realtime',
    window: { kind: 'time', from: '2026-09-28T00:00:00Z', to: '2026-09-28T00:15:00Z' },
    checkpoint: null, runId: 'run-wrong',
  });
  const mismatched = await new TransportGtfsRealtimeConnector(
    new StatusClient(new HttpFailure('auth_failed', 401, 1)), () => 'fixture-key'
  ).collect({ ...invalidInput, sourceId: 'wrong.source.id' as any });
  assert.equal(mismatched.kind, 'failure');
  if (mismatched.kind === 'failure') {
    assert.equal(mismatched.code, 'validation_failed');
  }
});

test('TransportGtfsRealtimeConnector supports options object injection and default export', async () => {
  const data = await fixture();
  class FixtureClient extends HttpClient {
    override async getBytes() {
      return { body: Buffer.from(data.metro_feed_base64, 'base64'), status: 200, fetchedAt,
        etag: null, lastModified: null, contentType: 'application/x-protobuf' };
    }
  }
  const connectorWithOptions = new TransportGtfsRealtimeConnector({
    client: new FixtureClient(),
    keyProvider: () => 'options-key',
  });
  const res = await connectorWithOptions.collect(input);
  assert.equal(res.kind, 'success');
});

test('repeated alert content with advancing feed timestamps prevents immutable row conflicts and replay preserves identity', async () => {
  const data = await fixture();
  const parsedFeed1 = parseAlertFeed(Buffer.from(data.metro_feed_base64, 'base64'));
  const timestamp1 = '2026-09-28T00:05:00.000Z';
  const fetchTime1 = '2026-09-28T00:06:00.000Z';

  // Batch 1 at timestamp1
  const norm1 = normalizeAlertFeeds([{
    mode: 'metro_train',
    resourceUrl: 'https://example.com/metro',
    parsed: { ...parsedFeed1, feedTimestamp: timestamp1 },
    fetchedAt: fetchTime1,
  }], input);

  assert.equal(norm1.geoRecords.length, 1);
  const alert1Geo = norm1.geoRecords[0]!;
  const alert1Source = norm1.sourceRecords.find(r => r.source_record_id === alert1Geo.geo_record_id)!;
  const version1 = alert1Geo.version_id;
  assert.equal(alert1Source.source_updated_at, timestamp1);
  assert.equal(JSON.parse(alert1Geo.summary ?? '{}').feed_timestamp, timestamp1);

  // Batch 2: SAME alert entity, but arriving in subsequent feed with advanced timestamp2
  const timestamp2 = '2026-09-28T00:10:00.000Z';
  const fetchTime2 = '2026-09-28T00:11:00.000Z';
  const batch2Input = parseConnectorInput({
    sourceId: 'victoria.transport.gtfs_realtime',
    window: { kind: 'time', from: '2026-09-28T00:05:00Z', to: '2026-09-28T00:20:00Z' },
    checkpoint: '2026-09-28T00:05:00Z',
    runId: 'gtfs-batch2-run',
  });

  const norm2 = normalizeAlertFeeds([{
    mode: 'metro_train',
    resourceUrl: 'https://example.com/metro',
    parsed: { ...parsedFeed1, feedTimestamp: timestamp2 },
    fetchedAt: fetchTime2,
  }], batch2Input);

  const alert2Geo = norm2.geoRecords[0]!;
  const alert2Source = norm2.sourceRecords.find(r => r.source_record_id === alert2Geo.geo_record_id)!;
  const version2 = alert2Geo.version_id;

  // Key invariant: version MUST advance because source_updated_at and summary.feed_timestamp changed.
  // This prevents publisher immutable row conflict for key (alertId, version).
  assert.notEqual(version1, version2);
  assert.equal(alert2Source.source_updated_at, timestamp2);
  assert.equal(JSON.parse(alert2Geo.summary ?? '{}').feed_timestamp, timestamp2);

  // Replay of Batch 2: new fetch time and runId, but identical feed timestamp and payload
  const fetchTime3 = '2026-09-28T00:14:00.000Z';
  const replayInput = parseConnectorInput({
    sourceId: 'victoria.transport.gtfs_realtime',
    window: { kind: 'time', from: '2026-09-28T00:05:00Z', to: '2026-09-28T00:20:00Z' },
    checkpoint: '2026-09-28T00:05:00Z',
    runId: 'gtfs-replay-run',
  });

  const replayNorm = normalizeAlertFeeds([{
    mode: 'metro_train',
    resourceUrl: 'https://example.com/metro',
    parsed: { ...parsedFeed1, feedTimestamp: timestamp2 },
    fetchedAt: fetchTime3,
  }], replayInput);

  const replayGeo = replayNorm.geoRecords[0]!;
  const replaySource = replayNorm.sourceRecords.find(r => r.source_record_id === replayGeo.geo_record_id)!;

  // Replay preserves identical version_id and non-audit content
  assert.equal(replayGeo.version_id, version2);
  assert.equal(replaySource.version_id, version2);

  const auditFields = new Set(['batch_id', 'fetched_at', 'raw_uri', 'first_accessible_at', 'freshness_state']);
  const contentOf = (row: Record<string, unknown>) =>
    Object.fromEntries(Object.entries(row).filter(([k]) => !auditFields.has(k)));

  assert.deepEqual(contentOf(replayGeo as any), contentOf(alert2Geo as any));
  assert.deepEqual(contentOf(replaySource as any), contentOf(alert2Source as any));
});

test('sourceRevision canonical derivation: captures dual-mode progression, lagging mode advance, and payload revisions', async () => {
  const data = await fixture();
  const parsedMetro = parseAlertFeed(Buffer.from(data.metro_feed_base64, 'base64'));
  const parsedTram = parseAlertFeed(Buffer.from(data.tram_feed_base64, 'base64'));

  const metroTime1 = '2026-09-28T00:10:00.000Z';
  const tramTime1 = '2026-09-28T00:05:00.000Z';

  // Base dual-mode feeds (Metro leading, Tram lagging)
  const norm1 = normalizeAlertFeeds([
    { mode: 'metro_train', resourceUrl: 'https://example.com/metro',
      parsed: { ...parsedMetro, feedTimestamp: metroTime1 }, fetchedAt },
    { mode: 'yarra_tram', resourceUrl: 'https://example.com/tram',
      parsed: { ...parsedTram, feedTimestamp: tramTime1 }, fetchedAt },
  ], input);

  assert.ok(norm1.sourceRevision);
  assert.equal(norm1.latestUpdate, metroTime1);
  const rev1 = norm1.sourceRevision;

  // Replaying identical feeds with different fetchedAt preserves same sourceRevision
  const normReplay = normalizeAlertFeeds([
    { mode: 'metro_train', resourceUrl: 'https://example.com/metro',
      parsed: { ...parsedMetro, feedTimestamp: metroTime1 }, fetchedAt: '2026-09-28T00:12:00Z' },
    { mode: 'yarra_tram', resourceUrl: 'https://example.com/tram',
      parsed: { ...parsedTram, feedTimestamp: tramTime1 }, fetchedAt: '2026-09-28T00:12:00Z' },
  ], input);
  assert.equal(normReplay.sourceRevision, rev1);

  // Advance ONLY the lagging mode (Tram from 00:05:00 to 00:08:00, still < Metro 00:10:00)
  const tramTime2 = '2026-09-28T00:08:00.000Z';
  const normLaggingAdvance = normalizeAlertFeeds([
    { mode: 'metro_train', resourceUrl: 'https://example.com/metro',
      parsed: { ...parsedMetro, feedTimestamp: metroTime1 }, fetchedAt },
    { mode: 'yarra_tram', resourceUrl: 'https://example.com/tram',
      parsed: { ...parsedTram, feedTimestamp: tramTime2 }, fetchedAt },
  ], input);

  // Key requirement: latestUpdate is still metroTime1 (00:10:00.000Z), BUT sourceRevision MUST change
  assert.equal(normLaggingAdvance.latestUpdate, metroTime1);
  assert.notEqual(normLaggingAdvance.sourceRevision, rev1);
  const rev2 = normLaggingAdvance.sourceRevision;

  // Advance leading mode (Metro from 00:10:00 to 00:15:00)
  const metroTime2 = '2026-09-28T00:15:00.000Z';
  const normLeadingAdvance = normalizeAlertFeeds([
    { mode: 'metro_train', resourceUrl: 'https://example.com/metro',
      parsed: { ...parsedMetro, feedTimestamp: metroTime2 }, fetchedAt },
    { mode: 'yarra_tram', resourceUrl: 'https://example.com/tram',
      parsed: { ...parsedTram, feedTimestamp: tramTime2 }, fetchedAt },
  ], input);

  assert.equal(normLeadingAdvance.latestUpdate, metroTime2);
  assert.notEqual(normLeadingAdvance.sourceRevision, rev2);
  const rev3 = normLeadingAdvance.sourceRevision;

  // Modify alert payload in Tram without changing alert IDs
  const modifiedTram = {
    ...parsedTram,
    feedTimestamp: tramTime2,
    alerts: parsedTram.alerts.map(a => ({ ...a, description: 'Updated disruption description' })),
  };
  const normPayloadChange = normalizeAlertFeeds([
    { mode: 'metro_train', resourceUrl: 'https://example.com/metro',
      parsed: { ...parsedMetro, feedTimestamp: metroTime2 }, fetchedAt },
    { mode: 'yarra_tram', resourceUrl: 'https://example.com/tram',
      parsed: modifiedTram, fetchedAt },
  ], input);

  assert.notEqual(normPayloadChange.sourceRevision, rev3);

  // Also verify parent feed version reflects alert payload change rather than just alert IDs
  const parentSourceBefore = normLeadingAdvance.sourceRecords.find(r => r.source_record_id.includes('yarra_tram'))!;
  const parentSourceAfter = normPayloadChange.sourceRecords.find(r => r.source_record_id.includes('yarra_tram'))!;
  assert.notEqual(parentSourceBefore.version_id, parentSourceAfter.version_id);
});
