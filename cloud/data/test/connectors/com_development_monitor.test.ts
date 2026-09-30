import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  connector,
  DevelopmentMonitorConnector,
  SOURCE_ID,
  normalizeDevelopmentRecord,
  normalizeDevelopmentStatus,
  parseNullableCount,
  rawDevelopmentMonitorRowSchema,
  type ComDevelopmentMonitorRawRecord,
} from '../../src/connectors/com_development_monitor/index.js';
import { isConnector, parseConnectorInput } from '../../src/core/connector.js';
import { OdsIncompleteWindow, OpenDataSoftClient, type OdsQuery, type OdsRecords } from '../../src/core/opendatasoft.js';
import { loadConnector, loadSourceRegistry } from '../../src/core/registry.js';
import type { SourceRecord } from '../../src/core/types.js';
import { validateGeoRecordGeography } from '../../src/validation/geography.js';
import { parseSourceRecord } from '../../src/validation/record.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(__dirname, '../fixtures/com_development_monitor.json');

async function loadFixture(): Promise<{ total_count: number; results: ComDevelopmentMonitorRawRecord[] }> {
  const content = await readFile(fixturePath, 'utf8');
  return JSON.parse(content);
}

test('SourceRegistry admits the verified development monitor snapshot', async () => {
  const connectorsRoot = join(__dirname, '../../src/connectors');
  const registry = await loadSourceRegistry(connectorsRoot);

  const entry = registry.get(SOURCE_ID);
  assert.ok(entry, 'melbourne.development_monitor must be registered in SourceRegistry');
  assert.equal(entry.dataSource.source_id, SOURCE_ID);
  assert.equal(entry.dataSource.topic, 'planning');
  assert.equal(entry.dataSource.scope, 'city');
  assert.equal(entry.dataSource.license_status, 'verified_open');
  assert.equal(entry.dataSource.access_status, 'active');
  assert.equal(entry.dataSource.cadence_seconds, 2592000, 'Must record monthly cadence');
  assert.equal(entry.dataSource.record_granularity, 'development_project');

  const connectorInstance = await loadConnector(entry);
  assert.equal(connectorInstance.sourceId, SOURCE_ID);
});

