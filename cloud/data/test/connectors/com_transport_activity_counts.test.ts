import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  ComTransportActivityCountsConnector,
  DATASET_ID,
  SAMPLING_INTERVAL_MINUTES,
  SAMPLING_INTERVAL_MS,
  SOURCE_ID,
  UPSTREAM_ERROR_CODE,
  UPSTREAM_STATUS,
  UPSTREAM_VERIFICATION_DATE,
  UPSTREAM_VERIFIED_MESSAGE,
  comTransportActivityCountsConnector,
  connector,
  parse5MinInterval,
  parseCount,
  type ComTransportActivityCountsRawRecord,
  type ComTransportActivityCountsSuccess,
} from '../../src/connectors/com_transport_activity_counts/index.js';
import { isConnector, parseConnectorInput } from '../../src/core/connector.js';
import { HttpFailure } from '../../src/core/http.js';
import { OdsIncompleteWindow, OpenDataSoftClient, type OdsQuery, type OdsRecords } from '../../src/core/opendatasoft.js';
import { loadConnector, loadSourceRegistry, parseSourceManifest } from '../../src/core/registry.js';
import { validateGeoRecordGeography } from '../../src/validation/geography.js';
import { parseSourceRecord } from '../../src/validation/record.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(__dirname, '../fixtures/com_transport_activity_counts.json');
const manifestPath = join(__dirname, '../../src/connectors/com_transport_activity_counts/source.json');

async function loadFixture(): Promise<{ total_count: number; source_updated_at: string; results: ComTransportActivityCountsRawRecord[] }> {
  const content = await readFile(fixturePath, 'utf8');
  return JSON.parse(content);
}

test('T032: source.json manifest parses cleanly and maintains review_required candidate status with blocked / unavailable upstream status', async () => {
  const manifestRaw = JSON.parse(await readFile(manifestPath, 'utf8'));
  const dataSource = parseSourceManifest(manifestRaw);

  assert.equal(dataSource.source_id, SOURCE_ID);
  assert.equal(dataSource.provider, 'City of Melbourne');
  assert.equal(dataSource.dataset_title, 'Transport Activity Counts');
  assert.equal(dataSource.topic, 'transport');
  assert.equal(dataSource.scope, 'city');
  assert.deepEqual(dataSource.coverage_area_refs, ['com_municipal:1:2008-07-01']);
  assert.equal(dataSource.cadence_seconds, 3600);
  assert.equal(dataSource.check_interval_seconds, 3600);

  // Invariants: review_required and candidate
  assert.equal(dataSource.license_status, 'review_required');
  assert.equal(dataSource.access_status, 'candidate');

  // Upstream verification metadata
  assert.equal(manifestRaw.upstream_status, 'blocked / unavailable');
  assert.equal(UPSTREAM_STATUS, 'blocked / unavailable');
  assert.equal(UPSTREAM_VERIFICATION_DATE, '2026-09-29');
  assert.equal(UPSTREAM_ERROR_CODE, 'NotFoundResource');
  assert.ok(manifestRaw.notes?.includes('404'), 'Manifest notes must document HTTP 404 verification');
  assert.ok(manifestRaw.notes?.includes('blocked / unavailable'), 'Manifest notes must document blocked/unavailable status');
  assert.ok(
    manifestRaw.admission_evidence?.completeness_rule?.includes('404') ||
    manifestRaw.admission_evidence?.completeness_rule?.includes('blocked / unavailable'),
    'Admission completeness rule must record blocked 404 status',
  );

  const connectorsRoot = join(__dirname, '../../src/connectors');
  const fullRegistry = await loadSourceRegistry(connectorsRoot);
  const entry = fullRegistry.get(SOURCE_ID);
  assert.ok(entry, `${SOURCE_ID} must be registered in SourceRegistry`);
  assert.equal(fullRegistry.active().some(active => active.dataSource.source_id === SOURCE_ID), false,
    'This candidate review_required source must not be in active()');

  assert.ok(isConnector(connector));
  assert.equal(connector.sourceId, SOURCE_ID);

  const loadedConnector = await loadConnector(entry);
  assert.ok(isConnector(loadedConnector));
  assert.equal(loadedConnector.sourceId, SOURCE_ID);
});

