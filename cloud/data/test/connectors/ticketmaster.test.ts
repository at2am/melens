import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

import { parseConnectorInput } from '../../src/core/connector.js';
import { HttpClient, HttpFailure } from '../../src/core/http.js';
import { validateGeoRecordGeography } from '../../src/validation/geography.js';
import { parseSourceRecord } from '../../src/validation/record.js';
import {
  TicketmasterConnector,
  geohash,
  normalizeTicketEvents,
  parseTicketPage,
  SOURCE_ID,
  ENDPOINT,
  MELBOURNE,
  SEARCH_RADIUS_KM,
  PAGE_SIZE,
  DEEP_PAGING_LIMIT,
  ticketmasterApiTimeWindow,
} from '../../src/connectors/ticketmaster/index.js';
import { ticketmasterCacheExpiresAt, ticketmasterCacheIsVisible,
  ticketmasterContentRecordId } from '../../src/connectors/ticketmaster/policy.js';
import { TicketmasterProbeHttpClient, ticketmasterProbeConfig, ticketmasterProbeSummary }
  from '../../src/jobs/ticketmaster-probe.js';

const input = parseConnectorInput({
  sourceId: 'ticketmaster.events',
  window: { kind: 'time', from: '2026-10-01T00:00:00Z', to: '2026-10-03T00:00:00Z' },
  checkpoint: null,
  runId: 'ticketmaster-fixture',
});
const fetchedAt = '2026-09-28T00:00:00Z';

async function fixture() {
  return parseTicketPage(
    JSON.parse(await readFile(new URL('../fixtures/ticketmaster.json', import.meta.url), 'utf8')),
  );
}

async function loadManifest() {
  return JSON.parse(
    await readFile(new URL('../../src/connectors/ticketmaster/source.json', import.meta.url), 'utf8'),
  );
}

test('event versions keep venue evidence and postpone without inventing a start time', async () => {
  const page = await fixture();
  const result = normalizeTicketEvents(page._embedded?.events ?? [], input, fetchedAt);
  assert.equal(result.geoRecords.length, 2);
  assert.equal(result.geoRecords[0]?.location_confidence, 'source_coordinate');
  assert.equal(result.geoRecords[0]?.valid_from, '2026-10-01T09:00:00.000Z');
  assert.equal(result.geoRecords[0]?.valid_to, null);
  assert.equal(result.geoRecords[1]?.valid_from, null);
  assert.equal(result.geoRecords[1]?.summary?.includes('postponed'), true);
  assert.equal(result.geoRecords[0]?.public_query_allowed, true);

  result.sourceRecords.forEach((row) => assert.deepEqual(parseSourceRecord(row), row));
  result.geoRecords.forEach((row) => assert.equal(validateGeoRecordGeography(row).valid, true));

  const original = page._embedded?.events?.[0];
  assert.ok(original);
  const cancelled = {
    ...original,
    dates: { ...original.dates, status: { code: 'canceled' } },
  };
  const changed = normalizeTicketEvents([cancelled], input, fetchedAt);
  assert.equal(changed.geoRecords[0]?.record_status, 'cancelled');
  assert.notEqual(changed.geoRecords[0]?.version_id, result.geoRecords[0]?.version_id);
});

