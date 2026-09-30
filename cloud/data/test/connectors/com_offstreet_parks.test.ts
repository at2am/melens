import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  ComOffstreetParksConnector,
  DEFAULT_CENSUS_YEAR,
  SOURCE_ID,
  comOffstreetParksConnector,
  connector,
  isPublicParkingCandidate,
  normalizeOffstreetRecord,
  validateRawRecord,
  type ComOffstreetParkRawRecord,
  type ComOffstreetParksSuccess,
} from '../../src/connectors/com_offstreet_parks/index.js';
import { isConnector, parseConnectorInput } from '../../src/core/connector.js';
import { HttpFailure } from '../../src/core/http.js';
import { OdsIncompleteWindow, OpenDataSoftClient, type OdsQuery, type OdsRecords } from '../../src/core/opendatasoft.js';
import {
  loadConnector,
  loadSourceRegistry,
  parseSourceManifest,
  SourceRegistry,
  type RegisteredSource,
} from '../../src/core/registry.js';
import { parseSourceRecord } from '../../src/validation/record.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(__dirname, '../fixtures/com_offstreet_parks.json');
const manifestPath = join(__dirname, '../../src/connectors/com_offstreet_parks/source.json');

async function loadFixture(): Promise<{ total_count: number; results: ComOffstreetParkRawRecord[] }> {
  const content = await readFile(fixturePath, 'utf8');
  return JSON.parse(content);
}

test('T033: source.json manifest parses cleanly, adapts to shared Connector, and maintains review_required candidate status', async () => {
  const manifestRaw = JSON.parse(await readFile(manifestPath, 'utf8'));
  const dataSource = parseSourceManifest(manifestRaw);

  assert.equal(dataSource.source_id, SOURCE_ID);
  assert.equal(dataSource.provider, 'City of Melbourne');
  assert.equal(dataSource.dataset_title, 'Off-street car parks with capacity and type');
  assert.equal(dataSource.topic, 'parking');
  assert.equal(dataSource.scope, 'city');
  assert.deepEqual(dataSource.coverage_area_refs, ['com_municipal:1:2008-07-01']);
  assert.equal(dataSource.cadence_seconds, 31536000);

  // Invariant: rights status remains review_required until real crawl & license review
  assert.equal(dataSource.license_status, 'review_required');
  assert.equal(dataSource.access_status, 'candidate');

  const registeredSource: RegisteredSource = {
    dataSource,
    directory: join(__dirname, '../../src/connectors/com_offstreet_parks'),
    manifestPath,
    entrypointPath: join(__dirname, '../../src/connectors/com_offstreet_parks/index.ts'),
  };

  const registry = new SourceRegistry([registeredSource]);
  assert.ok(registry.get(SOURCE_ID));
  assert.equal(registry.active().length, 0, 'Candidate review_required source must not be in active()');

  assert.ok(isConnector(connector));
  assert.equal(connector.sourceId, SOURCE_ID);

  // Verify registry loader can discover and load the connector instance
  const connectorsRoot = join(__dirname, '../../src/connectors');
  const fullRegistry = await loadSourceRegistry(connectorsRoot);
  const entry = fullRegistry.get(SOURCE_ID);
  assert.ok(entry, `${SOURCE_ID} must be registered in SourceRegistry`);
  const loadedConnector = await loadConnector(entry);
  assert.ok(isConnector(loadedConnector));
  assert.equal(loadedConnector.sourceId, SOURCE_ID);
});

test('T033 Invariant 1: only Commercial parking is marked as public candidate', () => {
  // Commercial facilities -> public candidates
  assert.equal(isPublicParkingCandidate('Commercial'), true);
  assert.equal(isPublicParkingCandidate('commercial'), true);
  assert.equal(isPublicParkingCandidate(' Commercial '), true);

  // Residential and Private -> strictly non-public
  assert.equal(isPublicParkingCandidate('Residential'), false);
  assert.equal(isPublicParkingCandidate('residential'), false);
  assert.equal(isPublicParkingCandidate('Private'), false);
  assert.equal(isPublicParkingCandidate('private'), false);
  assert.equal(isPublicParkingCandidate('Staff'), false);
  assert.equal(isPublicParkingCandidate('Customer only'), false);
});