test('T032 Requirement 3a: offline fixture parsing works correctly when fixture is provided (full collection and domain invariants)', async () => {
  const fixture = await loadFixture();

  class MockExploreClient extends OpenDataSoftClient {
    override async fetchRecords(query: OdsQuery): Promise<OdsRecords> {
      assert.equal(query.datasetId, DATASET_ID);
      return {
        records: fixture.results,
        totalCount: fixture.total_count,
        pageCount: 1,
        fetchedAt: '2026-09-29T10:00:00.000Z',
        lastModified: fixture.source_updated_at,
      };
    }
  }

  const connectorInstance = new ComTransportActivityCountsConnector(new MockExploreClient());
  const input = parseConnectorInput({
    sourceId: SOURCE_ID,
    window: { kind: 'snapshot', revision: 'latest' },
    checkpoint: null,
    runId: 'run-t032-full-test',
  });

  const result = await connectorInstance.collect(input);
  assert.equal(result.kind, 'success');
  if (result.kind !== 'success') return;

  const success = result as ComTransportActivityCountsSuccess;
  assert.equal(success.inputCount, 20);
  assert.equal(success.outputCount, 20);
  assert.equal(success.rejectedCount, 0);
  assert.equal(success.sourceRecords.length, 20);
  assert.equal(success.geoRecords.length, 20);
  assert.equal(success.geoRecordSources.length, 20);
  assert.equal(success.activities.length, 20);

  // Entities not emitted by transport activity counts must be empty
  assert.equal(success.boundaries.length, 0);
  assert.equal(success.areaIndicators.length, 0);
  assert.equal(success.parkingBays.length, 0);
  assert.equal(success.parkingObservations.length, 0);
  assert.equal(success.parkingRules.length, 0);
  assert.equal(success.sensorLocations.length, 0);
  assert.equal(success.pedestrianObservations.length, 0);

  // Validate all SourceRecords
  for (const sr of success.sourceRecords) {
    const parsed = parseSourceRecord(sr);
    assert.equal(parsed.rights_status, 'review_required');
    assert.equal(parsed.record_status, 'active');
    assert.equal(parsed.assertion_kind, 'observation');
    assert.ok(parsed.valid_from !== null && parsed.valid_to !== null);
    const durationMs = Date.parse(parsed.valid_to) - Date.parse(parsed.valid_from);
    assert.equal(durationMs, SAMPLING_INTERVAL_MS, 'Each interval must span exactly 5 minutes');
  }

  // Validate all GeoRecords
  for (const gr of success.geoRecords) {
    assert.equal(gr.topic, 'transport');
    assert.equal(gr.assertion_kind, 'observation');
    assert.equal(gr.rights_status, 'review_required');
    assert.equal(gr.public_query_allowed, false);
    assert.equal(gr.freshness_state, 'unknown');
    assert.ok(
      gr.summary?.includes('Applies strictly to this instrumented corridor; does NOT claim universal citywide coverage.'),
      'GeoRecord summary must disclaim universal citywide coverage',
    );

    const geoVal = validateGeoRecordGeography(gr);
    assert.equal(geoVal.valid, true, `GeoRecord failed geography validation: ${geoVal.issues.join(', ')}`);
  }
});

test('T032 Requirement 3a: legacy runner helper executes offline when fixturePath is provided', async () => {
  const result = await comTransportActivityCountsConnector({
    sourceId: SOURCE_ID,
    runId: 'legacy-fixture-run',
    options: {
      fixturePath,
    },
  });

  assert.equal(result.kind, 'success');
  if (result.kind !== 'success') return;

  const success = result as ComTransportActivityCountsSuccess;
  assert.equal(success.inputCount, 20);
  assert.equal(success.outputCount, 20);
  assert.equal(success.activities.length, 20);
});