test('Discovery search uses Melbourne geohash, Australian filter and bounded event window', async () => {
  const page = await fixture();
  const requested: URL[] = [];
  class FixtureClient extends HttpClient {
    override async getJson(request: { url: URL }) {
      requested.push(request.url);
      return {
        body: page,
        status: 200,
        fetchedAt,
        etag: null,
        lastModified: null,
        contentType: 'application/json',
      };
    }
  }
  const connector = new TicketmasterConnector(new FixtureClient(), () => 'fixture-key');
  const result = await connector.collect(input);
  assert.equal(result.kind, 'success');
  assert.equal(requested.length, 1);
  assert.equal(requested[0]?.searchParams.get('countryCode'), 'AU');
  assert.equal(requested[0]?.searchParams.get('stateCode'), 'VIC');
  assert.equal(requested[0]?.searchParams.get('geoPoint'), geohash(MELBOURNE.lat, MELBOURNE.lon));
  assert.equal(
    requested[0]?.searchParams.get('startDateTime'),
    input.window.kind === 'time' ? input.window.from : null,
  );
  assert.equal(
    requested[0]?.searchParams.get('endDateTime'),
    '2026-10-02T23:59:59Z',
  );
  assert.equal(requested[0]?.searchParams.get('size'), String(PAGE_SIZE));
  assert.equal(requested[0]?.searchParams.get('page'), '0');

  const withoutKey = await new TicketmasterConnector(new FixtureClient(), () => undefined).collect(input);
  assert.equal(withoutKey.kind, 'failure');
  if (withoutKey.kind === 'failure') assert.equal(withoutKey.code, 'auth_failed');
});

test('cancellation contract: supports canceled/cancelled, retains entity ID and updates version', async () => {
  const page = await fixture();
  const original = page._embedded?.events?.[0];
  assert.ok(original);

  const baseline = normalizeTicketEvents([original], input, fetchedAt);
  const baselineId = baseline.geoRecords[0]?.geo_record_id;
  const baselineVersion = baseline.geoRecords[0]?.version_id;

  // Test both 'canceled' and 'cancelled' spelling
  for (const statusCode of ['canceled', 'cancelled', 'CANCELED']) {
    const cancelledEvent = {
      ...original,
      dates: { ...original.dates, status: { code: statusCode } },
    };
    const res = normalizeTicketEvents([cancelledEvent], input, fetchedAt);
    assert.equal(res.sourceRecords[0]?.record_status, 'cancelled');
    assert.equal(res.geoRecords[0]?.record_status, 'cancelled');
    assert.equal(res.geoRecords[0]?.geo_record_id, baselineId, 'Stable entity ID across cancellation');
    assert.notEqual(res.geoRecords[0]?.version_id, baselineVersion, 'Version changes on cancellation');
    assert.equal(res.geoRecords[0]?.centroid_lon, 144.96, 'Venue coordinates retained upon cancellation');
    assert.equal(res.geoRecords[0]?.centroid_lat, -37.81);
    assert.equal(res.geoRecords[0]?.location_role, 'event_site');
  }
});

test('reschedule contract: preserves native entity ID and updates valid_from/valid_to and version', async () => {
  const page = await fixture();
  const original = page._embedded?.events?.[0];
  assert.ok(original);

  const baseline = normalizeTicketEvents([original], input, fetchedAt);
  const baselineId = baseline.geoRecords[0]?.geo_record_id;
  const baselineVersion = baseline.geoRecords[0]?.version_id;

  const rescheduledEvent = {
    ...original,
    dates: {
      ...original.dates,
      status: { code: 'rescheduled' },
      start: {
        dateTime: '2026-10-02T10:30:00Z',
        localDate: '2026-10-02',
        localTime: '20:30:00',
      },
      end: {
        dateTime: '2026-10-02T13:00:00Z',
      },
    },
  };

  const res = normalizeTicketEvents([rescheduledEvent], input, fetchedAt);
  assert.equal(res.geoRecords[0]?.geo_record_id, baselineId, 'Native entity ID must remain stable');
  assert.notEqual(res.geoRecords[0]?.version_id, baselineVersion, 'Version hash must change on date update');
  assert.equal(res.geoRecords[0]?.valid_from, '2026-10-02T10:30:00.000Z');
  assert.equal(res.geoRecords[0]?.valid_to, '2026-10-02T13:00:00.000Z');
  assert.equal(res.geoRecords[0]?.record_status, 'planned');
});