test('com_development_monitor parses fixture, collects 21 records, and preserves 4 distinct statuses without collapsing into approved', async () => {
  const fixture = await loadFixture();
  const fetchedAt = '2026-09-29T12:00:00Z';
  const lastModified = '2026-08-15T00:00:00Z';

  class MockClient extends OpenDataSoftClient {
    override async fetchDatasetDataProcessed(): Promise<string> {
      return new Date(lastModified).toISOString();
    }
    override async fetchRecords(query: OdsQuery): Promise<OdsRecords> {
      assert.equal(query.datasetId, 'development-activity-monitor');
      assert.equal(query.orderBy, 'development_key ASC');
      return {
        records: fixture.results,
        totalCount: fixture.total_count,
        pageCount: 1,
        fetchedAt,
        lastModified,
      };
    }
  }

  const connector = new DevelopmentMonitorConnector(new MockClient());
  const input = parseConnectorInput({
    sourceId: SOURCE_ID,
    window: { kind: 'snapshot', revision: '2026-08' },
    checkpoint: null,
    runId: 'test_dev_monitor_run',
  });

  const result = await connector.collect(input);
  assert.equal(result.kind, 'success');
  if (result.kind !== 'success') return;

  assert.equal(result.inputCount, 21);
  assert.equal(result.outputCount, 21);
  assert.equal(result.rejectedCount, 0);
  assert.equal(result.sourceRecords.length, 21);
  assert.equal(result.geoRecords.length, 21);
  assert.equal(result.geoRecordSources.length, 21);
  assert.equal(result.sourceRevision, '2026-08-15T00:00:00.000Z');
  assert.equal(result.sourceLatestUpdateAt, '2026-08-15T00:00:00.000Z');
  assert.equal(result.checkpointAfter, '2026-08');

  // Verify completeness contract
  assert.equal(result.completeness.complete, true);
  assert.equal(result.completeness.method, 'pagination');
  assert.equal(result.completeness.expected_records, 21);
  assert.equal(result.completeness.fetched_records, 21);

  // Group by distinct development status
  const mootedGeos = result.geoRecords.filter(g => g.record_status === 'planned' && g.summary?.includes('Status: mooted'));
  const approvedGeos = result.geoRecords.filter(g => g.record_status === 'planned' && g.summary?.includes('Status: approved'));
  const underConstructionGeos = result.geoRecords.filter(g => g.record_status === 'active' && g.summary?.includes('Status: under_construction'));
  const completedGeos = result.geoRecords.filter(g => g.record_status === 'resolved' && g.summary?.includes('Status: completed'));

  // 6 mooted (5 original APPLIED + 1 test APPLIED with null coordinates), 5 approved, 5 under construction, 5 completed
  assert.equal(mootedGeos.length, 6, 'Mooted / Applied projects must be strictly preserved as mooted');
  assert.equal(approvedGeos.length, 5, 'Approved projects must be strictly preserved as approved');
  assert.equal(underConstructionGeos.length, 5, 'Under construction projects must be preserved as under_construction');
  assert.equal(completedGeos.length, 5, 'Completed projects must be preserved as completed');

  // Under NO circumstances must mooted or under_construction collapse into approved
  for (const g of mootedGeos) {
    assert.equal(g.assertion_kind, 'plan');
    assert.equal(g.record_status, 'planned');
    assert.ok(!g.summary?.includes('Status: approved'));
  }
  for (const g of underConstructionGeos) {
    assert.equal(g.assertion_kind, 'plan');
    assert.equal(g.record_status, 'active');
    assert.ok(!g.summary?.includes('Status: approved'));
  }
  for (const g of completedGeos) {
    assert.equal(g.assertion_kind, 'observation');
    assert.equal(g.record_status, 'resolved');
    assert.ok(!g.summary?.includes('Status: approved'));
    assert.equal(g.observed_at, null, 'Annual completion year only must leave observed_at null');
    const matchingSource: SourceRecord | undefined = result.sourceRecords.find(s => s.source_record_id === g.geo_record_id);
    assert.ok(matchingSource, 'Corresponding sourceRecord must exist');
    assert.equal(matchingSource.observed_at, null, 'SourceRecord observed_at must be null');
    assert.equal(
      matchingSource.time_missing_reason,
      'Annual completion year only, no per-row observation timestamp',
      'SourceRecord must explain that annual completion year has no per-row observation timestamp',
    );
  }

  // All records must validate under canonical schemas
  for (const sr of result.sourceRecords) {
    assert.deepEqual(parseSourceRecord(sr), sr);
    assert.equal(sr.rights_status, 'verified_open');
    assert.equal(sr.record_status, 'active');
  }

  for (const gr of result.geoRecords) {
    const geoValidation = validateGeoRecordGeography(gr);
    assert.equal(geoValidation.valid, true, `GeoRecord ${gr.geo_record_id} must have valid geography`);
    assert.equal(gr.rights_status, 'verified_open');
    assert.equal(gr.public_query_allowed, true);
    assert.equal(gr.topic, 'planning');
  }

  for (const grs of result.geoRecordSources) {
    assert.equal(grs.source_id, SOURCE_ID);
    assert.equal(grs.evidence_role, 'official_development_monitor_project');
  }
});

