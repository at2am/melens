import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  DATASET_ID,
  ParkingSensorsConnector,
  SOURCE_ID,
  computeUpstreamLatency,
  connector,
  deriveOccupancy,
  extractMarkerAndBayId,
  parseSensorRow,
} from '../../src/connectors/com_parking_sensors/index.js';
import { parseConnectorInput } from '../../src/core/connector.js';
import { HttpClient, type HttpRequest, type HttpResponse } from '../../src/core/http.js';
import { OdsIncompleteWindow, OpenDataSoftClient, type OdsQuery, type OdsRecords } from '../../src/core/opendatasoft.js';
import { parseSourceManifest } from '../../src/core/registry.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(__dirname, '../fixtures/com_parking_sensors.json');
const manifestPath = join(__dirname, '../../src/connectors/com_parking_sensors/source.json');

async function loadFixtureRecords(): Promise<{ total_count: number; results: unknown[] }> {
  const content = await readFile(fixturePath, 'utf8');
  return JSON.parse(content) as { total_count: number; results: unknown[] };
}

test('Source manifest has complete reviewed open-data admission', async () => {
  const manifestRaw = JSON.parse(await readFile(manifestPath, 'utf8'));
  const dataSource = parseSourceManifest(manifestRaw);

  assert.equal(dataSource.source_id, SOURCE_ID);
  assert.equal(dataSource.topic, 'parking');
  assert.equal(dataSource.scope, 'city');
  assert.equal(dataSource.license_status, 'verified_open');
  assert.ok(['candidate', 'active'].includes(dataSource.access_status));
  assert.deepEqual(dataSource.admission_evidence.missing_requirements, []);
  assert.equal(connector.sourceId, SOURCE_ID);
});

test('production sensor transport uses two bounded requests and verifies the complete JSON export', async () => {
  const fixture = await loadFixtureRecords();
  const requests: HttpRequest[] = [];
  class ExportClient extends HttpClient {
    override async getJson(request: HttpRequest): Promise<HttpResponse<unknown>> {
      requests.push(request);
      return { body: String(request.url).endsWith('/records?limit=0')
        ? { total_count: fixture.total_count } : fixture.results,
      status: 200, fetchedAt: '2026-09-29T10:00:00Z', etag: null,
      lastModified: null, contentType: 'application/json' };
    }
  }
  const result = await new ParkingSensorsConnector(new ExportClient()).collect(parseConnectorInput({
    sourceId: SOURCE_ID, window: { kind: 'snapshot', revision: '2026-09-29' },
    checkpoint: null, runId: 'complete-export',
  }));
  assert.equal(result.kind, 'success');
  if (result.kind !== 'success') return;
  assert.equal(result.parkingObservations.length, fixture.total_count);
  assert.equal(result.completeness.method, 'export_count');
  assert.equal(requests.length, 2);
  assert.ok(requests.every(request => request.maxAttempts === 1 && request.redirect === 'error'));
});

test('a drifting export count fails the whole sensor collection', async () => {
  class DriftingExport extends HttpClient {
    override async getJson(request: HttpRequest): Promise<HttpResponse<unknown>> {
      return { body: String(request.url).endsWith('/records?limit=0') ? { total_count: 1 } : [],
        status: 200, fetchedAt: '2026-09-29T10:00:00Z', etag: null,
        lastModified: null, contentType: 'application/json' };
    }
  }
  const result = await new ParkingSensorsConnector(new DriftingExport()).collect(parseConnectorInput({
    sourceId: SOURCE_ID, window: { kind: 'snapshot', revision: '2026-09-29' },
    checkpoint: null, runId: 'drifting-export',
  }));
  assert.equal(result.kind, 'failure');
  if (result.kind !== 'failure') return;
  assert.equal(result.code, 'incomplete_window');
});