test('missing venue or out-of-range coordinates fall back safely to unverified status without crashing', async () => {
  const page = await fixture();
  const original = page._embedded?.events?.[0];
  assert.ok(original);

  // 1. Missing venue altogether
  const noVenue = { ...original, _embedded: undefined };
  const resNoVenue = normalizeTicketEvents([noVenue], input, fetchedAt);
  assert.equal(resNoVenue.geoRecords[0]?.geometry_geojson, null);
  assert.equal(resNoVenue.geoRecords[0]?.centroid_lon, null);
  assert.equal(resNoVenue.geoRecords[0]?.centroid_lat, null);
  assert.equal(resNoVenue.geoRecords[0]?.location_role, 'unknown');
  assert.equal(resNoVenue.geoRecords[0]?.location_confidence, 'unverified');
  assert.equal(validateGeoRecordGeography(resNoVenue.geoRecords[0]!).valid, true);

  // 2. Out-of-bounds coordinates (latitude > 90, longitude > 180)
  const badCoords = {
    ...original,
    _embedded: {
      venues: [
        {
          id: 'VEN-BAD',
          name: 'Invalid Venue',
          location: { longitude: '200.0', latitude: '95.0' },
        },
      ],
    },
  };
  const resBadCoords = normalizeTicketEvents([badCoords], input, fetchedAt);
  assert.equal(resBadCoords.geoRecords[0]?.geometry_geojson, null);
  assert.equal(resBadCoords.geoRecords[0]?.centroid_lon, null);
  assert.equal(resBadCoords.geoRecords[0]?.centroid_lat, null);
  assert.equal(resBadCoords.geoRecords[0]?.location_role, 'unknown');
  assert.equal(resBadCoords.geoRecords[0]?.location_confidence, 'unverified');
  assert.equal(validateGeoRecordGeography(resBadCoords.geoRecords[0]!).valid, true);
});

test('strict field protection: only allowed metadata and coordinates are retained, no text scraping', async () => {
  const page = await fixture();
  const original = page._embedded?.events?.[0];
  assert.ok(original);

  // Ingest raw object that contains extra upstream fields like description, info, pricing
  const bloatedEvent = {
    ...original,
    description: 'Extensive copyrighted promotional description of the event performance',
    info: 'Please note tickets are non-refundable and subject to Ticketmaster terms',
    pleaseNote: 'VIP package details and backstage tour rules',
    priceRanges: [{ min: 89.0, max: 299.0, currency: 'AUD' }],
  };

  const res = normalizeTicketEvents([bloatedEvent], input, fetchedAt);
  const geo = res.geoRecords[0]!;
  assert.equal(geo.title, original.name);
  assert.equal(geo.summary?.includes('Ticketmaster status:'), true);
  assert.equal(geo.summary?.includes('venue: Example Venue'), true);
  assert.equal(geo.summary?.includes('Extensive copyrighted promotional'), false);
  assert.equal(geo.summary?.includes('VIP package'), false);
  assert.equal(JSON.stringify(geo).includes('promotional description'), false);
});

test('restricted metadata declares the source-specific cache and removal controls', async () => {
  const manifest = await loadManifest();
  assert.equal(manifest.source_id, SOURCE_ID);
  assert.equal(manifest.license_status, 'restricted');
  assert.equal(manifest.admission_evidence.staging_retention_days, 1);
  assert.equal(manifest.admission_evidence.secret_names.includes('ticketmaster_discovery_api_key'), true);
  assert.equal(manifest.admission_evidence.license_evidence_url, 'https://developer.ticketmaster.com/support/terms-of-use/');
  assert.deepEqual(manifest.admission_evidence.allowed_fields, [
    'id',
    'url',
    'name',
    'dates.start',
    'dates.end.dateTime',
    'dates.timezone',
    'dates.status.code',
    '_embedded.venues.id',
    '_embedded.venues.name',
    '_embedded.venues.location',
    'title',
    'summary',
  ]);
  assert.equal(manifest.admission_evidence.raw_retention_days, 0);
  assert.equal(manifest.retention_policy.content_cache_seconds, 86400);
  assert.equal(manifest.retention_policy.cleanup_interval_seconds, 21600);

  const page = await fixture();
  const res = normalizeTicketEvents(page._embedded?.events ?? [], input, fetchedAt);
  res.sourceRecords.forEach((sr) => {
    assert.equal(sr.rights_status, 'restricted');
    assert.equal(sr.raw_uri, null);
  });
  res.geoRecords.forEach((gr) => {
    assert.equal(gr.rights_status, 'restricted');
    assert.equal(gr.public_query_allowed, true);
  });
});