test('com_development_monitor preserves WGS84 point coordinates and handles missing coordinates without defaulting to 0,0', async () => {
  const fixture = await loadFixture();
  const fetchedAt = '2026-09-29T12:00:00Z';

  class MockClient extends OpenDataSoftClient {
    override async fetchDatasetDataProcessed(): Promise<string> {
      return '2026-08-15T00:00:00.000Z';
    }
    override async fetchRecords(): Promise<OdsRecords> {
      return {
        records: fixture.results,
        totalCount: fixture.total_count,
        pageCount: 1,
        fetchedAt,
        lastModified: null,
      };
    }
  }

  const connector = new DevelopmentMonitorConnector(new MockClient());
  const input = parseConnectorInput({
    sourceId: SOURCE_ID,
    window: { kind: 'snapshot', revision: '2026-08' },
    checkpoint: null,
    runId: 'coords_test_run',
  });

  const result = await connector.collect(input);
  assert.equal(result.kind, 'success');
  if (result.kind !== 'success') return;

  // 1. Mapped project (X0010400: Macaulay Road, North Melbourne)
  const mapped = result.geoRecords.find(g => g.geo_record_id === `${SOURCE_ID}:X0010400`);
  assert.ok(mapped, 'Project X0010400 must exist');
  assert.ok(mapped.centroid_lat !== null && mapped.centroid_lon !== null);
  assert.ok(mapped.centroid_lat < -37 && mapped.centroid_lat > -38, 'Latitude must be Melbourne latitude (~-37.8)');
  assert.ok(mapped.centroid_lon > 144 && mapped.centroid_lon < 145, 'Longitude must be Melbourne longitude (~144.9)');
  assert.equal(mapped.location_role, 'event_site');
  assert.equal(mapped.location_confidence, 'source_coordinate');

  const geoJson = JSON.parse(mapped.geometry_geojson ?? '{}');
  assert.equal(geoJson.type, 'Point');
  assert.equal(geoJson.coordinates[0], mapped.centroid_lon, 'First coordinate must be longitude');
  assert.equal(geoJson.coordinates[1], mapped.centroid_lat, 'Second coordinate must be latitude');

  // 2. Unmapped project (X0099999: null coordinates)
  const unmapped = result.geoRecords.find(g => g.geo_record_id === `${SOURCE_ID}:X0099999`);
  assert.ok(unmapped, 'Project X0099999 must exist');
  assert.equal(unmapped.centroid_lat, null, 'Missing latitude must remain null, never 0');
  assert.equal(unmapped.centroid_lon, null, 'Missing longitude must remain null, never 0');
  assert.equal(unmapped.geometry_geojson, null, 'Missing geometry must remain null');
  assert.equal(unmapped.location_role, 'unknown');
  assert.equal(unmapped.location_confidence, 'unverified');

  const unmappedValidation = validateGeoRecordGeography(unmapped);
  assert.equal(unmappedValidation.valid, true, 'Unmapped record must still validate cleanly with null geography');
});

test('normalizeDevelopmentStatus strictly preserves 4 distinct statuses and handles aliases', () => {
  // APPLIED / MOOTED / PLANNED -> 'mooted'
  assert.equal(normalizeDevelopmentStatus('APPLIED'), 'mooted');
  assert.equal(normalizeDevelopmentStatus('applied'), 'mooted');
  assert.equal(normalizeDevelopmentStatus('MOOTED'), 'mooted');
  assert.equal(normalizeDevelopmentStatus('mooted'), 'mooted');
  assert.equal(normalizeDevelopmentStatus('PLANNED'), 'mooted');
  assert.equal(normalizeDevelopmentStatus('planned'), 'mooted');

  // APPROVED -> 'approved'
  assert.equal(normalizeDevelopmentStatus('APPROVED'), 'approved');
  assert.equal(normalizeDevelopmentStatus('approved'), 'approved');
  assert.equal(normalizeDevelopmentStatus(' Approved '), 'approved');

  // UNDER CONSTRUCTION / CONSTRUCTION -> 'under_construction'
  assert.equal(normalizeDevelopmentStatus('UNDER CONSTRUCTION'), 'under_construction');
  assert.equal(normalizeDevelopmentStatus('under construction'), 'under_construction');
  assert.equal(normalizeDevelopmentStatus('CONSTRUCTION'), 'under_construction');
  assert.equal(normalizeDevelopmentStatus('UNDER_CONSTRUCTION'), 'under_construction');

  // COMPLETED -> 'completed'
  assert.equal(normalizeDevelopmentStatus('COMPLETED'), 'completed');
  assert.equal(normalizeDevelopmentStatus('completed'), 'completed');

  // Fallbacks: unknown or empty must NOT claim approval
  assert.equal(normalizeDevelopmentStatus(null), 'mooted');
  assert.equal(normalizeDevelopmentStatus(undefined), 'mooted');
  assert.equal(normalizeDevelopmentStatus('UNKNOWN_STATUS'), 'mooted');
});

