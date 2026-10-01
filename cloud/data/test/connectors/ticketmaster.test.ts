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
} from '../../src/connectors/ticketmaster/index.js';

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
  assert.equal(result.geoRecords[0]?.valid_to, '2026-10-01T09:00:00.000Z');
  assert.equal(result.geoRecords[1]?.valid_from, null);
  assert.equal(result.geoRecords[1]?.summary?.includes('postponed'), true);
  assert.equal(result.geoRecords[0]?.public_query_allowed, false);

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
    input.window.kind === 'time' ? input.window.to : null,
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

test('compliance contract: review_required status, public query blocked, and staging retention enforced', async () => {
  const manifest = await loadManifest();
  assert.equal(manifest.source_id, SOURCE_ID);
  assert.equal(manifest.license_status, 'review_required');
  assert.equal(manifest.access_status, 'candidate');
  assert.equal(manifest.admission_evidence.staging_retention_days, 1);
  assert.equal(manifest.admission_evidence.secret_names.includes('ticketmaster_discovery_api_key'), true);
  assert.equal(manifest.admission_evidence.license_evidence_url, 'https://developer.ticketmaster.com/support/terms-of-use/');
  assert.deepEqual(manifest.admission_evidence.allowed_fields, [
    'id',
    'url',
    'name',
    'dates',
    '_embedded.venues.location',
  ]);

  const page = await fixture();
  const res = normalizeTicketEvents(page._embedded?.events ?? [], input, fetchedAt);
  res.sourceRecords.forEach((sr) => {
    assert.equal(sr.rights_status, 'review_required');
    assert.equal(sr.raw_uri, null);
  });
  res.geoRecords.forEach((gr) => {
    assert.equal(gr.rights_status, 'review_required');
    assert.equal(gr.public_query_allowed, false);
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

test('mismatched sourceId or non-time window fails with validation_failed', async () => {
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

  const snapshotInput = parseConnectorInput({
    sourceId: 'ticketmaster.events',
    window: { kind: 'snapshot', revision: 'rev-1' },
    checkpoint: null,
    runId: 'snapshot-window',
  });
  const resBadWindow = await connector.collect(snapshotInput);
  assert.equal(resBadWindow.kind, 'failure');
  if (resBadWindow.kind === 'failure') assert.equal(resBadWindow.code, 'validation_failed');
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