test('T033 Invariant 2 & Normalization: preserves annual census capacity and disclaims real-time occupancy', () => {
  const sampleCommercial: ComOffstreetParkRawRecord = {
    census_year: 2024,
    block_id: 6,
    property_id: '578328',
    base_property_id: '573333',
    building_address: 'Carpark Federation Square 2 Swanston Street MELBOURNE VIC 3000',
    clue_small_area: 'Melbourne (CBD)',
    parking_type: 'Commercial',
    parking_spaces: 450,
    longitude: 144.969917465,
    latitude: -37.81784465,
  };

  const bundle = normalizeOffstreetRecord(
    sampleCommercial,
    'test-batch-001',
    '2026-09-29T10:00:00Z',
    '2025-06-01T00:00:00Z',
  );

  // Commercial facility properties
  assert.equal(bundle.facility.is_public_candidate, true);
  assert.equal(bundle.facility.annual_capacity, 450);
  assert.equal(bundle.facility.is_realtime_occupancy, false);
  assert.equal(bundle.parkingBay.public_access, true);
  assert.equal(bundle.geoRecord.location_role, 'event_site');

  // SourceRecord validation
  const parsedSourceRecord = parseSourceRecord(bundle.sourceRecord);
  assert.equal(parsedSourceRecord.rights_status, 'review_required');
  assert.equal(parsedSourceRecord.record_status, 'active');
  assert.equal(parsedSourceRecord.observed_at, null);
  assert.ok(parsedSourceRecord.time_missing_reason?.includes('Annual CLUE census survey'));
  assert.equal(parsedSourceRecord.valid_from, '2024-01-01T00:00:00Z');
  assert.equal(parsedSourceRecord.valid_to, '2025-01-01T00:00:00Z');

  // GeoRecord validation
  assert.equal(bundle.geoRecord.rights_status, 'review_required');
  assert.equal(bundle.geoRecord.public_query_allowed, false);
  assert.equal(bundle.geoRecord.centroid_lat, -37.81784465);
  assert.equal(bundle.geoRecord.centroid_lon, 144.969917465);
  assert.ok(bundle.geoRecord.summary?.includes('450 capacity spaces'));
  assert.ok(bundle.geoRecord.summary?.includes('annual census count, not real-time availability'));

  // Test Private facility
  const samplePrivate: ComOffstreetParkRawRecord = {
    census_year: '2024',
    property_id: 611393,
    parking_type: 'Private',
    parking_spaces: 29,
  };

  const privateBundle = normalizeOffstreetRecord(
    samplePrivate,
    'test-batch-002',
    '2026-09-29T10:00:00Z',
  );

  assert.equal(privateBundle.facility.is_public_candidate, false);
  assert.equal(privateBundle.parkingBay.public_access, false);
  assert.equal(privateBundle.facility.annual_capacity, 29);
  assert.equal(privateBundle.facility.is_realtime_occupancy, false);
  assert.equal(privateBundle.geoRecord.location_role, 'sensor_site');
});