test('com_development_monitor detects duplicate development_key in a batch and fails closed', async () => {
  const fixture = await loadFixture();
  const duplicateRecords = [fixture.results[0]!, fixture.results[0]!];

  class DuplicateClient extends OpenDataSoftClient {
    override async fetchDatasetDataProcessed(): Promise<string> {
      return '2026-08-15T00:00:00.000Z';
    }
    override async fetchRecords(): Promise<OdsRecords> {
      return {
        records: duplicateRecords,
        totalCount: 2,
        pageCount: 1,
        fetchedAt: '2026-09-29T12:00:00Z',
        lastModified: null,
      };
    }
  }

  const connector = new DevelopmentMonitorConnector(new DuplicateClient());
  const input = parseConnectorInput({
    sourceId: SOURCE_ID,
    window: { kind: 'snapshot', revision: '2026-08' },
    checkpoint: null,
    runId: 'dup_test_run',
  });

  const result = await connector.collect(input);
  assert.equal(result.kind, 'failure');
  if (result.kind === 'failure') {
    assert.equal(result.code, 'validation_failed');
    assert.ok(result.message.includes('Duplicate development_key'));
  }
});

test('com_development_monitor fails if input sourceId does not match canonical sourceId', async () => {
  const connector = new DevelopmentMonitorConnector();
  const input = parseConnectorInput({
    sourceId: 'victoria.other_source',
    window: { kind: 'snapshot', revision: '2026-08' },
    checkpoint: null,
    runId: 'bad_source_run',
  });

  const result = await connector.collect(input);
  assert.equal(result.kind, 'failure');
  if (result.kind === 'failure') {
    assert.equal(result.code, 'validation_failed');
    assert.ok(result.message.includes('Expected sourceId'));
  }
});

test('normalizeDevelopmentRecord extracts building details and floor areas', () => {
  const raw: ComDevelopmentMonitorRawRecord = {
    development_key: 'TEST001',
    status: 'APPROVED',
    year_completed: null,
    clue_small_area: 'Melbourne (CBD)',
    clue_block: 101,
    street_address: '100 Elizabeth Street, Melbourne, 3000',
    property_id: '12345',
    property_id_2: '67890',
    floors_above: 25,
    resi_dwellings: 150,
    studio_dwe: 10,
    one_bdrm_dwe: 50,
    two_bdrm_dwe: 70,
    three_bdrm_dwe: 20,
    office_flr: 5000,
    retail_flr: 1200,
    car_spaces: 80,
    bike_spaces: 120,
    town_planning_application: 'TP-2023-100',
    longitude: 144.963,
    latitude: -37.814,
  };

  const { sourceRecord, geoRecord, geoRecordSource, project } = normalizeDevelopmentRecord(
    raw,
    'run_test',
    '2026-09-29T12:00:00Z',
    '2026-08-15T00:00:00Z',
  );

  assert.equal(sourceRecord.source_record_id, `${SOURCE_ID}:TEST001`);
  assert.equal(sourceRecord.assertion_kind, 'plan');
  assert.equal(sourceRecord.record_status, 'active');
  assert.equal(sourceRecord.rights_status, 'verified_open');

  assert.equal(geoRecord.geo_record_id, `${SOURCE_ID}:TEST001`);
  assert.equal(geoRecord.assertion_kind, 'plan');
  assert.equal(geoRecord.record_status, 'planned');
  assert.equal(geoRecord.topic, 'planning');
  assert.equal(geoRecord.area_refs.length, 1);
  assert.ok(geoRecord.area_refs.includes('clue_small_area:melbourne_cbd'));
  assert.ok(!geoRecord.area_refs.includes('com_block:101'));

  assert.equal(geoRecordSource.source_record_id, `${SOURCE_ID}:TEST001`);

  assert.equal(project.development_status, 'approved');
  assert.equal(project.floors_above, 25);
  assert.equal(project.resi_dwellings, 150);
  assert.equal(project.dwellings_breakdown.one_bedroom, 50);
  assert.equal(project.dwellings_breakdown.two_bedroom, 70);
  assert.equal(project.floor_space_sqm.office, 5000);
  assert.equal(project.floor_space_sqm.retail, 1200);
  assert.equal(project.parking_spaces.car_spaces, 80);
  assert.equal(project.parking_spaces.bike_spaces, 120);
  assert.equal(project.dwellings_breakdown.childcare_places, null, 'Unspecified childcare places must remain null');
  assert.equal(project.floor_space_sqm.industrial, null, 'Unspecified industrial floor space must remain null');
  assert.deepEqual(project.property_ids, ['12345', '67890']);
});