test('com_parking_sensors parses fixture and produces valid observations, source records, and geo records', async () => {
  const fixture = await loadFixtureRecords();

  class MockParkingClient extends OpenDataSoftClient {
    override async fetchRecords(query: OdsQuery): Promise<OdsRecords> {
      assert.equal(query.datasetId, DATASET_ID);
      assert.equal(query.orderBy, 'kerbsideid ASC');
      return {
        records: fixture.results,
        totalCount: fixture.total_count,
        pageCount: 1,
        fetchedAt: '2026-09-29T10:00:00Z',
        lastModified: '2026-09-28T18:45:00Z',
      };
    }
  }

  const testConnector = new ParkingSensorsConnector(new MockParkingClient());
  const input = parseConnectorInput({
    sourceId: SOURCE_ID,
    window: { kind: 'snapshot', revision: '2026-09-29' },
    checkpoint: null,
    runId: 'test_parking_sensors_run',
  });

  const result = await testConnector.collect(input);
  assert.equal(result.kind, 'success');
  if (result.kind !== 'success') return;

  assert.equal(result.inputCount, 4);
  assert.equal(result.outputCount, 4);
  assert.equal(result.rejectedCount, 0);
  assert.equal(result.sourceRecords.length, 4);
  assert.equal(result.parkingObservations.length, 4);
  assert.equal(result.geoRecords.length, 4);
  assert.equal(result.geoRecordSources.length, 4);
  assert.equal(result.sourceLatestUpdateAt, '2026-09-28T18:45:00.000Z');

  for (const record of result.sourceRecords) {
    assert.equal(record.rights_status, 'verified_open');
    assert.equal(record.assertion_kind, 'observation');
    assert.equal(record.record_status, 'active');
  }

  for (const geo of result.geoRecords) {
    assert.equal(geo.rights_status, 'verified_open');
    assert.equal(geo.assertion_kind, 'observation');
    assert.equal(geo.public_query_allowed, true);
    assert.equal(geo.location_role, 'sensor_site');
    assert.equal(geo.location_confidence, 'source_coordinate');
  }
});

test('Occupancy preserves true, false, and null without treating missing records as unoccupied', async () => {
  const fixture = await loadFixtureRecords();

  class MockParkingClient extends OpenDataSoftClient {
    override async fetchRecords(): Promise<OdsRecords> {
      return {
        records: fixture.results,
        totalCount: fixture.total_count,
        pageCount: 1,
        fetchedAt: '2026-09-29T10:00:00Z',
        lastModified: '2026-09-28T18:45:00Z',
      };
    }
  }

  const testConnector = new ParkingSensorsConnector(new MockParkingClient());
  const result = await testConnector.collect(parseConnectorInput({
    sourceId: SOURCE_ID,
    window: { kind: 'snapshot', revision: '2026-09-29' },
    checkpoint: null,
    runId: 'test_occupancy_run',
  }));

  assert.equal(result.kind, 'success');
  if (result.kind !== 'success') return;

  const obs = result.parkingObservations;

  // Row 1: Unoccupied -> false
  assert.equal(obs[0]?.sensor_id, 'kerbside:9344');
  assert.equal(obs[0]?.occupied, false);

  // Row 2: Present -> true
  assert.equal(obs[1]?.sensor_id, 'kerbside:9623');
  assert.equal(obs[1]?.occupied, true);

  // Row 3: Unknown -> null (NEVER assumed false/unoccupied)
  assert.equal(obs[2]?.sensor_id, 'kerbside:9701');
  assert.equal(obs[2]?.occupied, null);

  // Row 4: Present -> true
  assert.equal(obs[3]?.sensor_id, 'kerbside:9802');
  assert.equal(obs[3]?.occupied, true);

  // Direct unit tests for deriveOccupancy
  assert.equal(deriveOccupancy('Present'), true);
  assert.equal(deriveOccupancy('Occupied'), true);
  assert.equal(deriveOccupancy('PRESENT'), true);
  assert.equal(deriveOccupancy('Unoccupied'), false);
  assert.equal(deriveOccupancy('Vacant'), false);
  assert.equal(deriveOccupancy('Empty'), false);
  assert.equal(deriveOccupancy('Unknown'), null);
  assert.equal(deriveOccupancy('Fault'), null);
  assert.equal(deriveOccupancy(null), null);
  assert.equal(deriveOccupancy(undefined), null);
  assert.equal(deriveOccupancy('Present', false), false);
  assert.equal(deriveOccupancy('Present', null), null);
});