test('T032 Requirement 3b: upstream HTTP 404 produces ConnectorFailure (schema_changed) and NEVER silently succeeds with empty records', async () => {
  // Part 1: Mock OpenDataSoftClient simulating upstream 404 (throws HttpFailure with schema_changed / 404)
  class NotFoundExploreClient extends OpenDataSoftClient {
    override async fetchRecords(_query: OdsQuery): Promise<OdsRecords> {
      throw new HttpFailure('schema_changed', 404, 1);
    }
  }

  const notFoundConnector = new ComTransportActivityCountsConnector(new NotFoundExploreClient());
  const failureResult = await notFoundConnector.collect(parseConnectorInput({
    sourceId: SOURCE_ID,
    window: { kind: 'snapshot', revision: 'latest' },
    checkpoint: null,
    runId: 'run-404-test',
  }));

  // Must fail gracefully as ConnectorFailure
  assert.equal(failureResult.kind, 'failure', '404 response must produce kind: failure');
  if (failureResult.kind === 'failure') {
    assert.equal(failureResult.code, 'schema_changed');
    assert.equal(failureResult.completeness.complete, false);
    assert.equal(failureResult.completeness.fetched_records, 0);
    assert.ok(failureResult.message.includes('404'), 'Failure message must record status 404');
    assert.ok(
      failureResult.completeness.evidence.includes('404') &&
      failureResult.completeness.evidence.includes('blocked / unavailable'),
      'Failure evidence must record 404 and blocked / unavailable status',
    );
  }

  // Part 2: Full HTTP stack test against local server returning HTTP 404 NotFoundResource
  const notFoundServer = createServer((_req, res) => {
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      error_code: 'NotFoundResource',
      message: UPSTREAM_VERIFIED_MESSAGE,
    }));
  });

  await new Promise<void>((resolve) => notFoundServer.listen(0, '127.0.0.1', resolve));
  const addr = notFoundServer.address();
  const port = typeof addr === 'object' && addr !== null ? addr.port : 0;
  const localPortalUrl = `http://127.0.0.1:${port}`;

  try {
    const liveStackConnector = new ComTransportActivityCountsConnector(new OpenDataSoftClient(), localPortalUrl);
    const localResult = await liveStackConnector.collect(parseConnectorInput({
      sourceId: SOURCE_ID,
      window: { kind: 'snapshot', revision: 'latest' },
      checkpoint: null,
      runId: 'run-http-404-local',
    }));

    assert.equal(localResult.kind, 'failure');
    if (localResult.kind === 'failure') {
      assert.equal(localResult.code, 'schema_changed');
      assert.equal(localResult.completeness.complete, false);
      assert.equal(localResult.completeness.fetched_records, 0);
      assert.ok(localResult.message.includes('404'));
      assert.ok(localResult.completeness.evidence.includes('404'));
    }

    // Part 3: comTransportActivityCountsConnector without fixturePath does NOT fall back to fixture
    const helperResult = await comTransportActivityCountsConnector({
      sourceId: SOURCE_ID,
      runId: 'helper-no-fixture',
      options: {
        baseUrl: localPortalUrl,
      },
    });

    assert.equal(helperResult.kind, 'failure', 'Helper without fixturePath must NOT fall back to fixture');
    if (helperResult.kind === 'failure') {
      assert.equal(helperResult.code, 'schema_changed');
      assert.equal(helperResult.completeness.complete, false);
    }
  } finally {
    await new Promise<void>((resolve) => notFoundServer.close(() => resolve()));
  }

  // Part 4: Live default connector instance against data.melbourne.vic.gov.au
  const liveResult = await connector.collect(parseConnectorInput({
    sourceId: SOURCE_ID,
    window: { kind: 'snapshot', revision: 'latest' },
    checkpoint: null,
    runId: 'run-live-upstream-check',
  }));

  assert.equal(liveResult.kind, 'failure', 'Live upstream dataset must fail (never succeed silently)');
  if (liveResult.kind === 'failure') {
    assert.equal(liveResult.completeness.complete, false);
    assert.equal(liveResult.completeness.fetched_records, 0);
    // When online, status is schema_changed (404); when offline, upstream_unavailable
    assert.ok(
      liveResult.code === 'schema_changed' || liveResult.code === 'upstream_unavailable',
      `Live failure code must be schema_changed or upstream_unavailable, got: ${liveResult.code}`,
    );
  }
});