test('missing or whitespace-only API key fails fast with auth_failed without network request', async () => {
  class ExplodingClient extends HttpClient {
    override async getJson(): Promise<never> {
      throw new Error('Network should never be reached without valid key');
    }
  }

  for (const emptyKey of [undefined, '', '   ', '\t\n']) {
    const connector = new TicketmasterConnector(new ExplodingClient(), () => emptyKey);
    const result = await connector.collect(input);
    assert.equal(result.kind, 'failure');
    if (result.kind === 'failure') {
      assert.equal(result.code, 'auth_failed');
    }
  }
});

test('HTTP 429 rate limit returns rate_limited failure code with retryAfterSeconds', async () => {
  class RateLimitedClient extends HttpClient {
    override async getJson(): Promise<never> {
      throw new HttpFailure('rate_limited', 429, 1, 12000);
    }
  }

  const connector = new TicketmasterConnector(new RateLimitedClient(), () => 'key');
  const result = await connector.collect(input);
  assert.equal(result.kind, 'failure');
  if (result.kind === 'failure') {
    assert.equal(result.code, 'rate_limited');
    assert.equal(result.retryAfterSeconds, 12);
  }
});

test('HTTP 503 upstream unavailable returns upstream_unavailable failure code', async () => {
  class UnavailableClient extends HttpClient {
    override async getJson(): Promise<never> {
      throw new HttpFailure('upstream_unavailable', 503, 3);
    }
  }

  const connector = new TicketmasterConnector(new UnavailableClient(), () => 'key');
  const result = await connector.collect(input);
  assert.equal(result.kind, 'failure');
  if (result.kind === 'failure') {
    assert.equal(result.code, 'upstream_unavailable');
  }
});

test('HTTP 404 or corrupted schema returns schema_changed failure code', async () => {
  class SchemaBrokenClient extends HttpClient {
    override async getJson() {
      return {
        body: { unrecognised_root: true },
        status: 200,
        fetchedAt,
        etag: null,
        lastModified: null,
        contentType: 'application/json',
      };
    }
  }

  const connector = new TicketmasterConnector(new SchemaBrokenClient(), () => 'key');
  const result = await connector.collect(input);
  assert.equal(result.kind, 'failure');
  if (result.kind === 'failure') {
    assert.equal(result.code, 'schema_changed');
  }
});

test('deep paging boundary: search window exceeding 1000 events fails fail-closed with incomplete_window', async () => {
  class OversizedWindowClient extends HttpClient {
    override async getJson() {
      return {
        body: {
          page: { size: 100, totalElements: 1001, totalPages: 11, number: 0 },
          _embedded: { events: [] },
        },
        status: 200,
        fetchedAt,
        etag: null,
        lastModified: null,
        contentType: 'application/json',
      };
    }
  }

  const connector = new TicketmasterConnector(new OversizedWindowClient(), () => 'key');
  const result = await connector.collect(input);
  assert.equal(result.kind, 'failure');
  if (result.kind === 'failure') {
    assert.equal(result.code, 'incomplete_window');
  }
});