test('Identity retention: preserves explicit marker_id and bay_id when available, keeps missing marker_id and bay_id null without claiming bay join', async () => {
  const fixture = await loadFixtureRecords();

  class MockParkingClient extends OpenDataSoftClient {
    override async fetchRecords(): Promise<OdsRecords> {
      return {
        records: fixture.results,
        totalCount: fixture.total_count,
        pageCount: 1,
        fetchedAt: '2026-09-29T10:00:00Z',
        lastModified: '2026-09-28T18:45:00Z',
      };
    }
  }

  const testConnector = new ParkingSensorsConnector(new MockParkingClient());
  const result = await testConnector.collect(parseConnectorInput({
    sourceId: SOURCE_ID,
    window: { kind: 'snapshot', revision: '2026-09-29' },
    checkpoint: null,
    runId: 'test_identity_run',
  }));

  assert.equal(result.kind, 'success');
  if (result.kind !== 'success') return;

  // Row 1: no explicit marker_id / bay_id -> marker_id = null, bay_id = null (never falls back to sensorKey or claims a bay join)
  assert.equal(result.parkingObservations[0]?.marker_id, null);
  assert.equal(result.parkingObservations[0]?.bay_id, null);

  // Row 2: no explicit marker_id / bay_id -> marker_id = null, bay_id = null
  assert.equal(result.parkingObservations[1]?.marker_id, null);
  assert.equal(result.parkingObservations[1]?.bay_id, null);

  // Row 4: explicit marker_id = 'marker-9802', bay_id = 'bay-9802'
  assert.equal(result.parkingObservations[3]?.marker_id, 'marker-9802');
  assert.equal(result.parkingObservations[3]?.bay_id, 'bay-9802');

  // Direct unit tests for extractMarkerAndBayId
  const missing = extractMarkerAndBayId({ kerbsideid: 1234 });
  assert.equal(missing.sensorKey, 'kerbside:1234');
  assert.equal(missing.markerId, null);
  assert.equal(missing.bayId, null);

  const emptyWhitespace = extractMarkerAndBayId({
    kerbsideid: 1234,
    marker_id: '   ',
    bay_id: '',
  });
  assert.equal(emptyWhitespace.sensorKey, 'kerbside:1234');
  assert.equal(emptyWhitespace.markerId, null);
  assert.equal(emptyWhitespace.bayId, null);

  const nullExplicit = extractMarkerAndBayId({
    kerbsideid: 1234,
    marker_id: null,
    bay_id: null,
  });
  assert.equal(nullExplicit.sensorKey, 'kerbside:1234');
  assert.equal(nullExplicit.markerId, null);
  assert.equal(nullExplicit.bayId, null);

  const explicit = extractMarkerAndBayId({
    kerbsideid: '5678',
    marker_id: 'M-5678',
    bay_id: 'B-5678',
  });
  assert.equal(explicit.sensorKey, 'kerbside:5678');
  assert.equal(explicit.markerId, 'M-5678');
  assert.equal(explicit.bayId, 'B-5678');

  const legacyNames = extractMarkerAndBayId({
    kerbsideid: '9999',
    markerid: 'M-9999',
    bayid: 'B-9999',
  });
  assert.equal(legacyNames.sensorKey, 'kerbside:9999');
  assert.equal(legacyNames.markerId, 'M-9999');
  assert.equal(legacyNames.bayId, 'B-9999');

  const numericIds = extractMarkerAndBayId({
    kerbsideid: '7777',
    marker_id: 7777,
    bay_id: 8888,
  });
  assert.equal(numericIds.sensorKey, 'kerbside:7777');
  assert.equal(numericIds.markerId, '7777');
  assert.equal(numericIds.bayId, '8888');
});