test('T033 Full Collection: collects all fixture records and adheres to domain invariants', async () => {
  const fixture = await loadFixture();

  class MockExploreClient extends OpenDataSoftClient {
    override async fetchRecords(query: OdsQuery): Promise<OdsRecords> {
      assert.equal(query.datasetId, 'off-street-car-parks-with-capacity-and-type');
      return {
        records: fixture.results,
        totalCount: fixture.total_count,
        pageCount: 1,
        fetchedAt: '2026-09-29T10:00:00Z',
        lastModified: '2025-07-01T00:00:00Z',
      };
    }
  }

  const connectorInstance = new ComOffstreetParksConnector(new MockExploreClient());
  const input = parseConnectorInput({
    sourceId: SOURCE_ID,
    window: { kind: 'snapshot', revision: 'latest' },
    checkpoint: null,
    runId: 'run-t033-full-test',
  });

  const result = await connectorInstance.collect(input);
  assert.equal(result.kind, 'success');
  if (result.kind !== 'success') return;

  const success = result as ComOffstreetParksSuccess;
  assert.equal(success.inputCount, 20);
  assert.equal(success.outputCount, 20);
  assert.equal(success.rejectedCount, 0);
  assert.equal(success.sourceRecords.length, 20);
  assert.equal(success.geoRecords.length, 20);
  assert.equal(success.parkingBays.length, 20);

  // Requirement 2: Remove any extra fields (such as facilities) from ConnectorSuccess returned by collect()
  assert.equal('facilities' in success, false, 'ConnectorSuccess must NOT contain extra facilities field');
  assert.equal((success as unknown as Record<string, unknown>).facilities, undefined);

  // Strict keys compliance with ConnectorSuccess definition in core/connector.ts
  const allowedKeys = new Set([
    'kind', 'sourceId', 'runId', 'fetchedAt', 'sourceRevision',
    'sourceLatestUpdateAt', 'checkpointAfter', 'completeness',
    'inputCount', 'outputCount', 'rejectedCount', 'sourceRecords',
    'geoRecords', 'geoRecordSources', 'boundaries', 'areaIndicators',
    'parkingBays', 'parkingObservations', 'parkingRules',
    'sensorLocations', 'pedestrianObservations', 'retainableRawRecords',
  ]);
  for (const key of Object.keys(success)) {
    assert.ok(allowedKeys.has(key), `Unexpected extra field in ConnectorSuccess: ${key}`);
  }

  // Requirement 3: Annual capacity is NOT live vacant-space count (parkingObservations MUST be empty [])
  assert.equal(success.parkingObservations.length, 0, 'parkingObservations must be empty array');

  // Invariant 1 verification: breakdown of public candidates in parkingBays
  // Commercial facilities -> public_access: true (8 items)
  // Residential and Private -> public_access: false (12 items)
  const commercialBays = success.parkingBays.filter(b => b.public_access === true);
  const nonCommercialBays = success.parkingBays.filter(b => b.public_access === false);

  assert.equal(commercialBays.length, 8, '8 commercial facilities must have public_access=true');
  assert.equal(nonCommercialBays.length, 12, '12 residential/private facilities must have public_access=false');

  const eventSiteGeos = success.geoRecords.filter(g => g.location_role === 'event_site');
  const sensorSiteGeos = success.geoRecords.filter(g => g.location_role === 'sensor_site');
  assert.equal(eventSiteGeos.length, 8, '8 commercial facilities must have event_site location role');
  assert.equal(sensorSiteGeos.length, 12, '12 residential/private facilities must have sensor_site location role');

  for (const bay of commercialBays) {
    assert.equal(bay.public_access, true);
    assert.ok(bay.bay_id.startsWith('offstreet:'));
    assert.ok(bay.marker_id?.startsWith('property:'));
  }
  for (const bay of nonCommercialBays) {
    assert.equal(bay.public_access, false);
    assert.ok(bay.bay_id.startsWith('offstreet:'));
    assert.ok(bay.marker_id?.startsWith('property:'));
  }

  // Domain normalization invariants verification on raw fixture records
  for (const raw of fixture.results) {
    const bundle = normalizeOffstreetRecord(raw, 'test-batch-001', '2026-09-29T10:00:00Z');
    if (bundle.facility.is_public_candidate) {
      assert.equal(bundle.facility.parking_type, 'Commercial');
      assert.equal(bundle.facility.is_realtime_occupancy, false);
      assert.ok(bundle.facility.annual_capacity > 0);
      assert.equal(bundle.parkingBay.public_access, true);
      assert.equal(bundle.geoRecord.location_role, 'event_site');
    } else {
      assert.ok(bundle.facility.parking_type === 'Residential' || bundle.facility.parking_type === 'Private');
      assert.equal(bundle.facility.is_public_candidate, false);
      assert.equal(bundle.facility.is_realtime_occupancy, false);
      assert.equal(bundle.parkingBay.public_access, false);
      assert.equal(bundle.geoRecord.location_role, 'sensor_site');
    }
  }

  // All records must have rights_status review_required and public_query_allowed false
  for (const s of success.sourceRecords) {
    assert.equal(s.rights_status, 'review_required');
    assert.equal(s.assertion_kind, 'observation');
  }
  for (const g of success.geoRecords) {
    assert.equal(g.rights_status, 'review_required');
    assert.equal(g.public_query_allowed, false);
    assert.equal(g.freshness_state, 'unknown');
  }
});

test('T033 Year filtering: applies snapshot revision or time window to ODS query with date expressions', async () => {
  let capturedWhere: string | undefined;

  class FilterCheckingClient extends OpenDataSoftClient {
    override async fetchRecords(query: OdsQuery): Promise<OdsRecords> {
      capturedWhere = query.where;
      return {
        records: [],
        totalCount: 0,
        pageCount: 1,
        fetchedAt: '2026-09-29T10:00:00Z',
        lastModified: null,
      };
    }
  }

  const testConnector = new ComOffstreetParksConnector(new FilterCheckingClient());

  // (a) Snapshot with 4-digit year uses ODS date expression
  await testConnector.collect(parseConnectorInput({
    sourceId: SOURCE_ID,
    window: { kind: 'snapshot', revision: '2024' },
    checkpoint: null,
    runId: 'snap-2024',
  }));
  assert.equal(capturedWhere, "census_year = date'2024'");

  // (b) Snapshot with 'latest' bounds to the latest census year slice (default 2024) to avoid 151k unbounded window
  await testConnector.collect(parseConnectorInput({
    sourceId: SOURCE_ID,
    window: { kind: 'snapshot', revision: 'latest' },
    checkpoint: null,
    runId: 'snap-latest',
  }));
  assert.equal(capturedWhere, `census_year = date'${DEFAULT_CENSUS_YEAR}'`);

  // (c) Snapshot with ISO date format YYYY-MM-DD
  await testConnector.collect(parseConnectorInput({
    sourceId: SOURCE_ID,
    window: { kind: 'snapshot', revision: '2024-01-01' },
    checkpoint: null,
    runId: 'snap-iso-date',
  }));
  assert.equal(capturedWhere, "census_year = date'2024-01-01'");

  // (d) Snapshot with non-date revision (e.g. 'fixture') leaves where undefined
  await testConnector.collect(parseConnectorInput({
    sourceId: SOURCE_ID,
    window: { kind: 'snapshot', revision: 'fixture' },
    checkpoint: null,
    runId: 'snap-fixture',
  }));
  assert.equal(capturedWhere, undefined);

  // (e) Time window spanning 2023 to 2024: half-open interval [from, to) with date expressions
  await testConnector.collect(parseConnectorInput({
    sourceId: SOURCE_ID,
    window: { kind: 'time', from: '2023-01-01T00:00:00Z', to: '2024-01-01T00:00:00Z' },
    checkpoint: null,
    runId: 'time-2023-2024',
  }));
  assert.equal(capturedWhere, "census_year >= date'2023-01-01' and census_year < date'2024-01-01'");

  // (f) Custom defaultYear in connector options resolves 'latest' to that year
  const customYearConnector = new ComOffstreetParksConnector({
    client: new FilterCheckingClient(),
    defaultYear: '2023',
  });
  await customYearConnector.collect(parseConnectorInput({
    sourceId: SOURCE_ID,
    window: { kind: 'snapshot', revision: 'latest' },
    checkpoint: null,
    runId: 'snap-custom-latest',
  }));
  assert.equal(capturedWhere, "census_year = date'2023'");
});