test('pagination inconsistency across pages fails with incomplete_window', async () => {
  let call = 0;
  class InconsistentClient extends HttpClient {
    override async getJson() {
      call += 1;
      const total = call === 1 ? 200 : 199; // Total count changed between pages
      return {
        body: {
          page: { size: 100, totalElements: total, totalPages: 2, number: call - 1 },
          _embedded: { events: [] },
        },
        status: 200,
        fetchedAt,
        etag: null,
        lastModified: null,
        contentType: 'application/json',
      };
    }
  }

  const connector = new TicketmasterConnector(new InconsistentClient(), () => 'key');
  const result = await connector.collect(input);
  assert.equal(result.kind, 'failure');
  if (result.kind === 'failure') {
    assert.equal(result.code, 'incomplete_window');
  }
});

test('duplicate event IDs within single response fail with validation_failed', async () => {
  const page = await fixture();
  const ev1 = page._embedded?.events?.[0];
  assert.ok(ev1);

  // Array with duplicate event ID
  assert.throws(
    () => normalizeTicketEvents([ev1, ev1], input, fetchedAt),
    /Duplicate Ticketmaster event ID/,
  );
});

test('mismatched sourceId fails with validation_failed', async () => {
  class DummyClient extends HttpClient {}
  const connector = new TicketmasterConnector(new DummyClient(), () => 'key');

  const badSourceInput = parseConnectorInput({
    sourceId: 'victoria.transport.road_planned',
    window: { kind: 'time', from: '2026-10-01T00:00:00Z', to: '2026-10-03T00:00:00Z' },
    checkpoint: null,
    runId: 'bad-source',
  });
  const resBadSource = await connector.collect(badSourceInput);
  assert.equal(resBadSource.kind, 'failure');
  if (resBadSource.kind === 'failure') assert.equal(resBadSource.code, 'validation_failed');

});

test('multi-page collection chains zero-based pages, concatenates events and sets retainableRawRecords=null', async () => {
  const page = await fixture();
  const ev1 = page._embedded?.events?.[0];
  const ev2 = page._embedded?.events?.[1];
  assert.ok(ev1 && ev2);

  let calls = 0;
  const requestedPages: string[] = [];
  class MultiPageClient extends HttpClient {
    override async getJson(request: { url: URL }) {
      calls += 1;
      requestedPages.push(request.url.searchParams.get('page') ?? '');
      if (calls === 1) {
        return {
          body: {
            page: { size: 1, totalElements: 2, totalPages: 2, number: 0 },
            _embedded: { events: [ev1] },
          },
          status: 200,
          fetchedAt,
          etag: null,
          lastModified: null,
          contentType: 'application/json',
        };
      }
      return {
        body: {
          page: { size: 1, totalElements: 2, totalPages: 2, number: 1 },
          _embedded: { events: [ev2] },
        },
        status: 200,
        fetchedAt,
        etag: null,
        lastModified: null,
        contentType: 'application/json',
      };
    }
  }

  const connector = new TicketmasterConnector(new MultiPageClient(), () => 'key');
  const result = await connector.collect(input);
  assert.equal(result.kind, 'success');
  if (result.kind === 'success') {
    assert.equal(result.outputCount, 2);
    assert.equal(result.completeness.complete, true);
    assert.equal(result.completeness.fetched_records, 2);
    assert.equal(result.completeness.expected_records, 2);
    assert.equal(result.completeness.fetched_pages, 2);
    assert.equal(result.retainableRawRecords, null, 'Cache eviction contract: raw records must not be retained');
  }
  assert.deepEqual(requestedPages, ['0', '1']);
});