test('Timestamp and upstream latency preservation', async () => {
  const fixture = await loadFixtureRecords();
  const fetchedAt = '2026-09-29T10:00:00Z';

  class MockParkingClient extends OpenDataSoftClient {
    override async fetchRecords(): Promise<OdsRecords> {
      return {
        records: fixture.results,
        totalCount: fixture.total_count,
        pageCount: 1,
        fetchedAt,
        lastModified: '2026-09-28T18:45:00Z',
      };
    }
  }

  const testConnector = new ParkingSensorsConnector(new MockParkingClient());
  const result = await testConnector.collect(parseConnectorInput({
    sourceId: SOURCE_ID,
    window: { kind: 'snapshot', revision: '2026-09-29' },
    checkpoint: null,
    runId: 'test_latency_run',
  }));

  assert.equal(result.kind, 'success');
  if (result.kind !== 'success') return;

  // Row 2: status_timestamp = '2026-09-28T13:07:50+00:00', lastupdated = '2026-09-28T18:38:50+00:00'
  const row2Source = result.sourceRecords[1];
  assert.ok(row2Source);
  assert.equal(row2Source.observed_at, '2026-09-28T13:07:50.000Z');
  assert.equal(row2Source.source_updated_at, '2026-09-28T18:38:50.000Z');

  const latency = computeUpstreamLatency({
    observed_at: row2Source.observed_at,
    source_updated_at: row2Source.source_updated_at,
    fetched_at: row2Source.fetched_at,
  });

  // sensorToSourceLatencySeconds = (18:38:50 - 13:07:50) = 5h 31m = 19,860s
  assert.equal(latency.sensorToSourceLatencySeconds, 19860);
  assert.ok(latency.sourceToFetchLatencySeconds !== null && latency.sourceToFetchLatencySeconds > 0);
  assert.ok(latency.totalLatencySeconds !== null && latency.totalLatencySeconds > 0);

  // Missing timestamp returns null safely
  const nullLatency = computeUpstreamLatency({
    observed_at: null,
    source_updated_at: '2026-09-28T18:38:50.000Z',
    fetched_at: null,
  });
  assert.equal(nullLatency.sensorToSourceLatencySeconds, null);
  assert.equal(nullLatency.totalLatencySeconds, null);
});

test('Validation: duplicate kerbsideid fails validation', async () => {
  const fixture = await loadFixtureRecords();
  const duplicateRecords = [...fixture.results, fixture.results[0]];

  class DuplicateParkingClient extends OpenDataSoftClient {
    override async fetchRecords(): Promise<OdsRecords> {
      return {
        records: duplicateRecords,
        totalCount: duplicateRecords.length,
        pageCount: 1,
        fetchedAt: '2026-09-29T10:00:00Z',
        lastModified: '2026-09-28T18:45:00Z',
      };
    }
  }

  const testConnector = new ParkingSensorsConnector(new DuplicateParkingClient());
  const result = await testConnector.collect(parseConnectorInput({
    sourceId: SOURCE_ID,
    window: { kind: 'snapshot', revision: '2026-09-29' },
    checkpoint: null,
    runId: 'test_duplicate_run',
  }));

  assert.equal(result.kind, 'failure');
  if (result.kind === 'failure') {
    assert.equal(result.code, 'validation_failed');
    assert.ok(result.message.includes('Duplicate kerbsideid'));
  }
});

test('Validation: mismatched sourceId fails validation', async () => {
  const testConnector = new ParkingSensorsConnector();
  const result = await testConnector.collect(parseConnectorInput({
    sourceId: 'melbourne.parking.bays',
    window: { kind: 'snapshot', revision: '2026-09-29' },
    checkpoint: null,
    runId: 'test_mismatch_run',
  }));

  assert.equal(result.kind, 'failure');
  if (result.kind === 'failure') {
    assert.equal(result.code, 'validation_failed');
    assert.ok(result.message.includes('Expected sourceId'));
  }
});