test('T033 Exceeding single-page limits: safe multi-page pagination and incomplete_window handling', async () => {
  // Case A: Safe handling of multi-page pagination within 10,000-row limit (e.g. 250 records across 3 pages)
  const mockMultiPageRecords: ComOffstreetParkRawRecord[] = Array.from({ length: 250 }, (_, i) => ({
    census_year: 2024,
    property_id: `multi_${1000 + i}`,
    parking_type: i % 2 === 0 ? 'Commercial' : 'Residential',
    parking_spaces: 10 + (i % 50),
    building_address: `${100 + i} Test St MELBOURNE VIC 3000`,
    clue_small_area: 'Melbourne (CBD)',
    longitude: 144.96 + (i * 0.0001),
    latitude: -37.81 - (i * 0.0001),
  }));

  class MultiPageClient extends OpenDataSoftClient {
    override async fetchRecords(query: OdsQuery): Promise<OdsRecords> {
      assert.equal(query.datasetId, 'off-street-car-parks-with-capacity-and-type');
      assert.equal(query.orderBy, 'property_id ASC');
      return {
        records: mockMultiPageRecords,
        totalCount: 250,
        pageCount: 3,
        fetchedAt: '2026-09-29T10:00:00Z',
        lastModified: '2025-07-01T00:00:00Z',
      };
    }
  }

  const multiPageConnector = new ComOffstreetParksConnector(new MultiPageClient());
  const multiResult = await multiPageConnector.collect(parseConnectorInput({
    sourceId: SOURCE_ID,
    window: { kind: 'snapshot', revision: 'latest' },
    checkpoint: null,
    runId: 'multi-page-run',
  }));

  assert.equal(multiResult.kind, 'success');
  if (multiResult.kind === 'success') {
    assert.equal(multiResult.inputCount, 250);
    assert.equal(multiResult.outputCount, 250);
    assert.equal(multiResult.rejectedCount, 0);
    assert.equal(multiResult.sourceRecords.length, 250);
    assert.equal(multiResult.geoRecords.length, 250);
    assert.equal(multiResult.parkingBays.length, 250);
    assert.equal(multiResult.parkingObservations.length, 0, 'Multi-page batch must have empty parkingObservations');

    // Completeness reflects multi-page pagination
    assert.equal(multiResult.completeness.complete, true);
    assert.equal(multiResult.completeness.method, 'pagination');
    assert.equal(multiResult.completeness.expected_records, 250);
    assert.equal(multiResult.completeness.fetched_records, 250);
    assert.equal(multiResult.completeness.expected_pages, 3);
    assert.equal(multiResult.completeness.fetched_pages, 3);
    assert.ok(multiResult.completeness.evidence.includes('All 250 records retrieved across 3 page(s)'));
  }

  // Case B: Safe handling when query exceeds ODS 10,000-row limit (e.g. unbounded full history 151,199 rows)
  class ExceedingWindowLimitClient extends OpenDataSoftClient {
    override async fetchRecords(): Promise<OdsRecords> {
      throw new OdsIncompleteWindow('records endpoint 10,000-row window limit; use export', 151199);
    }
  }

  const exceedingConnector = new ComOffstreetParksConnector(new ExceedingWindowLimitClient());
  const exceedResult = await exceedingConnector.collect(parseConnectorInput({
    sourceId: SOURCE_ID,
    window: { kind: 'snapshot', revision: 'latest' },
    checkpoint: null,
    runId: 'exceed-window-run',
  }));

  assert.equal(exceedResult.kind, 'failure');
  if (exceedResult.kind === 'failure') {
    assert.equal(exceedResult.code, 'incomplete_window');
    assert.equal(exceedResult.completeness.complete, false);
    assert.ok(exceedResult.completeness.evidence.includes('10,000-row window limit; use export'));
    assert.ok(exceedResult.message.includes('10,000-row window limit'));
  }
});