test('snapshot refresh searches the next 30 days and does not advance a time checkpoint', async () => {
  const page = await fixture();
  const requested: URL[] = [];
  class SnapshotClient extends HttpClient {
    override async getJson(request: { url: URL; redirect?: RequestRedirect; maxAttempts?: number }) {
      requested.push(request.url);
      assert.equal(request.redirect, 'error');
      assert.equal(request.maxAttempts, 1);
      return { body: page, status: 200, fetchedAt, etag: null,
        lastModified: null, contentType: 'application/json' };
    }
  }
  const snapshotInput = parseConnectorInput({ sourceId: SOURCE_ID,
    window: { kind: 'snapshot', revision: 'latest' }, checkpoint: null,
    runId: 'snapshot-window' });
  const result = await new TicketmasterConnector(new SnapshotClient(), () => 'fixture-key',
    () => '2026-10-01T12:00:00Z').collect(snapshotInput);
  assert.equal(result.kind, 'success');
  if (result.kind === 'success') {
    assert.equal(result.checkpointAfter, null);
    assert.ok(result.sourceRevision);
  }
  assert.equal(requested[0]?.searchParams.get('startDateTime'), '2026-10-01T12:00:00Z');
  assert.equal(requested[0]?.searchParams.get('endDateTime'), '2026-10-31T11:59:59Z');
  assert.equal(requested[0]?.searchParams.get('sort'), 'id,asc');
  assert.equal(requested[0]?.searchParams.get('includeTest'), 'no');
});

test('empty snapshots agree on one fetched response and publisher page counts', async () => {
  class EmptyClient extends HttpClient {
    override async getJson() {
      return { body: { page: { size: 100, totalElements: 0, totalPages: 0, number: 0 } },
        status: 200, fetchedAt, etag: null, lastModified: null, contentType: 'application/json' };
    }
  }
  const result = await new TicketmasterConnector(new EmptyClient(), () => 'fixture-key').collect(input);
  assert.equal(result.kind, 'success');
  if (result.kind === 'success') {
    assert.equal(result.inputCount, 0);
    assert.equal(result.completeness.expected_pages, 1);
    assert.equal(result.completeness.fetched_pages, 1);
  }
});

test('incorrect page count or incomplete page fails even when overall total could agree', async () => {
  const page = await fixture();
  for (const metadata of [
    { size: 100, totalElements: 2, totalPages: 2, number: 0 },
    { size: 100, totalElements: 101, totalPages: 2, number: 0 },
    { size: 100, totalElements: 2, totalPages: 0, number: 0 },
  ]) {
    class BadPagingClient extends HttpClient {
      override async getJson() {
        return { body: { ...page, page: metadata }, status: 200, fetchedAt,
          etag: null, lastModified: null, contentType: 'application/json' };
      }
    }
    const result = await new TicketmasterConnector(new BadPagingClient(), () => 'fixture-key').collect(input);
    assert.equal(result.kind, 'failure');
    if (result.kind === 'failure') assert.equal(result.code, 'incomplete_window');
  }
});

test('blank coordinates and several venues keep location unknown while venue changes create versions', async () => {
  const original = (await fixture())._embedded?.events?.[0];
  assert.ok(original);
  const venues = original._embedded?.venues;
  const venue = venues?.[0];
  assert.ok(venue);
  const blank = normalizeTicketEvents([{ ...original, _embedded: {
    venues: [{ ...venue, location: { longitude: ' ', latitude: '' } }],
  } }], input, fetchedAt);
  assert.equal(blank.geoRecords[0]?.geometry_geojson, null);
  const multiple = normalizeTicketEvents([{ ...original, _embedded: {
    venues: [venue, { ...venue, id: 'OTHER-VENUE' }],
  } }], input, fetchedAt);
  assert.equal(multiple.geoRecords[0]?.location_role, 'unknown');
  const baseline = normalizeTicketEvents([original], input, fetchedAt);
  const renamed = normalizeTicketEvents([{ ...original, _embedded: {
    venues: [{ ...venue, name: 'Renamed venue' }],
  } }], input, fetchedAt);
  assert.notEqual(renamed.sourceRecords[0]?.version_id, baseline.sourceRecords[0]?.version_id);
});

