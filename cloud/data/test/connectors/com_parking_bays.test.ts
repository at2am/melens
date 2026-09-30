import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  API_BASE,
  DATASET_ID,
  LANDING_URL,
  ParkingBaysConnector,
  SOURCE_ID,
  connector,
  countSchema,
  extractKerbsideId,
  extractMarkerId,
  hasValidCoordinates,
  parseBayRow,
  rowSchema,
  type BayRow,
} from '../../src/connectors/com_parking_bays/index.js';
import { isConnector, parseConnectorInput } from '../../src/core/connector.js';
import { HttpClient, HttpFailure, type HttpResponse } from '../../src/core/http.js';
import { loadConnector, loadSourceRegistry, parseSourceManifest, type RegisteredSource } from '../../src/core/registry.js';
import { parseGeometryGeojson } from '../../src/validation/geography.js';
import { parseSourceRecord } from '../../src/validation/record.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(__dirname, '../fixtures/com_parking_bays.json');
const manifestPath = join(__dirname, '../../src/connectors/com_parking_bays/source.json');

async function loadFixture(): Promise<{ total_count: number; results: unknown[] }> {
  const content = await readFile(fixturePath, 'utf8');
  return JSON.parse(content) as { total_count: number; results: unknown[] };
}

test('T027: source.json manifest parses cleanly and maintains review_required candidate status', async () => {
  const manifestRaw = JSON.parse(await readFile(manifestPath, 'utf8'));
  const dataSource = parseSourceManifest(manifestRaw);

  assert.equal(dataSource.source_id, SOURCE_ID);
  assert.equal(dataSource.provider, 'City of Melbourne');
  assert.equal(dataSource.dataset_title, 'On-street Parking Bays');
  assert.equal(dataSource.topic, 'parking');
  assert.equal(dataSource.scope, 'city');
  assert.equal(dataSource.license_status, 'review_required');
  assert.equal(dataSource.access_status, 'candidate');
  assert.equal(dataSource.cadence_seconds, null);
  assert.equal(dataSource.check_interval_seconds, 86400);
  assert.equal(dataSource.record_granularity, 'roadsegment_point_export_row');

  assert.equal(connector.sourceId, SOURCE_ID);
  assert.ok(isConnector(connector));
});

test('T027: source registry loads connector successfully and keeps candidate out of active()', async () => {
  const connectorsDir = fileURLToPath(new URL('../../src/connectors', import.meta.url));
  const registry = await loadSourceRegistry(connectorsDir);

  const entry = registry.get(SOURCE_ID);
  assert.ok(entry, `Source ${SOURCE_ID} must be registered`);
  assert.equal(entry.dataSource.source_id, SOURCE_ID);
  assert.equal(entry.dataSource.license_status, 'review_required');
  assert.equal(entry.dataSource.access_status, 'candidate');

  // Must not be considered active
  assert.equal(
    registry.active().some(s => s.dataSource.source_id === SOURCE_ID),
    false,
    'Candidate review_required source must not be in active()',
  );

  const loaded = await loadConnector(entry);
  assert.ok(isConnector(loaded));
  assert.equal(loaded.sourceId, SOURCE_ID);
});