test('Error mapping: OdsIncompleteWindow maps to incomplete_window', async () => {
  class IncompleteClient extends OpenDataSoftClient {
    override async fetchRecords(): Promise<OdsRecords> {
      throw new OdsIncompleteWindow('test window gap', 10);
    }
  }

  const testConnector = new ParkingSensorsConnector(new IncompleteClient());
  const result = await testConnector.collect(parseConnectorInput({
    sourceId: SOURCE_ID,
    window: { kind: 'snapshot', revision: '2026-09-29' },
    checkpoint: null,
    runId: 'test_incomplete_run',
  }));

  assert.equal(result.kind, 'failure');
  if (result.kind === 'failure') {
    assert.equal(result.code, 'incomplete_window');
  }
});

test('Error mapping: invalid schema throws and maps to schema_changed', async () => {
  class MalformedClient extends OpenDataSoftClient {
    override async fetchRecords(): Promise<OdsRecords> {
      return {
        records: [{ kerbsideid: 'invalid-not-a-valid-row', lastupdated: 'invalid-date' }],
        totalCount: 1,
        pageCount: 1,
        fetchedAt: '2026-09-29T10:00:00Z',
        lastModified: null,
      };
    }
  }

  const testConnector = new ParkingSensorsConnector(new MalformedClient());
  const result = await testConnector.collect(parseConnectorInput({
    sourceId: SOURCE_ID,
    window: { kind: 'snapshot', revision: '2026-09-29' },
    checkpoint: null,
    runId: 'test_schema_run',
  }));

  assert.equal(result.kind, 'failure');
  if (result.kind === 'failure') {
    assert.equal(result.code, 'schema_changed');
  }
});

test('Empty snapshot does not create observations or treat missing sensors as unoccupied', async () => {
  class EmptyClient extends OpenDataSoftClient {
    override async fetchRecords(): Promise<OdsRecords> {
      return {
        records: [],
        totalCount: 0,
        pageCount: 1,
        fetchedAt: '2026-09-29T10:00:00Z',
        lastModified: null,
      };
    }
  }

  const testConnector = new ParkingSensorsConnector(new EmptyClient());
  const result = await testConnector.collect(parseConnectorInput({
    sourceId: SOURCE_ID,
    window: { kind: 'snapshot', revision: '2026-09-29' },
    checkpoint: null,
    runId: 'test_empty_run',
  }));

  assert.equal(result.kind, 'success');
  if (result.kind === 'success') {
    assert.equal(result.inputCount, 0);
    assert.equal(result.outputCount, 0);
    assert.equal(result.parkingObservations.length, 0);
    assert.equal(result.sourceRecords.length, 0);
    assert.equal(result.geoRecords.length, 0);
  }
});