test('com_development_monitor exports connector instance conforming to frozen Connector interface', () => {
  assert.ok(isConnector(connector), 'Must implement Connector interface');
  assert.equal(connector.sourceId, SOURCE_ID);
  assert.equal(typeof connector.collect, 'function');
});

test('development snapshot fails closed when official data_processed changes during pagination', async () => {
  const fixture = await loadFixture();
  class ChangingClient extends OpenDataSoftClient {
    private reads = 0;

    override async fetchDatasetDataProcessed(): Promise<string> {
      this.reads += 1;
      return this.reads === 1 ? '2026-08-15T00:00:00.000Z' : '2026-08-16T00:00:00.000Z';
    }

    override async fetchRecords(): Promise<OdsRecords> {
      return { records: fixture.results, totalCount: fixture.total_count,
        pageCount: 1, fetchedAt: '2026-09-29T12:00:00Z', lastModified: null };
    }
  }
  const result = await new DevelopmentMonitorConnector(new ChangingClient()).collect(
    parseConnectorInput({ sourceId: SOURCE_ID,
      window: { kind: 'snapshot', revision: '2026-08' }, checkpoint: null,
      runId: 'changed_snapshot_run' }),
  );
  assert.equal(result.kind, 'failure');
  if (result.kind === 'failure') assert.equal(result.code, 'incomplete_window');
});

test('com_development_monitor handles OpenDataSoft pagination/network errors gracefully', async () => {
  class FailingClient extends OpenDataSoftClient {
    override async fetchDatasetDataProcessed(): Promise<string> {
      return '2026-08-15T00:00:00.000Z';
    }
    override async fetchRecords(): Promise<OdsRecords> {
      throw new OdsIncompleteWindow('Simulated truncated page stream', 21);
    }
  }

  const failingConnector = new DevelopmentMonitorConnector(new FailingClient());
  const input = parseConnectorInput({
    sourceId: SOURCE_ID,
    window: { kind: 'snapshot', revision: '2026-08' },
    checkpoint: null,
    runId: 'incomplete_window_run',
  });

  const result = await failingConnector.collect(input);
  assert.equal(result.kind, 'failure');
  if (result.kind === 'failure') {
    assert.equal(result.code, 'incomplete_window');
    assert.equal(result.completeness.complete, false);
  }
});

test('com_development_monitor fails closed if upstream row violates schema', async () => {
  class BadSchemaClient extends OpenDataSoftClient {
    override async fetchDatasetDataProcessed(): Promise<string> {
      return '2026-08-15T00:00:00.000Z';
    }
    override async fetchRecords(): Promise<OdsRecords> {
      return {
        records: [{ status: 'APPROVED' }], // missing development_key
        totalCount: 1,
        pageCount: 1,
        fetchedAt: '2026-09-29T12:00:00Z',
        lastModified: null,
      };
    }
  }

  const badConnector = new DevelopmentMonitorConnector(new BadSchemaClient());
  const input = parseConnectorInput({
    sourceId: SOURCE_ID,
    window: { kind: 'snapshot', revision: '2026-08' },
    checkpoint: null,
    runId: 'bad_schema_run',
  });

  const result = await badConnector.collect(input);
  assert.equal(result.kind, 'failure');
  if (result.kind === 'failure') {
    assert.equal(result.code, 'schema_changed');
  }
});