test('T027: fixture parsing preserves actual point geometry, missing keys, and null marker_id', async () => {
  const fixture = await loadFixture();
  const fetchedAt = '2026-09-29T10:00:00.000Z';

  class MockBayHttpClient extends HttpClient {
    override async getJson<T>(request: Parameters<HttpClient['getJson']>[0]): Promise<HttpResponse<T>> {
      const url = String(request.url);
      if (url.includes('/records?limit=0')) {
        return {
          body: { total_count: fixture.total_count } as T,
          status: 200,
          fetchedAt,
          etag: null,
          lastModified: null,
          contentType: 'application/json',
        };
      }
      if (url.includes('/exports/json')) {
        return {
          body: fixture.results as T,
          status: 200,
          fetchedAt,
          etag: null,
          lastModified: null,
          contentType: 'application/json',
        };
      }
      throw new Error(`Unexpected request url: ${url}`);
    }
  }

  const testConnector = new ParkingBaysConnector(new MockBayHttpClient());
  const input = parseConnectorInput({
    sourceId: SOURCE_ID,
    window: { kind: 'snapshot', revision: '2026-09-29' },
    checkpoint: null,
    runId: 'test_parking_bays_run',
  });

  const result = await testConnector.collect(input);
  assert.equal(result.kind, 'success');
  if (result.kind !== 'success') return;

  assert.equal(result.inputCount, 2);
  assert.equal(result.outputCount, 2);
  assert.equal(result.rejectedCount, 0);
  assert.equal(result.sourceRecords.length, 2);
  assert.equal(result.parkingBays.length, 2);
  assert.equal(result.geoRecords.length, 0);
  assert.equal(result.completeness.complete, true);
  assert.equal(result.completeness.method, 'export_count');
  assert.equal(result.completeness.expected_records, 2);
  assert.equal(result.completeness.fetched_records, 2);

  // Validate SourceRecords
  for (const sr of result.sourceRecords) {
    assert.doesNotThrow(() => parseSourceRecord(sr));
    assert.equal(sr.source_id, SOURCE_ID);
    assert.equal(sr.assertion_kind, 'observation');
    assert.equal(sr.record_status, 'active');
    assert.equal(sr.rights_status, 'review_required');
    assert.equal(sr.time_missing_reason, 'The source provides only an unzoned date, not an exact UTC update time');
    assert.equal(sr.source_updated_at, null);
    assert.equal(sr.original_url, LANDING_URL);
  }

  // Row 1: roadsegmentid 23259, kerbsideid null, coordinates [-37.8224529, 144.9374727]
  // Invariant 1: preserved when kerbsideid is null because valid coordinates exist
  // Invariant 2: marker_id is null (NEVER manufactured)
  // Invariant 3: geometry is Point, NEVER a manufactured polygon
  const bay1 = result.parkingBays[0];
  assert.ok(bay1);
  assert.equal(bay1.source_id, SOURCE_ID);
  assert.equal(bay1.batch_id, 'test_parking_bays_run');
  assert.equal(bay1.marker_id, null, 'marker_id must be null, not manufactured');
  assert.equal(bay1.public_access, null);
  assert.equal(bay1.valid_from, null);
  assert.equal(bay1.valid_to, null);
  assert.equal(bay1.source_updated_at, null);
  assert.ok(bay1.bay_id.startsWith('bay_export:melbourne.parking.bays:23259:null:'));
  assert.ok(bay1.geometry_geojson !== null);

  const geom1 = parseGeometryGeojson(bay1.geometry_geojson!);
  assert.equal(geom1.type, 'Point');
  assert.deepEqual(geom1.coordinates, [144.9374727, -37.8224529]);

  // Row 2: roadsegmentid 23260, kerbsideid "1234", coordinates [-37.8200000, 144.9400000]
  // Invariant: marker_id is null even when kerbsideid is present (no upstream marker_id in export)
  const bay2 = result.parkingBays[1];
  assert.ok(bay2);
  assert.equal(bay2.source_id, SOURCE_ID);
  assert.equal(bay2.batch_id, 'test_parking_bays_run');
  assert.equal(bay2.marker_id, null, 'marker_id must be null; never manufacture kerbside:1234');
  assert.equal(bay2.public_access, null);
  assert.ok(bay2.bay_id.startsWith('bay_export:melbourne.parking.bays:23260:1234:'));
  assert.ok(bay2.geometry_geojson !== null);

  const geom2 = parseGeometryGeojson(bay2.geometry_geojson!);
  assert.equal(geom2.type, 'Point');
  assert.deepEqual(geom2.coordinates, [144.94, -37.82]);
});