test('cache visibility expires at 24 hours, rejects future fetches and honors immediate suppression', () => {
  assert.equal(ticketmasterCacheExpiresAt('2026-10-01T00:00:00Z'), '2026-10-02T00:00:00.000Z');
  assert.equal(ticketmasterContentRecordId(' EV-1 '), 'ticketmaster.events:EV-1');
  const row = { fetchedAt: '2026-10-01T00:00:00Z', suppressed: false };
  assert.equal(ticketmasterCacheIsVisible({ ...row, now: '2026-10-01T23:59:59Z' }), true);
  assert.equal(ticketmasterCacheIsVisible({ ...row, now: '2026-10-02T00:00:00Z' }), false);
  assert.equal(ticketmasterCacheIsVisible({ ...row, now: '2026-09-30T23:59:59Z' }), false);
  assert.equal(ticketmasterCacheIsVisible({ ...row, now: '2026-10-01T01:00:00Z', suppressed: true }), false);
  assert.equal(ticketmasterCacheIsVisible({ ...row, now: 'invalid' }), false);
});

test('private Ticketmaster probe config requires its dedicated job and injected nonempty key', () => {
  const env = { GOOGLE_CLOUD_PROJECT: 'melens-510012', GCS_BUCKET: 'melens-510012-dev-ingest',
    MELENS_SOURCE_ID: SOURCE_ID, CLOUD_RUN_JOB: 'melens-dev-ticketmaster-probe',
    TICKETMASTER_DISCOVERY_API_KEY: 'fixture-key' };
  assert.equal(ticketmasterProbeConfig(env).sourceId, SOURCE_ID);
  assert.equal(JSON.stringify(ticketmasterProbeConfig(env)).includes('fixture-key'), false);
  for (const changed of [
    { CLOUD_RUN_JOB: 'other-job' }, { GOOGLE_CLOUD_PROJECT: 'other-project' },
    { GCS_BUCKET: 'other-bucket' }, { MELENS_SOURCE_ID: 'other.events' },
    { TICKETMASTER_DISCOVERY_API_KEY: '' }, { TICKETMASTER_DISCOVERY_API_KEY: '   ' },
  ]) assert.throws(() => ticketmasterProbeConfig({ ...env, ...changed }), /dedicated Cloud Run job/);
});

test('private probe summary outputs counts and fixed labels without event or diagnostic values', async () => {
  const original = (await fixture())._embedded?.events?.[0];
  assert.ok(original);
  const sensitive = 'content-sentinel-must-not-reach-logs';
  const event = { ...original, id: sensitive, name: sensitive,
    url: `https://www.ticketmaster.com.au/event/${sensitive}`,
    dates: { ...original.dates, status: { code: sensitive } } };
  class FixtureClient extends HttpClient {
    override async getJson() {
      return { body: { page: { size: 100, totalElements: 1, totalPages: 1, number: 0 },
        _embedded: { events: [event] } }, status: 200, fetchedAt,
        etag: null, lastModified: null, contentType: 'application/json' };
    }
  }
  const result = await new TicketmasterConnector(new FixtureClient(), () => 'fixture-key').collect(input);
  assert.equal(result.kind, 'success');
  const summary = ticketmasterProbeSummary(result);
  const serialized = JSON.stringify(summary);
  assert.equal(serialized.includes(sensitive), false);
  assert.equal(serialized.includes('fixture-key'), false);
  assert.equal(serialized.includes('https://'), false);
  assert.equal(serialized.includes('original_url'), false);
  assert.equal(serialized.includes('evidence'), false);
  assert.equal(summary.kind, 'success');
  if (summary.kind === 'success') {
    assert.equal(summary.events_with_date_count, 1);
    assert.equal(summary.events_with_source_url_count, 1);
  }
});