test('T033 Invariant verification: annual capacity is strictly survey capacity and NEVER real-time parking observations', async () => {
  const testRecords: ComOffstreetParkRawRecord[] = [
    {
      census_year: '2024',
      property_id: 'prop_comm_1',
      parking_type: 'Commercial',
      parking_spaces: 500,
      building_address: '100 Exhibition St MELBOURNE VIC 3000',
      clue_small_area: 'Melbourne (CBD)',
      latitude: -37.8136,
      longitude: 144.9712,
    },
    {
      census_year: '2024',
      property_id: 'prop_res_1',
      parking_type: 'Residential',
      parking_spaces: 120,
      building_address: '200 Spring St MELBOURNE VIC 3000',
      clue_small_area: 'Melbourne (CBD)',
      latitude: -37.8115,
      longitude: 144.9735,
    },
    {
      census_year: '2024',
      property_id: 'prop_priv_1',
      parking_type: 'Private',
      parking_spaces: 45,
      building_address: '300 Collins St MELBOURNE VIC 3000',
      clue_small_area: 'Melbourne (CBD)',
      latitude: -37.8160,
      longitude: 144.9640,
    },
  ];

  class InvariantMockClient extends OpenDataSoftClient {
    override async fetchRecords(): Promise<OdsRecords> {
      return {
        records: testRecords,
        totalCount: testRecords.length,
        pageCount: 1,
        fetchedAt: '2026-09-29T10:00:00Z',
        lastModified: '2025-07-01T00:00:00Z',
      };
    }
  }

  const invariantConnector = new ComOffstreetParksConnector(new InvariantMockClient());
  const res = await invariantConnector.collect(parseConnectorInput({
    sourceId: SOURCE_ID,
    window: { kind: 'snapshot', revision: '2024' },
    checkpoint: null,
    runId: 'invariant-check-run',
  }));

  assert.equal(res.kind, 'success');
  if (res.kind !== 'success') return;

  // Invariant 2 requirement: parkingObservations MUST be strictly empty []
  assert.equal(res.parkingObservations.length, 0, 'Annual capacity must NEVER be written as parkingObservations');
  assert.deepEqual(res.parkingObservations, []);

  // Commercial record checks: is_public_candidate=true, public_access=true, location_role=event_site
  const commBundle = normalizeOffstreetRecord(testRecords[0]!, 'run-comm', '2026-09-29T10:00:00Z');
  assert.equal(commBundle.facility.parking_type, 'Commercial');
  assert.equal(commBundle.facility.is_public_candidate, true);
  assert.equal(commBundle.facility.annual_capacity, 500);
  assert.equal(commBundle.facility.is_realtime_occupancy, false);
  assert.equal(commBundle.parkingBay.public_access, true);
  assert.equal(commBundle.geoRecord.location_role, 'event_site');
  assert.ok(commBundle.geoRecord.summary?.includes('Note: Capacity is an annual census count, not real-time availability.'));

  // Residential record checks: is_public_candidate=false, public_access=false, location_role=sensor_site
  const resBundle = normalizeOffstreetRecord(testRecords[1]!, 'run-res', '2026-09-29T10:00:00Z');
  assert.equal(resBundle.facility.parking_type, 'Residential');
  assert.equal(resBundle.facility.is_public_candidate, false);
  assert.equal(resBundle.facility.annual_capacity, 120);
  assert.equal(resBundle.facility.is_realtime_occupancy, false);
  assert.equal(resBundle.parkingBay.public_access, false);
  assert.equal(resBundle.geoRecord.location_role, 'sensor_site');

  // Private record checks: is_public_candidate=false, public_access=false, location_role=sensor_site
  const privBundle = normalizeOffstreetRecord(testRecords[2]!, 'run-priv', '2026-09-29T10:00:00Z');
  assert.equal(privBundle.facility.parking_type, 'Private');
  assert.equal(privBundle.facility.is_public_candidate, false);
  assert.equal(privBundle.facility.annual_capacity, 45);
  assert.equal(privBundle.facility.is_realtime_occupancy, false);
  assert.equal(privBundle.parkingBay.public_access, false);
  assert.equal(privBundle.geoRecord.location_role, 'sensor_site');

  // Verify all source records have no observation timestamp (only survey validity)
  for (const sr of res.sourceRecords) {
    assert.equal(sr.observed_at, null, 'Annual CLUE survey cannot have per-row observed_at timestamp');
    assert.ok(sr.time_missing_reason?.includes('Annual CLUE census survey'));
    assert.equal(sr.valid_from, '2024-01-01T00:00:00Z');
    assert.equal(sr.valid_to, '2025-01-01T00:00:00Z');
  }
});