test('GM-03 Key census: official API schema with missing marker_id and bay_id retains 100% sensor coverage, keeps bay/marker null, and never asserts parking permission', async () => {
  // Representative official snapshot matching the current City of Melbourne API:
  // kerbsideid is 100% present, but marker_id and bay_id are 0% present (100% missing).
  const officialBatch = [
    {
      kerbsideid: 9344,
      lastupdated: '2024-12-30T00:44:37+00:00',
      status_timestamp: '2024-08-18T08:23:46+00:00',
      status_description: 'Unoccupied',
      zone_number: 7394,
      location: { lon: 144.95916, lat: -37.80494 },
    },
    {
      kerbsideid: 9373,
      lastupdated: '2025-01-10T02:44:36+00:00',
      status_timestamp: '2024-08-14T09:22:05+00:00',
      status_description: 'Unoccupied',
      zone_number: 7392,
      location: { lon: 144.95836, lat: -37.80329 },
    },
    {
      kerbsideid: 8735,
      lastupdated: '2024-12-04T23:44:37+00:00',
      status_timestamp: '2024-11-28T02:30:57+00:00',
      status_description: 'Present',
      zone_number: 7084,
      location: { lon: 144.96120, lat: -37.80223 },
    },
    {
      kerbsideid: '24505',
      lastupdated: '2025-01-09T05:44:36+00:00',
      status_timestamp: '2023-08-21T00:09:03+00:00',
      status_description: 'Present',
      zone_number: 7800,
      location: { lon: 144.95759, lat: -37.79756 },
    },
  ];

  class OfficialSnapshotClient extends OpenDataSoftClient {
    override async fetchRecords(): Promise<OdsRecords> {
      return {
        records: officialBatch,
        totalCount: officialBatch.length,
        pageCount: 1,
        fetchedAt: '2026-09-30T12:00:00Z',
        lastModified: '2026-09-30T11:58:53Z',
      };
    }
  }

  const testConnector = new ParkingSensorsConnector(new OfficialSnapshotClient());
  const result = await testConnector.collect(parseConnectorInput({
    sourceId: SOURCE_ID,
    window: { kind: 'snapshot', revision: '2026-09-30' },
    checkpoint: null,
    runId: 'census_proof_run',
  }));

  assert.equal(result.kind, 'success');
  if (result.kind !== 'success') return;

  assert.equal(result.parkingObservations.length, 4);
  assert.equal(result.sourceRecords.length, 4);

  // Check key coverage invariants:
  for (const obs of result.parkingObservations) {
    // 1. sensor_id is 100% covered and formatted as kerbside:<id>
    assert.ok(obs.sensor_id.startsWith('kerbside:'));
    // 2. marker_id is strictly null - never fabricated or inferred from kerbsideid
    assert.equal(obs.marker_id, null);
    // 3. bay_id is strictly null - cannot claim bay join when absent upstream
    assert.equal(obs.bay_id, null);
  }

  // Check occupancy derivations:
  assert.equal(result.parkingObservations[0]?.occupied, false); // Unoccupied -> false
  assert.equal(result.parkingObservations[1]?.occupied, false); // Unoccupied -> false
  assert.equal(result.parkingObservations[2]?.occupied, true);  // Present -> true
  assert.equal(result.parkingObservations[3]?.occupied, true);  // Present -> true

  // Check rights and access status:
  for (const record of result.sourceRecords) {
    assert.equal(record.rights_status, 'verified_open');
    assert.equal(record.assertion_kind, 'observation');
  }
});

test('GM-03 Timestamp absence: missing status_timestamp sets time_missing_reason and omits undated observation', async () => {
  const batchWithoutTimestamp = [
    {
      kerbsideid: 5001,
      lastupdated: '2026-09-30T10:00:00+00:00',
      status_timestamp: null,
      status_description: 'Unoccupied',
      zone_number: 1000,
      location: { lon: 144.95, lat: -37.81 },
    },
  ];

  class MissingTimestampClient extends OpenDataSoftClient {
    override async fetchRecords(): Promise<OdsRecords> {
      return {
        records: batchWithoutTimestamp,
        totalCount: 1,
        pageCount: 1,
        fetchedAt: '2026-09-30T12:00:00Z',
        lastModified: '2026-09-30T10:00:00Z',
      };
    }
  }

  const testConnector = new ParkingSensorsConnector(new MissingTimestampClient());
  const result = await testConnector.collect(parseConnectorInput({
    sourceId: SOURCE_ID,
    window: { kind: 'snapshot', revision: '2026-09-30' },
    checkpoint: null,
    runId: 'missing_timestamp_run',
  }));

  assert.equal(result.kind, 'success');
  if (result.kind !== 'success') return;

  assert.equal(result.sourceRecords.length, 1);
  assert.equal(result.sourceRecords[0]?.observed_at, null);
  assert.equal(result.sourceRecords[0]?.time_missing_reason, 'Status timestamp absent upstream');
  // Undated observation must NOT be created to avoid corrupting time series
  assert.equal(result.parkingObservations.length, 0);
});

test('GM-03 Validation: whitespace or empty kerbsideid is strictly rejected', () => {
  assert.throws(
    () => extractMarkerAndBayId({ kerbsideid: '   ' }),
    /kerbsideid must not be empty/,
  );
  assert.throws(
    () => extractMarkerAndBayId({ kerbsideid: '' }),
    /kerbsideid must not be empty/,
  );
  assert.throws(
    () => parseSensorRow({
      kerbsideid: '   ',
      lastupdated: '2026-09-30T10:00:00Z',
    }),
    /kerbsideid must not be empty/,
  );
});