test('annual completion year leaves observed_at null with reason and preserves completion year at year granularity', () => {
  // Test case 1: String completion year '2002' as in upstream source
  const rawWithYearString: ComDevelopmentMonitorRawRecord = {
    development_key: 'X000557',
    status: 'COMPLETED',
    year_completed: '2002',
    street_address: '7-21 Anderson Street',
  };

  const norm1 = normalizeDevelopmentRecord(
    rawWithYearString,
    'run_temporal',
    '2026-09-29T12:00:00Z',
    '2026-08-15T00:00:00Z',
  );

  assert.equal(norm1.sourceRecord.observed_at, null, 'Observed time must remain null when only annual year is known');
  assert.equal(
    norm1.sourceRecord.time_missing_reason,
    'Annual completion year only, no per-row observation timestamp',
  );
  assert.equal(norm1.geoRecord.observed_at, null, 'GeoRecord observed_at must remain null');
  assert.equal(norm1.project.year_completed, 2002, 'Completion year must be preserved at year granularity');
  assert.equal(norm1.project.development_status, 'completed');

  // Test case 2: Numeric completion year 2004
  const rawWithYearNum: ComDevelopmentMonitorRawRecord = {
    development_key: 'X000458',
    status: 'COMPLETED',
    year_completed: 2004,
  };

  const norm2 = normalizeDevelopmentRecord(
    rawWithYearNum,
    'run_temporal',
    '2026-09-29T12:00:00Z',
    null,
  );

  assert.equal(norm2.sourceRecord.observed_at, null);
  assert.equal(
    norm2.sourceRecord.time_missing_reason,
    'Annual completion year only, no per-row observation timestamp',
  );
  assert.equal(norm2.geoRecord.observed_at, null);
  assert.equal(norm2.project.year_completed, 2004);

  // Test case 3: No completion year (null)
  const rawWithoutYear: ComDevelopmentMonitorRawRecord = {
    development_key: 'X0010400',
    status: 'APPLIED',
    year_completed: null,
  };

  const norm3 = normalizeDevelopmentRecord(
    rawWithoutYear,
    'run_temporal',
    '2026-09-29T12:00:00Z',
    null,
  );

  assert.equal(norm3.sourceRecord.observed_at, null);
  assert.equal(
    norm3.sourceRecord.time_missing_reason,
    'Monthly development monitor dataset does not carry per-row observation timestamps',
  );
  assert.equal(norm3.geoRecord.observed_at, null);
  assert.equal(norm3.project.year_completed, null);
});

test('missing dwelling and floor area counts remain null and are never zero-filled', () => {
  const rawMissing: ComDevelopmentMonitorRawRecord = {
    development_key: 'X_MISSING',
    status: 'APPLIED',
    street_address: '100 Missing Counts Road',
    // All dwelling counts and floor areas are null or undefined
    resi_dwellings: null,
    studio_dwe: null,
    one_bdrm_dwe: null,
    two_bdrm_dwe: undefined,
    three_bdrm_dwe: null,
    student_apartments: null,
    student_beds: undefined,
    hotel_rooms: null,
    childcare_places: null,
    office_flr: null,
    retail_flr: undefined,
    industrial_flr: null,
    car_spaces: null,
    bike_spaces: undefined,
  };

  const norm = normalizeDevelopmentRecord(
    rawMissing,
    'run_missing',
    '2026-09-29T12:00:00Z',
    null,
  );

  // Verify project level: all missing fields MUST stay null
  assert.equal(norm.project.resi_dwellings, null, 'resi_dwellings must remain null when null in source');
  assert.equal(norm.project.dwellings_breakdown.studio, null, 'studio must remain null');
  assert.equal(norm.project.dwellings_breakdown.one_bedroom, null, 'one_bedroom must remain null');
  assert.equal(norm.project.dwellings_breakdown.two_bedroom, null, 'two_bedroom must remain null');
  assert.equal(norm.project.dwellings_breakdown.three_or_more_bedroom, null, 'three_or_more_bedroom must remain null');
  assert.equal(norm.project.dwellings_breakdown.student_apartments, null, 'student_apartments must remain null');
  assert.equal(norm.project.dwellings_breakdown.student_beds, null, 'student_beds must remain null');
  assert.equal(norm.project.dwellings_breakdown.hotel_rooms, null, 'hotel_rooms must remain null');
  assert.equal(norm.project.dwellings_breakdown.childcare_places, null, 'childcare_places must remain null');
  assert.equal(norm.project.floor_space_sqm.office, null, 'office_flr must remain null');
  assert.equal(norm.project.floor_space_sqm.retail, null, 'retail_flr must remain null');
  assert.equal(norm.project.floor_space_sqm.industrial, null, 'industrial_flr must remain null');
  assert.equal(norm.project.parking_spaces.car_spaces, null, 'car_spaces must remain null');
  assert.equal(norm.project.parking_spaces.bike_spaces, null, 'bike_spaces must remain null');

  // Verify GeoRecord summary does not fabricate '0'
  assert.ok(norm.geoRecord.summary?.includes('Dwellings: unspecified'), 'Summary must say unspecified for null dwellings');
  assert.ok(!norm.geoRecord.summary?.includes('Dwellings: 0'), 'Summary must NOT report 0 for null dwellings');
});