test('T027: Missing keys and coordinate variation handling', async () => {
  const rows = [
    // kerbsideid is null, coordinates present -> bay preserved with point geom
    { roadsegmentid: 101, kerbsideid: null, latitude: -37.81, longitude: 144.96, lastupdated: '2025-01-01' },
    // kerbsideid is whitespace -> normalized to null, bay preserved with point geom
    { roadsegmentid: 102, kerbsideid: '   ', latitude: -37.82, longitude: 144.97, lastupdated: '2025-01-01' },
    // kerbsideid is empty string -> normalized to null, bay preserved with point geom
    { roadsegmentid: 103, kerbsideid: '', latitude: -37.83, longitude: 144.98, lastupdated: '2025-01-01' },
    // roadsegmentdescription is missing/undefined -> handled cleanly
    { roadsegmentid: 104, kerbsideid: '400', latitude: -37.84, longitude: 144.99 },
    // coordinates are null, kerbsideid is null -> source record preserved, but NO bay generated
    { roadsegmentid: 105, kerbsideid: null, latitude: null, longitude: null, roadsegmentdescription: 'No coords no kerb' },
    // coordinates are null, kerbsideid is present -> bay preserved with geometry_geojson: null
    { roadsegmentid: 106, kerbsideid: '600', latitude: null, longitude: null, roadsegmentdescription: 'No coords with kerb' },
  ];

  class VariationClient extends HttpClient {
    override async getJson<T>(request: Parameters<HttpClient['getJson']>[0]): Promise<HttpResponse<T>> {
      const url = String(request.url);
      if (url.includes('/records?limit=0')) {
        return { body: { total_count: rows.length } as T, status: 200, fetchedAt: '2026-09-29T10:00:00Z', etag: null, lastModified: null, contentType: 'application/json' };
      }
      return { body: rows as T, status: 200, fetchedAt: '2026-09-29T10:00:00Z', etag: null, lastModified: null, contentType: 'application/json' };
    }
  }

  const connectorInstance = new ParkingBaysConnector(new VariationClient());
  const result = await connectorInstance.collect(parseConnectorInput({
    sourceId: SOURCE_ID,
    window: { kind: 'snapshot', revision: '2026-09-29' },
    checkpoint: null,
    runId: 'variation_test',
  }));

  assert.equal(result.kind, 'success');
  if (result.kind !== 'success') return;

  assert.equal(result.sourceRecords.length, 6);
  // Rows 101, 102, 103 (valid coords, null kerb) -> 3 bays
  // Row 104 (valid coords, kerb 400) -> 1 bay
  // Row 105 (no coords, null kerb) -> skipped for parkingBays
  // Row 106 (no coords, kerb 600) -> 1 bay with geometry_geojson: null
  assert.equal(result.parkingBays.length, 5);

  const bay101 = result.parkingBays.find(b => b.bay_id.includes(':101:'));
  assert.ok(bay101);
  assert.equal(bay101.marker_id, null);
  assert.ok(bay101.geometry_geojson);

  const bay102 = result.parkingBays.find(b => b.bay_id.includes(':102:'));
  assert.ok(bay102);
  assert.equal(bay102.marker_id, null);
  assert.ok(bay102.geometry_geojson);

  const bay103 = result.parkingBays.find(b => b.bay_id.includes(':103:'));
  assert.ok(bay103);
  assert.equal(bay103.marker_id, null);
  assert.ok(bay103.geometry_geojson);

  const bay104 = result.parkingBays.find(b => b.bay_id.includes(':104:'));
  assert.ok(bay104);
  assert.equal(bay104.marker_id, null);
  assert.ok(bay104.geometry_geojson);

  const bay106 = result.parkingBays.find(b => b.bay_id.includes(':106:'));
  assert.ok(bay106);
  assert.equal(bay106.marker_id, null);
  assert.equal(bay106.geometry_geojson, null);

  // 105 must not be in parkingBays
  const bay105 = result.parkingBays.find(b => b.bay_id.includes(':105:'));
  assert.equal(bay105, undefined);
});

test('T027: Preserves actual upstream marker if present, but never manufactures one from kerbsideid', async () => {
  const rows = [
    // Has explicit marker_id from upstream
    { roadsegmentid: 201, kerbsideid: '111', marker_id: 'upstream-marker-A', latitude: -37.81, longitude: 144.96 },
    // Has explicit markerid from upstream
    { roadsegmentid: 202, kerbsideid: '222', markerid: 'upstream-marker-B', latitude: -37.82, longitude: 144.97 },
    // Has numeric marker_id from upstream
    { roadsegmentid: 203, kerbsideid: '333', marker_id: 8888, latitude: -37.83, longitude: 144.98 },
    // Has kerbsideid only -> marker_id MUST be null (never 'kerbside:444')
    { roadsegmentid: 204, kerbsideid: '444', latitude: -37.84, longitude: 144.99 },
  ];

  class MarkerClient extends HttpClient {
    override async getJson<T>(request: Parameters<HttpClient['getJson']>[0]): Promise<HttpResponse<T>> {
      const url = String(request.url);
      if (url.includes('/records?limit=0')) {
        return { body: { total_count: rows.length } as T, status: 200, fetchedAt: '2026-09-29T10:00:00Z', etag: null, lastModified: null, contentType: 'application/json' };
      }
      return { body: rows as T, status: 200, fetchedAt: '2026-09-29T10:00:00Z', etag: null, lastModified: null, contentType: 'application/json' };
    }
  }

  const connectorInstance = new ParkingBaysConnector(new MarkerClient());
  const result = await connectorInstance.collect(parseConnectorInput({
    sourceId: SOURCE_ID,
    window: { kind: 'snapshot', revision: '2026-09-29' },
    checkpoint: null,
    runId: 'marker_test',
  }));

  assert.equal(result.kind, 'success');
  if (result.kind !== 'success') return;

  const bays = result.parkingBays;
  assert.equal(bays.length, 4);

  // Row 201: preserved explicit marker_id
  assert.equal(bays[0]?.marker_id, 'upstream-marker-A');
  // Row 202: preserved explicit markerid
  assert.equal(bays[1]?.marker_id, 'upstream-marker-B');
  // Row 203: preserved numeric marker_id as string
  assert.equal(bays[2]?.marker_id, '8888');
  // Row 204: no upstream marker -> null (NEVER manufactured kerbside:444)
  assert.equal(bays[3]?.marker_id, null);
});