test('T032 Requirement 3c: modal categories (vehicle, bicycle, pedestrian) are preserved distinctly and never cross-aggregated', async () => {
  const fixture = await loadFixture();

  class MockExploreClient extends OpenDataSoftClient {
    override async fetchRecords(): Promise<OdsRecords> {
      return {
        records: fixture.results,
        totalCount: fixture.total_count,
        pageCount: 1,
        fetchedAt: '2026-09-29T10:00:00.000Z',
        lastModified: fixture.source_updated_at,
      };
    }
  }

  const connectorInstance = new ComTransportActivityCountsConnector(new MockExploreClient());
  const input = parseConnectorInput({
    sourceId: SOURCE_ID,
    window: { kind: 'snapshot', revision: 'latest' },
    checkpoint: null,
    runId: 'run-t032-modal-test',
  });

  const result = await connectorInstance.collect(input);
  assert.equal(result.kind, 'success');
  if (result.kind !== 'success') return;

  const success = result as ComTransportActivityCountsSuccess;

  // Record 0 (Swanston St NB): vehicle: 12, bicycle: 34, pedestrian: 142, total: 188
  const rec0 = success.activities[0]!;
  assert.equal(rec0.sensor_id, 'TAC_001');
  assert.equal(rec0.direction, 'Northbound');
  assert.equal(rec0.vehicle_count, 12);
  assert.equal(rec0.bicycle_count, 34);
  assert.equal(rec0.pedestrian_count, 142);
  assert.equal(rec0.total_count, 188);
  assert.equal(rec0.status, 'observed');

  // Record 4 (Bourke St Mall EB): genuine 0 vehicle count preserved distinctly
  const rec4 = success.activities[4]!;
  assert.equal(rec4.sensor_id, 'TAC_002');
  assert.equal(rec4.vehicle_count, 0, 'Observed 0 vehicle count must remain 0, never converted to null');
  assert.equal(rec4.bicycle_count, 5);
  assert.equal(rec4.pedestrian_count, 280);
  assert.equal(rec4.total_count, 285);
  assert.equal(rec4.status, 'observed');

  // Record 6 (Collins St WB): bicycle_count is null in fixture
  const rec6 = success.activities[6]!;
  assert.equal(rec6.sensor_id, 'TAC_003');
  assert.equal(rec6.vehicle_count, 45);
  assert.equal(rec6.bicycle_count, null, 'Omitted bicycle count must remain null, NOT zero-filled');
  assert.equal(rec6.pedestrian_count, 85);
  assert.equal(rec6.total_count, 130);
  assert.equal(rec6.status, 'observed');

  // Record 8 (Flinders St Inbound): pedestrian_count is null in fixture
  const rec8 = success.activities[8]!;
  assert.equal(rec8.sensor_id, 'TAC_004');
  assert.equal(rec8.direction, 'Inbound');
  assert.equal(rec8.vehicle_count, 62);
  assert.equal(rec8.bicycle_count, 18);
  assert.equal(rec8.pedestrian_count, null, 'Omitted pedestrian count must remain null, NOT zero-filled');
  assert.equal(rec8.total_count, 80);
  assert.equal(rec8.status, 'observed');
});