test('genuine zero counts from upstream remain numeric 0', () => {
  const rawZeros: ComDevelopmentMonitorRawRecord = {
    development_key: 'X_ZEROS',
    status: 'APPROVED',
    street_address: '200 Explicit Zero Lane',
    // Explicit 0 from upstream
    resi_dwellings: 0,
    studio_dwe: 0,
    one_bdrm_dwe: 0,
    two_bdrm_dwe: 0,
    three_bdrm_dwe: 0,
    student_apartments: 0,
    student_beds: 0,
    hotel_rooms: 0,
    childcare_places: 0,
    office_flr: 0,
    retail_flr: 0,
    industrial_flr: 0,
    car_spaces: 0,
    bike_spaces: 0,
  };

  const norm = normalizeDevelopmentRecord(
    rawZeros,
    'run_zeros',
    '2026-09-29T12:00:00Z',
    null,
  );

  // Verify project level: explicit 0 must remain 0
  assert.equal(norm.project.resi_dwellings, 0, 'Explicit 0 resi_dwellings must remain 0');
  assert.equal(norm.project.dwellings_breakdown.studio, 0, 'Explicit 0 studio must remain 0');
  assert.equal(norm.project.dwellings_breakdown.one_bedroom, 0, 'Explicit 0 one_bedroom must remain 0');
  assert.equal(norm.project.dwellings_breakdown.two_bedroom, 0, 'Explicit 0 two_bedroom must remain 0');
  assert.equal(norm.project.dwellings_breakdown.three_or_more_bedroom, 0, 'Explicit 0 three_or_more_bedroom must remain 0');
  assert.equal(norm.project.dwellings_breakdown.student_apartments, 0, 'Explicit 0 student_apartments must remain 0');
  assert.equal(norm.project.dwellings_breakdown.student_beds, 0, 'Explicit 0 student_beds must remain 0');
  assert.equal(norm.project.dwellings_breakdown.hotel_rooms, 0, 'Explicit 0 hotel_rooms must remain 0');
  assert.equal(norm.project.dwellings_breakdown.childcare_places, 0, 'Explicit 0 childcare_places must remain 0');
  assert.equal(norm.project.floor_space_sqm.office, 0, 'Explicit 0 office_flr must remain 0');
  assert.equal(norm.project.floor_space_sqm.retail, 0, 'Explicit 0 retail_flr must remain 0');
  assert.equal(norm.project.floor_space_sqm.industrial, 0, 'Explicit 0 industrial_flr must remain 0');
  assert.equal(norm.project.parking_spaces.car_spaces, 0, 'Explicit 0 car_spaces must remain 0');
  assert.equal(norm.project.parking_spaces.bike_spaces, 0, 'Explicit 0 bike_spaces must remain 0');

  // Verify GeoRecord summary correctly displays 0
  assert.ok(norm.geoRecord.summary?.includes('Dwellings: 0'), 'Summary must report 0 when source explicitly had 0');
  assert.ok(!norm.geoRecord.summary?.includes('Dwellings: unspecified'), 'Summary must not say unspecified when 0');
});

test('parseNullableCount handles null, undefined, explicit 0, and positive numbers correctly', () => {
  assert.equal(parseNullableCount(null), null);
  assert.equal(parseNullableCount(undefined), null);
  assert.equal(parseNullableCount(0), 0);
  assert.equal(parseNullableCount(42), 42);
  assert.equal(parseNullableCount(NaN as any), null);
});