test('T033 Error handling: maps upstream HTTP and validation errors to contract codes', async () => {
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
  const rateLimitConnector = new ComOffstreetParksConnector(new RateLimitedClient());
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

  // 3. Upstream 500 error
  class UnavailableClient extends OpenDataSoftClient {
    override async fetchRecords(): Promise<OdsRecords> {
      throw new HttpFailure('upstream_unavailable', 503, 3);
    }
  }
  const unavailConnector = new ComOffstreetParksConnector(new UnavailableClient());
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

  // 4. Schema changed error (invalid latitude)
  const invalidRecords = [
    { census_year: 2024, property_id: '100', parking_type: 'Commercial', parking_spaces: 50, latitude: 999 },
  ];
  class SchemaChangedClient extends OpenDataSoftClient {
    override async fetchRecords(): Promise<OdsRecords> {
      return {
        records: invalidRecords,
        totalCount: 1,
        pageCount: 1,
        fetchedAt: '2026-09-29T10:00:00Z',
        lastModified: null,
      };
    }
  }
  const schemaConnector = new ComOffstreetParksConnector(new SchemaChangedClient());
  const schemaResult = await schemaConnector.collect(parseConnectorInput({
    sourceId: SOURCE_ID,
    window: { kind: 'snapshot', revision: 'latest' },
    checkpoint: null,
    runId: 'schema-test',
  }));
  assert.equal(schemaResult.kind, 'failure');
  if (schemaResult.kind === 'failure') {
    assert.equal(schemaResult.code, 'schema_changed');
  }
});

test('T033 Legacy runner helper: runs offline against fixturePath', async () => {
  const result = await comOffstreetParksConnector({
    sourceId: SOURCE_ID,
    runId: 'legacy-fixture-run',
    options: {
      fixturePath,
    },
  });

  assert.equal(result.kind, 'success');
  if (result.kind !== 'success') return;

  assert.equal(result.inputCount, 20);
  assert.equal(result.outputCount, 20);
  assert.equal(result.parkingObservations.length, 0);
});

