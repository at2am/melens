import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

import { parseConnectorInput } from '../../src/core/connector.js';
import { HttpClient, HttpFailure } from '../../src/core/http.js';
import { TransportGtfsRealtimeConnector, normalizeAlertFeeds, parseAlertFeed } from
  '../../src/connectors/tv_gtfs_realtime/index.js';

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
  assert.equal(metro?.public_query_allowed, false);
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