test('T027: Identical duplicate rows are deduplicated idempotently', async () => {
  const row = { roadsegmentid: 501, kerbsideid: '501', latitude: -37.81, longitude: 144.96, lastupdated: '2025-01-01' };
  const rows = [row, { ...row }]; // Duplicate identical row

  class DedupeClient extends HttpClient {
    override async getJson<T>(request: Parameters<HttpClient['getJson']>[0]): Promise<HttpResponse<T>> {
      const url = String(request.url);
      if (url.includes('/records?limit=0')) {
        return { body: { total_count: 2 } as T, status: 200, fetchedAt: '2026-09-29T10:00:00Z', etag: null, lastModified: null, contentType: 'application/json' };
      }
      return { body: rows as T, status: 200, fetchedAt: '2026-09-29T10:00:00Z', etag: null, lastModified: null, contentType: 'application/json' };
    }
  }

  const connectorInstance = new ParkingBaysConnector(new DedupeClient());
  const result = await connectorInstance.collect(parseConnectorInput({
    sourceId: SOURCE_ID,
    window: { kind: 'snapshot', revision: '2026-09-29' },
    checkpoint: null,
    runId: 'dedupe_test',
  }));

  assert.equal(result.kind, 'success');
  if (result.kind !== 'success') return;

  assert.equal(result.inputCount, 2);
  assert.equal(result.outputCount, 1);
  assert.equal(result.sourceRecords.length, 1);
  assert.equal(result.parkingBays.length, 1);
});

test('T027: Conflicting duplicate native IDs fail closed with validation_failed', async () => {
  const rows = [
    { roadsegmentid: 601, kerbsideid: '601', latitude: -37.81, longitude: 144.96, roadsegmentdescription: 'Version A' },
    { roadsegmentid: 601, kerbsideid: '601', latitude: -37.81, longitude: 144.96, roadsegmentdescription: 'Version B' },
  ];

  class ConflictClient extends HttpClient {
    override async getJson<T>(request: Parameters<HttpClient['getJson']>[0]): Promise<HttpResponse<T>> {
      const url = String(request.url);
      if (url.includes('/records?limit=0')) {
        return { body: { total_count: 2 } as T, status: 200, fetchedAt: '2026-09-29T10:00:00Z', etag: null, lastModified: null, contentType: 'application/json' };
      }
      return { body: rows as T, status: 200, fetchedAt: '2026-09-29T10:00:00Z', etag: null, lastModified: null, contentType: 'application/json' };
    }
  }

  const connectorInstance = new ParkingBaysConnector(new ConflictClient());
  const result = await connectorInstance.collect(parseConnectorInput({
    sourceId: SOURCE_ID,
    window: { kind: 'snapshot', revision: '2026-09-29' },
    checkpoint: null,
    runId: 'conflict_test',
  }));

  assert.equal(result.kind, 'failure');
  if (result.kind !== 'failure') return;
  assert.equal(result.code, 'validation_failed');
  assert.ok(result.message.includes('Conflicting duplicate native ID'));
});