test('T033 Regression G23: property 100008 multi-row aggregation, reordering invariance, and deduplication', async () => {
  const property100008_row13: ComOffstreetParkRawRecord = {
    census_year: '2024',
    block_id: 342,
    property_id: '100008',
    base_property_id: '100008',
    building_address: '121-133 Abbotsford Street NORTH MELBOURNE VIC 3051',
    clue_small_area: 'North Melbourne',
    parking_type: 'Private',
    parking_spaces: 13,
    longitude: 144.944922078,
    latitude: -37.80438553,
    location: {
      lon: 144.944922078,
      lat: -37.80438553,
    },
  };

  const property100008_row6: ComOffstreetParkRawRecord = {
    census_year: '2024',
    block_id: 342,
    property_id: '100008',
    base_property_id: '100008',
    building_address: '121-133 Abbotsford Street NORTH MELBOURNE VIC 3051',
    clue_small_area: 'North Melbourne',
    parking_type: 'Private',
    parking_spaces: 6,
    longitude: 144.944922078,
    latitude: -37.80438553,
    location: {
      lon: 144.944922078,
      lat: -37.80438553,
    },
  };

  // 1. Direct normalization: verify reordering produces identical output
  const bundleA = normalizeOffstreetRecord(
    [property100008_row13, property100008_row6],
    'run-order-a',
    '2026-09-29T10:00:00Z',
    '2025-07-01T00:00:00Z',
  );
  const bundleB = normalizeOffstreetRecord(
    [property100008_row6, property100008_row13],
    'run-order-a',
    '2026-09-29T10:00:00Z',
    '2025-07-01T00:00:00Z',
  );

  // Both orders produce 100% identical bundles
  assert.deepEqual(bundleA, bundleB);

  // Annual capacity is summed (13 + 6 = 19 spaces)
  assert.equal(bundleA.facility.annual_capacity, 19);
  assert.equal(bundleA.facility.is_realtime_occupancy, false);
  assert.equal(bundleA.facility.is_public_candidate, false); // Private facility
  assert.equal(bundleA.parkingBay.public_access, false);
  assert.ok(bundleA.geoRecord.summary?.includes('19 capacity spaces'));
  assert.ok(bundleA.geoRecord.summary?.includes('annual census count, not real-time availability'));

  // 2. Deduplication of identical rows: repeated fetches or duplicate rows do NOT double count
  const bundleWithDuplicates = normalizeOffstreetRecord(
    [property100008_row13, property100008_row6, property100008_row13],
    'run-order-a',
    '2026-09-29T10:00:00Z',
    '2025-07-01T00:00:00Z',
  );
  assert.deepEqual(bundleWithDuplicates, bundleA);
  assert.equal(bundleWithDuplicates.facility.annual_capacity, 19);

  // 3. Upstream correction / re-fetch: changing capacity produces updated capacity and new version_id with stable entity ID
  const property100008_row7: ComOffstreetParkRawRecord = { ...property100008_row6, parking_spaces: 7 };
  const bundleUpdated = normalizeOffstreetRecord(
    [property100008_row13, property100008_row7],
    'run-order-a',
    '2026-09-29T10:00:00Z',
    '2025-07-01T00:00:00Z',
  );
  assert.equal(bundleUpdated.facility.annual_capacity, 20); // 13 + 7 = 20
  assert.equal(bundleUpdated.facility.facility_id, bundleA.facility.facility_id); // Stable ID!
  assert.notEqual(bundleUpdated.sourceRecord.version_id, bundleA.sourceRecord.version_id); // Version updated!

  // 4. Ingestion via Connector: Reordering input rows produces identical ConnectorSuccess
  class ClientOrderA extends OpenDataSoftClient {
    override async fetchRecords(): Promise<OdsRecords> {
      return {
        records: [property100008_row13, property100008_row6],
        totalCount: 2,
        pageCount: 1,
        fetchedAt: '2026-09-29T10:00:00Z',
        lastModified: '2025-07-01T00:00:00Z',
      };
    }
  }

  class ClientOrderB extends OpenDataSoftClient {
    override async fetchRecords(): Promise<OdsRecords> {
      return {
        records: [property100008_row6, property100008_row13],
        totalCount: 2,
        pageCount: 1,
        fetchedAt: '2026-09-29T10:00:00Z',
        lastModified: '2025-07-01T00:00:00Z',
      };
    }
  }

  const connectorA = new ComOffstreetParksConnector(new ClientOrderA());
  const connectorB = new ComOffstreetParksConnector(new ClientOrderB());

  const resA = await connectorA.collect(parseConnectorInput({
    sourceId: SOURCE_ID,
    window: { kind: 'snapshot', revision: 'latest' },
    checkpoint: null,
    runId: 'reorder-run',
  }));

  const resB = await connectorB.collect(parseConnectorInput({
    sourceId: SOURCE_ID,
    window: { kind: 'snapshot', revision: 'latest' },
    checkpoint: null,
    runId: 'reorder-run',
  }));

  assert.equal(resA.kind, 'success');
  assert.equal(resB.kind, 'success');
  assert.deepEqual(resA, resB);

  if (resA.kind === 'success') {
    assert.equal(resA.outputCount, 1);
    assert.equal(resA.sourceRecords.length, 1);
    assert.equal(resA.parkingObservations.length, 0); // Annual capacity NEVER emitted as observations
  }
});