test('private probe counts eligible provider venues without logging identities or postponed events', async () => {
  const page = await fixture();
  const original = page._embedded?.events?.[0];
  const postponed = page._embedded?.events?.[1];
  assert.ok(original && postponed);
  const renamedVenue = { id: 'venue-content-sentinel', name: 'venue-name-sentinel',
    location: { latitude: '-37.83', longitude: '144.98' } };
  const second = { ...original, id: 'second-event-content-sentinel',
    dates: { ...original.dates, start: { dateTime: '2026-10-02T09:00:00Z' },
      status: { code: 'rescheduled' } }, _embedded: { venues: [renamedVenue] } };
  const events = [original, second, postponed];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    assert.equal(init?.redirect, 'error');
    return new Response(JSON.stringify({ page: { size: 100, totalElements: 3,
      totalPages: 1, number: 0 }, _embedded: { events } }),
    { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const client = new TicketmasterProbeHttpClient({ from: '2026-10-01T00:00:00Z',
      to: '2026-10-31T00:00:00Z' });
    await client.getJson({ url: `${ENDPOINT}?apikey=fixture-key`, maxAttempts: 3,
      redirect: 'follow' });
    const summary = client.summary();
    assert.equal(summary.eligible_future_event_count, 2);
    assert.equal(summary.eligible_future_distinct_provider_venue_count, 2);
    assert.equal(summary.provider_status_counts['postponed'], 1);
    assert.equal(summary.provider_status_counts['rescheduled'], 1);
    assert.equal(summary.request_attempts, 1);
    const serialized = JSON.stringify(summary);
    assert.equal(serialized.includes('sentinel'), false);
    assert.equal(serialized.includes('fixture-key'), false);
    assert.equal(serialized.includes('https://'), false);
  } finally { globalThis.fetch = originalFetch; }
});

test('Discovery query timestamp parameters use whole UTC seconds and half-open end', () => {
  assert.deepEqual(ticketmasterApiTimeWindow({ from: '2026-10-01T11:40:50.238Z',
    to: '2026-10-31T11:40:50.238Z' }), {
    from: '2026-10-01T11:40:51Z', to: '2026-10-31T11:40:50Z',
  });
  assert.deepEqual(ticketmasterApiTimeWindow({ from: '2026-10-01T00:00:00Z',
    to: '2026-10-02T00:00:00Z' }), {
    from: '2026-10-01T00:00:00Z', to: '2026-10-01T23:59:59Z',
  });
});

test('private probe HTTP failure reports a status count without its error body', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('request-secret-sentinel', { status: 400 });
  try {
    const client = new TicketmasterProbeHttpClient({ from: '2026-10-01T00:00:00Z',
      to: '2026-10-31T00:00:00Z' });
    await assert.rejects(client.getJson({ url: `${ENDPOINT}?apikey=fixture-key` }), HttpFailure);
    assert.deepEqual(client.summary().http_status_counts, { 400: 1 });
    assert.equal(JSON.stringify(client.summary()).includes('request-secret-sentinel'), false);
    assert.equal(JSON.stringify(client.summary()).includes('fixture-key'), false);
  } finally { globalThis.fetch = originalFetch; }
});

test('private probe schema failure only reports fixed paths and fixed issue codes', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    page: { size: 'schema-secret-sentinel', totalElements: 0, totalPages: 0, number: 0 },
  }), { status: 200 });
  try {
    const client = new TicketmasterProbeHttpClient({ from: '2026-10-01T00:00:00Z',
      to: '2026-10-31T00:00:00Z' });
    await assert.rejects(client.getJson({ url: `${ENDPOINT}?apikey=fixture-key` }));
    assert.deepEqual(client.summary().http_status_counts, { 200: 1 });
    assert.deepEqual(client.summary().schema_issue_counts, { 'page.size:invalid_type': 1 });
    assert.equal(JSON.stringify(client.summary()).includes('schema-secret-sentinel'), false);
    assert.equal(JSON.stringify(client.summary()).includes('fixture-key'), false);
  } finally { globalThis.fetch = originalFetch; }
});