test('T027: Incomplete window fails when export count does not match total_count', async () => {
  class IncompleteClient extends HttpClient {
    override async getJson<T>(request: Parameters<HttpClient['getJson']>[0]): Promise<HttpResponse<T>> {
      const url = String(request.url);
      if (url.includes('/records?limit=0')) {
        return { body: { total_count: 100 } as T, status: 200, fetchedAt: '2026-09-29T10:00:00Z', etag: null, lastModified: null, contentType: 'application/json' };
      }
      return {
        body: [
          { roadsegmentid: 1, kerbsideid: '1', latitude: -37.8, longitude: 144.9 },
        ] as T,
        status: 200,
        fetchedAt: '2026-09-29T10:00:00Z',
        etag: null,
        lastModified: null,
        contentType: 'application/json',
      };
    }
  }

  const connectorInstance = new ParkingBaysConnector(new IncompleteClient());
  const result = await connectorInstance.collect(parseConnectorInput({
    sourceId: SOURCE_ID,
    window: { kind: 'snapshot', revision: '2026-09-29' },
    checkpoint: null,
    runId: 'incomplete_test',
  }));

  assert.equal(result.kind, 'failure');
  if (result.kind !== 'failure') return;
  assert.equal(result.code, 'incomplete_window');
  assert.ok(result.message.includes('Export row count (1) did not match total_count (100)'));
});

test('T027: Schema changed error on invalid total_count or row schema', async () => {
  // Case A: invalid total_count (negative)
  class InvalidCountClient extends HttpClient {
    override async getJson<T>(): Promise<HttpResponse<T>> {
      return { body: { total_count: -5 } as T, status: 200, fetchedAt: '2026-09-29T10:00:00Z', etag: null, lastModified: null, contentType: 'application/json' };
    }
  }

  const connA = new ParkingBaysConnector(new InvalidCountClient());
  const resA = await connA.collect(parseConnectorInput({
    sourceId: SOURCE_ID,
    window: { kind: 'snapshot', revision: '2026-09-29' },
    checkpoint: null,
    runId: 'schema_test_a',
  }));
  assert.equal(resA.kind, 'failure');
  if (resA.kind === 'failure') {
    assert.equal(resA.code, 'schema_changed');
  }

  // Case B: invalid row schema (negative roadsegmentid)
  class InvalidRowClient extends HttpClient {
    override async getJson<T>(request: Parameters<HttpClient['getJson']>[0]): Promise<HttpResponse<T>> {
      const url = String(request.url);
      if (url.includes('/records?limit=0')) {
        return { body: { total_count: 1 } as T, status: 200, fetchedAt: '2026-09-29T10:00:00Z', etag: null, lastModified: null, contentType: 'application/json' };
      }
      return {
        body: [{ roadsegmentid: -1, kerbsideid: '1' }] as T,
        status: 200,
        fetchedAt: '2026-09-29T10:00:00Z',
        etag: null,
        lastModified: null,
        contentType: 'application/json',
      };
    }
  }

  const connB = new ParkingBaysConnector(new InvalidRowClient());
  const resB = await connB.collect(parseConnectorInput({
    sourceId: SOURCE_ID,
    window: { kind: 'snapshot', revision: '2026-09-29' },
    checkpoint: null,
    runId: 'schema_test_b',
  }));
  assert.equal(resB.kind, 'failure');
  if (resB.kind === 'failure') {
    assert.equal(resB.code, 'schema_changed');
  }
});

test('T027: HTTP failure handling (rate limit, unavailable, auth)', async () => {
  // 429 Rate limited with retryAfterMs
  class RateLimitedClient extends HttpClient {
    override async getJson<T>(): Promise<HttpResponse<T>> {
      throw new HttpFailure('rate_limited', 429, 1, 45_000);
    }
  }
  const conn429 = new ParkingBaysConnector(new RateLimitedClient());
  const res429 = await conn429.collect(parseConnectorInput({
    sourceId: SOURCE_ID,
    window: { kind: 'snapshot', revision: '2026-09-29' },
    checkpoint: null,
    runId: 'rate_test',
  }));
  assert.equal(res429.kind, 'failure');
  if (res429.kind === 'failure') {
    assert.equal(res429.code, 'rate_limited');
    assert.equal(res429.retryAfterSeconds, 45);
  }

  // 503 Upstream unavailable
  class UnavailableClient extends HttpClient {
    override async getJson<T>(): Promise<HttpResponse<T>> {
      throw new HttpFailure('upstream_unavailable', 503, 3);
    }
  }
  const conn503 = new ParkingBaysConnector(new UnavailableClient());
  const res503 = await conn503.collect(parseConnectorInput({
    sourceId: SOURCE_ID,
    window: { kind: 'snapshot', revision: '2026-09-29' },
    checkpoint: null,
    runId: 'unavail_test',
  }));
  assert.equal(res503.kind, 'failure');
  if (res503.kind === 'failure') {
    assert.equal(res503.code, 'upstream_unavailable');
    assert.equal(res503.retryAfterSeconds, null);
  }

  // Auth failure
  class AuthClient extends HttpClient {
    override async getJson<T>(): Promise<HttpResponse<T>> {
      throw new HttpFailure('auth_failed', 403, 1);
    }
  }
  const connAuth = new ParkingBaysConnector(new AuthClient());
  const resAuth = await connAuth.collect(parseConnectorInput({
    sourceId: SOURCE_ID,
    window: { kind: 'snapshot', revision: '2026-09-29' },
    checkpoint: null,
    runId: 'auth_test',
  }));
  assert.equal(resAuth.kind, 'failure');
  if (resAuth.kind === 'failure') {
    assert.equal(resAuth.code, 'auth_failed');
  }
});