test('T032 Requirement 3c: 5-minute sampling interval and no zero-filling for missing telemetry', async () => {
  const fixture = await loadFixture();

  class MockExploreClient extends OpenDataSoftClient {
    override async fetchRecords(): Promise<OdsRecords> {
      return {
        records: fixture.results,
        totalCount: fixture.total_count,
        pageCount: 1,
        fetchedAt: '2026-09-29T10:00:00.000Z',
        lastModified: fixture.source_updated_at,
      };
    }
  }

  const connectorInstance = new ComTransportActivityCountsConnector(new MockExploreClient());
  const input = parseConnectorInput({
    sourceId: SOURCE_ID,
    window: { kind: 'snapshot', revision: 'latest' },
    checkpoint: null,
    runId: 'run-t032-interval-test',
  });

  const result = await connectorInstance.collect(input);
  assert.equal(result.kind, 'success');
  if (result.kind !== 'success') return;

  const success = result as ComTransportActivityCountsSuccess;

  // Record 7 (TAC_003 at 10:05:00Z): telemetry dropped, all counts null, status: 'missing'
  const missingRec = success.activities[7]!;
  assert.equal(missingRec.sensor_id, 'TAC_003');
  assert.equal(missingRec.observed_at, '2026-09-28T10:05:00.000Z');
  assert.equal(missingRec.interval_start, '2026-09-28T10:05:00.000Z');
  assert.equal(missingRec.interval_end, '2026-09-28T10:10:00.000Z');
  assert.equal(missingRec.sampling_interval_minutes, 5);

  // Invariant (T032): Absent intervals are NOT zero-filled
  assert.equal(missingRec.vehicle_count, null, 'Vehicle count must remain null');
  assert.equal(missingRec.bicycle_count, null, 'Bicycle count must remain null');
  assert.equal(missingRec.pedestrian_count, null, 'Pedestrian count must remain null');
  assert.equal(missingRec.total_count, null, 'Total count must remain null');
  assert.equal(missingRec.status, 'missing');

  const missingGeo = success.geoRecords[7]!;
  assert.ok(missingGeo.summary?.includes('Telemetry missing/unobserved. Absent intervals are NOT zero-filled.'));

  // parseCount tests for zero-filling guards
  assert.equal(parseCount(0), 0);
  assert.equal(parseCount('0'), 0);
  assert.equal(parseCount(42), 42);
  assert.equal(parseCount(' 120 '), 120);
  assert.equal(parseCount('1,500'), 1500);

  // Suppressed or missing values must return null, NEVER 0
  assert.equal(parseCount(null), null);
  assert.equal(parseCount(undefined), null);
  assert.equal(parseCount(''), null);
  assert.equal(parseCount('null'), null);
  assert.equal(parseCount('-'), null);
  assert.equal(parseCount('<4'), null);
  assert.equal(parseCount('na'), null);
  assert.equal(parseCount('missing'), null);
  assert.equal(parseCount('NaN'), null);

  // parse5MinInterval tests
  const interval = parse5MinInterval('2026-09-28T10:03:25.000Z');
  assert.equal(interval.observedAt, '2026-09-28T10:03:25.000Z');
  assert.equal(interval.intervalStart, '2026-09-28T10:00:00.000Z');
  assert.equal(interval.intervalEnd, '2026-09-28T10:05:00.000Z');

  // Exact boundary alignment
  const boundaryStart = parse5MinInterval('2026-09-28T10:00:00.000Z');
  assert.equal(boundaryStart.intervalStart, '2026-09-28T10:00:00.000Z');
  assert.equal(boundaryStart.intervalEnd, '2026-09-28T10:05:00.000Z');

  const boundaryEnd = parse5MinInterval('2026-09-28T10:04:59.999Z');
  assert.equal(boundaryEnd.intervalStart, '2026-09-28T10:00:00.000Z');
  assert.equal(boundaryEnd.intervalEnd, '2026-09-28T10:05:00.000Z');
});