test('T033 Regression G23: full 2024 annual ingestion passes identity and integrity validation without conflict errors', async () => {
  const full2024Records: ComOffstreetParkRawRecord[] = [
    {
      census_year: '2024',
      block_id: 341,
      property_id: '100001',
      base_property_id: '100001',
      building_address: '1-13 Abbotsford Street WEST MELBOURNE VIC 3003',
      clue_small_area: 'West Melbourne (Residential)',
      parking_type: 'Residential',
      parking_spaces: 9,
      longitude: 144.945,
      latitude: -37.805,
    },
    {
      census_year: '2024',
      block_id: 341,
      property_id: '100002',
      base_property_id: '100002',
      building_address: '268-296 Adderley Street WEST MELBOURNE VIC 3003',
      clue_small_area: 'West Melbourne (Residential)',
      parking_type: 'Private',
      parking_spaces: 22,
      longitude: 144.946,
      latitude: -37.806,
    },
    {
      census_year: '2024',
      block_id: 341,
      property_id: '100002',
      base_property_id: '100002',
      building_address: '268-296 Adderley Street WEST MELBOURNE VIC 3003',
      clue_small_area: 'West Melbourne (Residential)',
      parking_type: 'Residential',
      parking_spaces: 212,
      longitude: 144.946,
      latitude: -37.806,
    },
    {
      census_year: '2024',
      block_id: 342,
      property_id: '100008',
      base_property_id: '100008',
      building_address: '121-133 Abbotsford Street NORTH MELBOURNE VIC 3051',
      clue_small_area: 'North Melbourne',
      parking_type: 'Private',
      parking_spaces: 13,
      longitude: 144.944922078,
      latitude: -37.80438553,
    },
    {
      census_year: '2024',
      block_id: 342,
      property_id: '100008',
      base_property_id: '100008',
      building_address: '121-133 Abbotsford Street NORTH MELBOURNE VIC 3051',
      clue_small_area: 'North Melbourne',
      parking_type: 'Private',
      parking_spaces: 6,
      longitude: 144.944922078,
      latitude: -37.80438553,
    },
    {
      census_year: '2024',
      block_id: 442,
      property_id: '100194',
      base_property_id: '100194',
      building_address: '111-133 Adderley Street WEST MELBOURNE VIC 3003',
      clue_small_area: 'West Melbourne (Residential)',
      parking_type: 'Private',
      parking_spaces: 6,
      longitude: 144.947123124,
      latitude: -37.81081148,
    },
    {
      census_year: '2024',
      block_id: 442,
      property_id: '100194',
      base_property_id: '100194',
      building_address: '111-133 Adderley Street WEST MELBOURNE VIC 3003',
      clue_small_area: 'West Melbourne (Residential)',
      parking_type: 'Private',
      parking_spaces: 3,
      longitude: 144.947123124,
      latitude: -37.81081148,
    },
    {
      census_year: '2024',
      block_id: 442,
      property_id: '100194',
      base_property_id: '100194',
      building_address: '111-133 Adderley Street WEST MELBOURNE VIC 3003',
      clue_small_area: 'West Melbourne (Residential)',
      parking_type: 'Private',
      parking_spaces: 4,
      longitude: 144.947123124,
      latitude: -37.81081148,
    },
    {
      census_year: '2024',
      block_id: 442,
      property_id: '100194',
      base_property_id: '100194',
      building_address: '111-133 Adderley Street WEST MELBOURNE VIC 3003',
      clue_small_area: 'West Melbourne (Residential)',
      parking_type: 'Private',
      parking_spaces: 7,
      longitude: 144.947123124,
      latitude: -37.81081148,
    },
    {
      census_year: '2024',
      block_id: 6,
      property_id: '578328',
      base_property_id: '573333',
      building_address: 'Carpark Federation Square 2 Swanston Street MELBOURNE VIC 3000',
      clue_small_area: 'Melbourne (CBD)',
      parking_type: 'Commercial',
      parking_spaces: 450,
      longitude: 144.969917465,
      latitude: -37.81784465,
    },
  ];

  class FullAnnualMockClient extends OpenDataSoftClient {
    override async fetchRecords(query: OdsQuery): Promise<OdsRecords> {
      assert.equal(query.datasetId, 'off-street-car-parks-with-capacity-and-type');
      assert.ok(query.where?.includes("census_year = date'2024'"));
      return {
        records: full2024Records,
        totalCount: full2024Records.length,
        pageCount: 2,
        fetchedAt: '2026-09-29T10:00:00Z',
        lastModified: '2025-07-01T00:00:00Z',
      };
    }
  }

  const annualConnector = new ComOffstreetParksConnector(new FullAnnualMockClient());
  const input = parseConnectorInput({
    sourceId: SOURCE_ID,
    window: { kind: 'snapshot', revision: 'latest' },
    checkpoint: null,
    runId: 'run-annual-2024',
  });

  const result = await annualConnector.collect(input);
  assert.equal(result.kind, 'success');
  if (result.kind !== 'success') return;

  assert.equal(result.inputCount, 10);
  assert.equal(result.outputCount, 6);
  assert.equal(result.rejectedCount, 0);
  assert.equal(result.sourceRecords.length, 6);
  assert.equal(result.geoRecords.length, 6);
  assert.equal(result.parkingBays.length, 6);
  assert.equal(result.parkingObservations.length, 0); // Invariant 2

  // Verify unique source_record_ids without any identity conflict
  const seenIds = new Set<string>();
  for (const sr of result.sourceRecords) {
    assert.ok(!seenIds.has(sr.source_record_id), `Duplicate record ID: ${sr.source_record_id}`);
    seenIds.add(sr.source_record_id);
    assert.equal(sr.rights_status, 'review_required');
  }

  // Verify property 100008 aggregated capacity (13 + 6 = 19 spaces)
  const geo100008 = result.geoRecords.find(g => g.geo_record_id.includes('100008'));
  assert.ok(geo100008, 'Property 100008 geoRecord must exist');
  assert.ok(geo100008.summary?.includes('19 capacity spaces'), 'Property 100008 must aggregate 13+6 = 19 spaces');

  // Verify property 100194 aggregated capacity (6 + 3 + 4 + 7 = 20 spaces)
  const geo100194 = result.geoRecords.find(g => g.geo_record_id.includes('100194'));
  assert.ok(geo100194, 'Property 100194 geoRecord must exist');
  assert.ok(geo100194.summary?.includes('20 capacity spaces'), 'Property 100194 must aggregate 6+3+4+7 = 20 spaces');

  // Verify property 578328 (Commercial) has public_access = true
  const commBay = result.parkingBays.find(b => b.bay_id.includes('578328'));
  assert.ok(commBay, 'Commercial parkingBay must exist');
  assert.equal(commBay.public_access, true);
});