test('T027: Source ID mismatch fails validation', async () => {
  const testConn = new ParkingBaysConnector();
  const res = await testConn.collect(parseConnectorInput({
    sourceId: 'other.source.id' as any,
    window: { kind: 'snapshot', revision: '2026-09-29' },
    checkpoint: null,
    runId: 'mismatch_test',
  }));
  assert.equal(res.kind, 'failure');
  if (res.kind === 'failure') {
    assert.equal(res.code, 'validation_failed');
    assert.ok(res.message.includes('Expected sourceId melbourne.parking.bays'));
  }
});

test('T027: Helper functions unit tests', () => {
  // extractKerbsideId
  assert.equal(extractKerbsideId(null), null);
  assert.equal(extractKerbsideId(undefined), null);
  assert.equal(extractKerbsideId(''), null);
  assert.equal(extractKerbsideId('   '), null);
  assert.equal(extractKerbsideId('1234'), '1234');
  assert.equal(extractKerbsideId('  5678  '), '5678');
  assert.equal(extractKerbsideId(9876), '9876');

  // extractMarkerId
  assert.equal(extractMarkerId({}), null);
  assert.equal(extractMarkerId({ marker_id: null }), null);
  assert.equal(extractMarkerId({ marker_id: undefined }), null);
  assert.equal(extractMarkerId({ marker_id: '' }), null);
  assert.equal(extractMarkerId({ marker_id: '   ' }), null);
  assert.equal(extractMarkerId({ marker_id: 'M-123' }), 'M-123');
  assert.equal(extractMarkerId({ markerid: 'M-456' }), 'M-456');
  assert.equal(extractMarkerId({ marker_id: 7777 }), '7777');
  assert.equal(extractMarkerId({ marker_id: 'M-1', markerid: 'M-2' }), 'M-1'); // preference

  // hasValidCoordinates
  assert.equal(hasValidCoordinates(-37.8, 144.9), true);
  assert.equal(hasValidCoordinates(0, 0), true);
  assert.equal(hasValidCoordinates(-90, -180), true);
  assert.equal(hasValidCoordinates(90, 180), true);
  assert.equal(hasValidCoordinates('-37.8', '144.9'), true);
  assert.equal(hasValidCoordinates(null, 144.9), false);
  assert.equal(hasValidCoordinates(-37.8, null), false);
  assert.equal(hasValidCoordinates(undefined, 144.9), false);
  assert.equal(hasValidCoordinates(-37.8, undefined), false);
  assert.equal(hasValidCoordinates(90.1, 144.9), false);
  assert.equal(hasValidCoordinates(-90.1, 144.9), false);
  assert.equal(hasValidCoordinates(-37.8, 180.1), false);
  assert.equal(hasValidCoordinates(-37.8, -180.1), false);
  assert.equal(hasValidCoordinates(Number.NaN, 144.9), false);
  assert.equal(hasValidCoordinates(Number.POSITIVE_INFINITY, 144.9), false);

  // parseBayRow
  assert.doesNotThrow(() => parseBayRow({ roadsegmentid: 123 }));
  assert.doesNotThrow(() => parseBayRow({
    roadsegmentid: 123,
    kerbsideid: 'K1',
    latitude: -37.8,
    longitude: 144.9,
    roadsegmentdescription: 'desc',
    lastupdated: '2025-01-01',
  }));
  assert.throws(() => parseBayRow({ roadsegmentid: -1 }));
  assert.throws(() => parseBayRow({ roadsegmentid: 'abc', latitude: 100 }));
});