test('T032 Invariant 3: universal citywide coverage is disclaimed, only instrumented sensor sites', async () => {
  const fixture = await loadFixture();

  class MockExploreClient extends OpenDataSoftClient {
    override async fetchRecords(): Promise<OdsRecords> {
      return {
        records: fixture.results,
        totalCount: fixture.total_count,
        pageCount: 1,
        fetchedAt: '2026-09-29T10:00:00.000Z',
        lastModified: fixture.source_updated_at,
      };
    }
  }

  const connectorInstance = new ComTransportActivityCountsConnector(new MockExploreClient());
  const input = parseConnectorInput({
    sourceId: SOURCE_ID,
    window: { kind: 'snapshot', revision: 'latest' },
    checkpoint: null,
    runId: 'run-t032-coverage-test',
  });

  const result = await connectorInstance.collect(input);
  assert.equal(result.kind, 'success');
  if (result.kind !== 'success') return;

  const success = result as ComTransportActivityCountsSuccess;

  // All activities must explicitly flag no citywide coverage
  for (const act of success.activities) {
    assert.equal(act.is_citywide_coverage, false, 'Must not claim citywide coverage');
    assert.equal(act.coverage_scope, 'instrumented_corridor_only');
  }

  // Instrumented site with coordinates (Record 0)
  const geo0 = success.geoRecords[0]!;
  assert.equal(geo0.location_role, 'sensor_site');
  assert.equal(geo0.location_confidence, 'source_coordinate');
  assert.equal(geo0.centroid_lon, 144.9652);
  assert.equal(geo0.centroid_lat, -37.8136);
  assert.ok(geo0.geometry_geojson !== null);
  const parsedGeoJson = JSON.parse(geo0.geometry_geojson);
  assert.deepEqual(parsedGeoJson, { type: 'Point', coordinates: [144.9652, -37.8136] });

  // Record 19 (TAC_013): coordinates are null in fixture
  const rec19 = success.activities[19]!;
  assert.equal(rec19.sensor_id, 'TAC_013');
  assert.equal(rec19.latitude, null);
  assert.equal(rec19.longitude, null);

  const geo19 = success.geoRecords[19]!;
  assert.equal(geo19.location_role, 'unknown', 'Missing coordinates must have location_role: unknown');
  assert.equal(geo19.location_confidence, 'unverified', 'Missing coordinates must have location_confidence: unverified');
  assert.equal(geo19.centroid_lat, null);
  assert.equal(geo19.centroid_lon, null);
  assert.equal(geo19.geometry_geojson, null);

  const geoVal19 = validateGeoRecordGeography(geo19);
  assert.equal(geoVal19.valid, true, 'Quarantined unverified location must still be valid geography representation');
});

test('T032 Time Window Query: passes time filter where clause to ODS client', async () => {
  let capturedWhere: string | undefined;

  class FilterCheckingClient extends OpenDataSoftClient {
    override async fetchRecords(query: OdsQuery): Promise<OdsRecords> {
      capturedWhere = query.where;
      return {
        records: [],
        totalCount: 0,
        pageCount: 1,
        fetchedAt: '2026-09-29T10:00:00.000Z',
        lastModified: null,
      };
    }
  }

  const testConnector = new ComTransportActivityCountsConnector(new FilterCheckingClient());

  await testConnector.collect(parseConnectorInput({
    sourceId: SOURCE_ID,
    window: {
      kind: 'time',
      from: '2026-09-28T10:00:00.000Z',
      to: '2026-09-28T11:00:00.000Z',
    },
    checkpoint: null,
    runId: 'time-window-test',
  }));

  assert.equal(
    capturedWhere,
    "time >= '2026-09-28T10:00:00.000Z' and time < '2026-09-28T11:00:00.000Z'",
  );
});

test('T032 Error Handling: correctly translates upstream failures and invalid states', async () => {
  // 1. Invalid sourceId
  const invalidResult = await connector.collect({
    sourceId: 'wrong.source.id',
    window: { kind: 'snapshot', revision: 'latest' },
    checkpoint: null,
    runId: 'bad-source',
  });
  assert.equal(invalidResult.kind, 'failure');
  if (invalidResult.kind === 'failure') {
    assert.equal(invalidResult.code, 'validation_failed');
  }

  // 2. Upstream rate limit (429)
  class RateLimitedClient extends OpenDataSoftClient {
    override async fetchRecords(): Promise<OdsRecords> {
      throw new HttpFailure('rate_limited', 429, 3);
    }
  }
  const rateLimitConnector = new ComTransportActivityCountsConnector(new RateLimitedClient());
  const rlResult = await rateLimitConnector.collect(parseConnectorInput({
    sourceId: SOURCE_ID,
    window: { kind: 'snapshot', revision: 'latest' },
    checkpoint: null,
    runId: 'rate-limit-test',
  }));
  assert.equal(rlResult.kind, 'failure');
  if (rlResult.kind === 'failure') {
    assert.equal(rlResult.code, 'rate_limited');
  }

  // 3. Upstream 503 unavailable
  class UnavailableClient extends OpenDataSoftClient {
    override async fetchRecords(): Promise<OdsRecords> {
      throw new HttpFailure('upstream_unavailable', 503, 3);
    }
  }
  const unavailConnector = new ComTransportActivityCountsConnector(new UnavailableClient());
  const unavailResult = await unavailConnector.collect(parseConnectorInput({
    sourceId: SOURCE_ID,
    window: { kind: 'snapshot', revision: 'latest' },
    checkpoint: null,
    runId: 'unavail-test',
  }));
  assert.equal(unavailResult.kind, 'failure');
  if (unavailResult.kind === 'failure') {
    assert.equal(unavailResult.code, 'upstream_unavailable');
  }

  // 4. Incomplete window (10,000 row limit)
  class IncompleteClient extends OpenDataSoftClient {
    override async fetchRecords(): Promise<OdsRecords> {
      throw new OdsIncompleteWindow('10,000-row window limit exceeded', 15000);
    }
  }
  const incompleteConnector = new ComTransportActivityCountsConnector(new IncompleteClient());
  const incResult = await incompleteConnector.collect(parseConnectorInput({
    sourceId: SOURCE_ID,
    window: { kind: 'snapshot', revision: 'latest' },
    checkpoint: null,
    runId: 'incomplete-test',
  }));
  assert.equal(incResult.kind, 'failure');
  if (incResult.kind === 'failure') {
    assert.equal(incResult.code, 'incomplete_window');
  }

  // 5. Conflicting duplicate records within same batch
  const conflictingRecords = [
    {
      sensor_id: 'TAC_999',
      direction: 'Northbound',
      time: '2026-09-28T10:00:00Z',
      vehicle_count: 10,
    },
    {
      sensor_id: 'TAC_999',
      direction: 'Northbound',
      time: '2026-09-28T10:00:00Z',
      vehicle_count: 999, // Conflicting payload
    },
  ];
  class ConflictingClient extends OpenDataSoftClient {
    override async fetchRecords(): Promise<OdsRecords> {
      return {
        records: conflictingRecords,
        totalCount: 2,
        pageCount: 1,
        fetchedAt: '2026-09-29T10:00:00.000Z',
        lastModified: null,
      };
    }
  }
  const conflictConnector = new ComTransportActivityCountsConnector(new ConflictingClient());
  const conflictResult = await conflictConnector.collect(parseConnectorInput({
    sourceId: SOURCE_ID,
    window: { kind: 'snapshot', revision: 'latest' },
    checkpoint: null,
    runId: 'conflict-test',
  }));
  assert.equal(conflictResult.kind, 'failure');
  if (conflictResult.kind === 'failure') {
    assert.equal(conflictResult.code, 'validation_failed');
    assert.ok(conflictResult.message.includes('Conflicting duplicate record detected'));
  }

  // 6. Schema changed (unparsable row)
  class SchemaChangedClient extends OpenDataSoftClient {
    override async fetchRecords(): Promise<OdsRecords> {
      return {
        records: [{ sensor_id: 123, longitude: 'invalid-string-coord' }],
        totalCount: 1,
        pageCount: 1,
        fetchedAt: '2026-09-29T10:00:00.000Z',
        lastModified: null,
      };
    }
  }
  const schemaChangedConnector = new ComTransportActivityCountsConnector(new SchemaChangedClient());
  const scResult = await schemaChangedConnector.collect(parseConnectorInput({
    sourceId: SOURCE_ID,
    window: { kind: 'snapshot', revision: 'latest' },
    checkpoint: null,
    runId: 'schema-test',
  }));
  assert.equal(scResult.kind, 'failure');
  if (scResult.kind === 'failure') {
    assert.equal(scResult.code, 'schema_changed');
  }
});
