import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { beforeEach, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  DATASET_ID,
  PedestrianLocationsConnector,
  SOURCE_ID,
  parsePedestrianLocationRow,
} from '../../src/connectors/com_pedestrian_locations/index.js';

beforeEach(() => {
  PedestrianLocationsConnector.resetSharedState();
});
import { parseConnectorInput } from '../../src/core/connector.js';
import { HttpFailure } from '../../src/core/http.js';
import { OpenDataSoftClient, OdsIncompleteWindow, type OdsQuery, type OdsRecords } from '../../src/core/opendatasoft.js';
import { parseSourceManifest } from '../../src/core/registry.js';
import type { PedestrianObservation, SensorLocation } from '../../src/core/types.js';
import { joinPedestrianObservations } from '../../src/normalization/pedestrian.js';
import { validateGeoRecordGeography } from '../../src/validation/geography.js';

const defaultInput = parseConnectorInput({
  sourceId: SOURCE_ID,
  window: { kind: 'snapshot', revision: 'latest' },
  checkpoint: null,
  runId: 'fixture-test-run',
});

async function loadFixture(): Promise<{ total_count: number; results: unknown[] }> {
  const fixtureUrl = new URL('../fixtures/com_pedestrian_locations.json', import.meta.url);
  const content = await readFile(fileURLToPath(fixtureUrl), 'utf8');
  return JSON.parse(content) as { total_count: number; results: unknown[] };
}

test('manifest registers source with review_required status and candidate access', async () => {
  const manifestUrl = new URL('../../src/connectors/com_pedestrian_locations/source.json', import.meta.url);
  const manifest = JSON.parse(await readFile(fileURLToPath(manifestUrl), 'utf8'));
  const dataSource = parseSourceManifest(manifest);

  assert.equal(dataSource.source_id, SOURCE_ID);
  assert.equal(dataSource.topic, 'pedestrian');
  assert.equal(dataSource.scope, 'city');
  assert.equal(dataSource.license_status, 'review_required');
  assert.equal(dataSource.access_status, 'candidate');
  assert.equal(dataSource.record_granularity, 'sensor_location_version');
  assert.equal(dataSource.admission_evidence.native_record_key, 'location_id');
});

test('collect parses fixture records into canonical sensorLocations, sourceRecords, and geoRecords', async () => {
  const fixture = await loadFixture();
  const fetchedAt = '2026-09-29T10:00:00.000Z';
  const lastModified = '2026-09-29T04:00:00.000Z';

  class MockClient extends OpenDataSoftClient {
    override async fetchRecords(query: OdsQuery): Promise<OdsRecords> {
      assert.equal(query.datasetId, DATASET_ID);
      return {
        records: fixture.results,
        totalCount: fixture.total_count,
        pageCount: 1,
        fetchedAt,
        lastModified,
      };
    }
  }

  const connector = new PedestrianLocationsConnector({ client: new MockClient() });
  const result = await connector.collect(defaultInput);

  assert.equal(result.kind, 'success');
  if (result.kind !== 'success') return;

  assert.equal(result.inputCount, 5);
  assert.equal(result.outputCount, 5);
  assert.equal(result.sensorLocations.length, 5);
  assert.equal(result.sourceRecords.length, 5);
  assert.equal(result.geoRecords.length, 5);
  assert.equal(result.geoRecordSources.length, 5);

  // Active sensor with coordinates (location_id: 3)
  const loc3 = result.sensorLocations.find(l => l.sensor_id === '3');
  assert.ok(loc3, 'Sensor 3 must exist');
  assert.equal(loc3.device_status, 'A');
  assert.equal(loc3.valid_from, '2009-03-25T00:00:00.000Z');
  assert.equal(loc3.valid_to, null);
  assert.ok(loc3.geometry_geojson?.includes('144.96429485'));
  assert.ok(loc3.geometry_geojson?.includes('-37.81101524'));

  const geo3 = result.geoRecords.find(g => g.geo_record_id === `${SOURCE_ID}:3`);
  assert.ok(geo3, 'GeoRecord 3 must exist');
  assert.equal(geo3.title, 'Melbourne Central');
  assert.equal(geo3.location_role, 'sensor_site');
  assert.equal(geo3.location_confidence, 'source_coordinate');
  assert.equal(geo3.rights_status, 'review_required');
  assert.equal(geo3.public_query_allowed, false);
  assert.equal(geo3.record_status, 'active');

  const geo3Validation = validateGeoRecordGeography(geo3);
  assert.equal(geo3Validation.valid, true);

  // Sensor with relocation note (location_id: 14) preserves install date and does NOT invent dates from note
  const loc14 = result.sensorLocations.find(l => l.sensor_id === '14');
  assert.ok(loc14, 'Sensor 14 must exist');
  assert.equal(loc14.device_status, 'A');
  assert.equal(loc14.valid_from, '2009-03-24T00:00:00.000Z');
  assert.equal(loc14.valid_to, null, 'Must not invent effective date from note: Sensor relocated to sensor ID 25 on 2/10/2019');
  assert.ok(loc14.geometry_geojson?.includes('144.96291897'));
  assert.ok(loc14.geometry_geojson?.includes('-37.82011242'));

  // Undated active sensor (location_id: 48) falls back to fetchedAt
  const loc48 = result.sensorLocations.find(l => l.sensor_id === '48');
  assert.ok(loc48, 'Sensor 48 must exist');
  assert.equal(loc48.device_status, 'A');
  assert.equal(loc48.valid_from, fetchedAt);

  // Inactive sensor (location_id: 52)
  const loc52 = result.sensorLocations.find(l => l.sensor_id === '52');
  assert.ok(loc52, 'Sensor 52 must exist');
  assert.equal(loc52.device_status, 'I');

  // Removed sensor (location_id: 90)
  const loc90 = result.sensorLocations.find(l => l.sensor_id === '90');
  assert.ok(loc90, 'Sensor 90 must exist');
  assert.equal(loc90.device_status, 'R');
  assert.equal(loc90.geometry_geojson, null);

  const geo90 = result.geoRecords.find(g => g.geo_record_id === `${SOURCE_ID}:90`);
  assert.ok(geo90, 'GeoRecord 90 must exist');
  assert.equal(geo90.location_role, 'unknown');
  assert.equal(geo90.location_confidence, 'unverified');
  assert.equal(geo90.record_status, 'resolved');
  assert.equal(geo90.geometry_geojson, null);
  assert.equal(geo90.centroid_lat, null);
  assert.equal(geo90.centroid_lon, null);

  const geo90Validation = validateGeoRecordGeography(geo90);
  assert.equal(geo90Validation.valid, true);

  // All source records maintain review_required rights status and provenance
  for (const src of result.sourceRecords) {
    assert.equal(src.rights_status, 'review_required');
    assert.equal(src.assertion_kind, 'observation');
    assert.equal(src.source_id, SOURCE_ID);
    assert.equal(src.time_missing_reason, 'The location row has no per-row source update timestamp');
  }
});

test('relocation of a sensor generates a distinct version_id and joins historical observations', async () => {
  const baseRow = {
    location_id: 10,
    sensor_description: 'Test Sensor',
    sensor_name: 'Test_1',
    installation_date: '2026-09-01',
    note: null,
    status: 'A',
    latitude: -37.8100,
    longitude: 144.9600,
  };

  class FirstSnapshotClient extends OpenDataSoftClient {
    override async fetchRecords(): Promise<OdsRecords> {
      return {
        records: [baseRow],
        totalCount: 1,
        pageCount: 1,
        fetchedAt: '2026-09-01T00:00:00.000Z',
        lastModified: '2026-09-01T00:00:00.000Z',
      };
    }
  }

  const connector1 = new PedestrianLocationsConnector({ client: new FirstSnapshotClient() });
  const result1 = await connector1.collect(defaultInput);
  assert.equal(result1.kind, 'success');
  if (result1.kind !== 'success') return;

  const locV1 = result1.sensorLocations[0];
  assert.ok(locV1);

  // In second snapshot, sensor was relocated to new coordinates
  const movedRow = {
    ...baseRow,
    latitude: -37.8200,
    longitude: 144.9700,
    note: 'Relocated on 2026-09-15',
    valid_from: '2026-09-15T00:00:00.000Z',
  };

  class SecondSnapshotClient extends OpenDataSoftClient {
    override async fetchRecords(): Promise<OdsRecords> {
      return {
        records: [movedRow],
        totalCount: 1,
        pageCount: 1,
        fetchedAt: '2026-09-15T00:00:00.000Z',
        lastModified: '2026-09-15T00:00:00.000Z',
      };
    }
  }

  const connector2 = new PedestrianLocationsConnector({ client: new SecondSnapshotClient() });
  const result2 = await connector2.collect(defaultInput);
  assert.equal(result2.kind, 'success');
  if (result2.kind !== 'success') return;

  const locV2 = result2.sensorLocations[0];
  assert.ok(locV2);

  // Stable sensor record ID, but different version_id
  assert.equal(locV1.sensor_id, locV2.sensor_id);
  assert.equal(locV1.source_record_id, locV2.source_record_id);
  assert.notEqual(locV1.version_id, locV2.version_id);

  // Test downstream join with observation before and after relocation
  const obsBefore: PedestrianObservation = {
    batch_id: 'batch-1',
    source_id: 'melbourne.pedestrian.minute',
    schema_version: 1,
    fetched_at: '2026-09-10T12:00:00Z',
    sensor_id: '10',
    observed_at: '2026-09-10T12:00:00Z',
    version_id: 'v_obs_1',
    direction_a_count: 5,
    direction_b_count: 7,
    total_count: 12,
    source_record_id: 'obs:1',
  };

  const obsAfter: PedestrianObservation = {
    ...obsBefore,
    observed_at: '2026-09-20T12:00:00Z',
    source_record_id: 'obs:2',
  };

  // locV1 valid_to was automatically set by the connector when superseded by locV2
  assert.equal(locV1.valid_to, '2026-09-15T00:00:00.000Z');

  const joined = joinPedestrianObservations({
    observations: [obsBefore, obsAfter],
    locations: [locV1, locV2],
    granularity: 'minute',
  });

  assert.equal(joined[0]?.location?.version_id, locV1.version_id);
  assert.equal(joined[1]?.location?.version_id, locV2.version_id);
  assert.equal(joined[0]?.locationStatus, 'located');
  assert.equal(joined[1]?.locationStatus, 'located');
});

test('duplicate location_id within a single snapshot causes validation_failed', async () => {
  const row = {
    location_id: 3,
    sensor_description: 'Melbourne Central',
    sensor_name: 'Swa295_T',
    installation_date: '2009-03-25',
    latitude: -37.811,
    longitude: 144.964,
  };

  class DuplicateClient extends OpenDataSoftClient {
    override async fetchRecords(): Promise<OdsRecords> {
      return {
        records: [row, row],
        totalCount: 2,
        pageCount: 1,
        fetchedAt: '2026-09-29T10:00:00.000Z',
        lastModified: null,
      };
    }
  }

  const connector = new PedestrianLocationsConnector({ client: new DuplicateClient() });
  const result = await connector.collect(defaultInput);

  assert.equal(result.kind, 'failure');
  if (result.kind === 'failure') {
    assert.equal(result.code, 'validation_failed');
    assert.match(result.message, /Duplicate location_id detected/);
  }
});

test('incomplete coordinates fail validation', async () => {
  const rowIncomplete = {
    location_id: 77,
    sensor_description: 'Incomplete coordinate sensor',
    installation_date: '2020-01-01',
    status: 'A',
    latitude: -37.81,
    longitude: null,
  };

  class IncompleteCoordClient extends OpenDataSoftClient {
    override async fetchRecords(): Promise<OdsRecords> {
      return {
        records: [rowIncomplete],
        totalCount: 1,
        pageCount: 1,
        fetchedAt: '2026-09-29T10:00:00.000Z',
        lastModified: null,
      };
    }
  }

  const connector = new PedestrianLocationsConnector({ client: new IncompleteCoordClient() });
  const result = await connector.collect(defaultInput);

  assert.equal(result.kind, 'failure');
  if (result.kind === 'failure') {
    assert.equal(result.code, 'validation_failed');
    assert.match(result.message, /incomplete coordinates/i);
  }
});

test('valid_to preceding valid_from fails validation', async () => {
  const rowInvalidWindow = {
    location_id: 88,
    sensor_description: 'Invalid window sensor',
    valid_from: '2026-09-20T00:00:00.000Z',
    valid_to: '2026-09-10T00:00:00.000Z',
    status: 'A',
    latitude: -37.81,
    longitude: 144.96,
  };

  class InvalidWindowClient extends OpenDataSoftClient {
    override async fetchRecords(): Promise<OdsRecords> {
      return {
        records: [rowInvalidWindow],
        totalCount: 1,
        pageCount: 1,
        fetchedAt: '2026-09-29T10:00:00.000Z',
        lastModified: null,
      };
    }
  }

  const connector = new PedestrianLocationsConnector({ client: new InvalidWindowClient() });
  const result = await connector.collect(defaultInput);

  assert.equal(result.kind, 'failure');
  if (result.kind === 'failure') {
    assert.equal(result.code, 'validation_failed');
    assert.match(result.message, /valid_to precedes valid_from/i);
  }
});

test('upstream HTTP failures are mapped to appropriate failure codes', async () => {
  class RateLimitedClient extends OpenDataSoftClient {
    override async fetchRecords(): Promise<OdsRecords> {
      throw new HttpFailure('rate_limited', 429, 3, 60000);
    }
  }

  const connector = new PedestrianLocationsConnector({ client: new RateLimitedClient() });
  const result = await connector.collect(defaultInput);

  assert.equal(result.kind, 'failure');
  if (result.kind === 'failure') {
    assert.equal(result.code, 'rate_limited');
  }
});

test('rejects mismatched source ID with validation_failed', async () => {
  const connector = new PedestrianLocationsConnector();
  const result = await connector.collect(parseConnectorInput({
    sourceId: 'victoria.transport.road_unplanned',
    window: { kind: 'snapshot', revision: 'latest' },
    checkpoint: null,
    runId: 'invalid-source-run',
  }));

  assert.equal(result.kind, 'failure');
  if (result.kind === 'failure') {
    assert.equal(result.code, 'validation_failed');
  }
});

test('sensor relocation across multiple snapshots preserves stable sensor_id and distinct version_ids across 3 lifecycle stages', async () => {
  // Stage 1: Active at site 1
  const stage1Row = {
    location_id: 42,
    sensor_description: 'Swanston St North',
    sensor_name: 'SwaNorth_T',
    installation_date: '2020-01-15',
    note: null,
    status: 'A',
    latitude: -37.8050,
    longitude: 144.9620,
  };

  class Stage1Client extends OpenDataSoftClient {
    override async fetchRecords(): Promise<OdsRecords> {
      return {
        records: [stage1Row],
        totalCount: 1,
        pageCount: 1,
        fetchedAt: '2026-01-01T00:00:00.000Z',
        lastModified: '2026-01-01T00:00:00.000Z',
      };
    }
  }

  const connector1 = new PedestrianLocationsConnector({ client: new Stage1Client() });
  const result1 = await connector1.collect(defaultInput);
  assert.equal(result1.kind, 'success');
  if (result1.kind !== 'success') return;
  const loc1 = result1.sensorLocations[0]!;
  assert.equal(loc1.sensor_id, '42');
  assert.equal(loc1.device_status, 'A');
  assert.ok(loc1.geometry_geojson?.includes('144.962'));

  // Stage 2: Relocated to site 2 (status still active, coordinates changed)
  const stage2Row = {
    ...stage1Row,
    sensor_description: 'Swanston St South',
    note: 'Relocated due to building works',
    latitude: -37.8150,
    longitude: 144.9650,
  };

  class Stage2Client extends OpenDataSoftClient {
    override async fetchRecords(): Promise<OdsRecords> {
      return {
        records: [stage2Row],
        totalCount: 1,
        pageCount: 1,
        fetchedAt: '2026-05-01T00:00:00.000Z',
        lastModified: '2026-05-01T00:00:00.000Z',
      };
    }
  }

  const connector2 = new PedestrianLocationsConnector({ client: new Stage2Client() });
  const result2 = await connector2.collect(defaultInput);
  assert.equal(result2.kind, 'success');
  if (result2.kind !== 'success') return;
  const loc2 = result2.sensorLocations[0]!;
  assert.equal(loc2.sensor_id, '42');
  assert.equal(loc2.device_status, 'A');
  assert.ok(loc2.geometry_geojson?.includes('144.965'));

  // Stage 3: Decommissioned / Removed (status 'R', coordinates null)
  const stage3Row = {
    ...stage1Row,
    sensor_description: 'Swanston St South (Removed)',
    note: 'Removed permanently',
    status: 'R',
    latitude: null,
    longitude: null,
    location: null,
  };

  class Stage3Client extends OpenDataSoftClient {
    override async fetchRecords(): Promise<OdsRecords> {
      return {
        records: [stage3Row],
        totalCount: 1,
        pageCount: 1,
        fetchedAt: '2026-09-01T00:00:00.000Z',
        lastModified: '2026-09-01T00:00:00.000Z',
      };
    }
  }

  const connector3 = new PedestrianLocationsConnector({ client: new Stage3Client() });
  const result3 = await connector3.collect(defaultInput);
  assert.equal(result3.kind, 'success');
  if (result3.kind !== 'success') return;
  const loc3 = result3.sensorLocations[0]!;
  const geo3 = result3.geoRecords[0]!;

  assert.equal(loc3.sensor_id, '42');
  assert.equal(loc3.device_status, 'R');
  assert.equal(loc3.geometry_geojson, null);
  assert.equal(geo3.record_status, 'resolved');
  assert.equal(geo3.location_role, 'unknown');
  assert.equal(geo3.location_confidence, 'unverified');

  // Verify stable native identity across all stages
  assert.equal(loc1.source_record_id, loc2.source_record_id);
  assert.equal(loc2.source_record_id, loc3.source_record_id);

  // Verify distinct version_id across all 3 lifecycle stages
  assert.notEqual(loc1.version_id, loc2.version_id);
  assert.notEqual(loc2.version_id, loc3.version_id);
  assert.notEqual(loc1.version_id, loc3.version_id);

  // Verify lifecycle valid intervals:
  // Stage 1 was valid from installation date until Stage 1 snapshot observation time
  assert.equal(loc1.valid_from, '2020-01-15T00:00:00.000Z');
  assert.equal(loc1.valid_to, '2026-01-01T00:00:00.000Z');

  // Stage 2 (relocation without official date) is valid from Stage 2 snapshot observation time,
  // NOT backdated to 2020-01-15!
  assert.notEqual(loc2.valid_from, '2020-01-15T00:00:00.000Z');
  assert.equal(loc2.valid_from, '2026-05-01T00:00:00.000Z');
  assert.equal(loc2.valid_to, '2026-05-01T00:00:00.000Z');

  // Stage 3 (decommissioned/removed) is valid from Stage 3 snapshot observation time
  assert.equal(loc3.valid_from, '2026-09-01T00:00:00.000Z');
  assert.equal(loc3.valid_to, null);
});

test('relocation across versions preserves original installation date for initial location, avoids backdating new coordinates, and keeps unknown transition gap unlocated (G08)', async () => {
  const rowV1 = {
    location_id: 3,
    sensor_description: 'Melbourne Central',
    sensor_name: 'Swa295_T',
    installation_date: '2009-03-25',
    note: null,
    status: 'A',
    latitude: -37.81101524,
    longitude: 144.96429485,
  };

  class Snap1Client extends OpenDataSoftClient {
    override async fetchRecords(): Promise<OdsRecords> {
      return {
        records: [rowV1],
        totalCount: 1,
        pageCount: 1,
        fetchedAt: '2026-01-01T00:00:00.000Z',
        lastModified: '2026-01-01T00:00:00.000Z',
      };
    }
  }

  const connector1 = new PedestrianLocationsConnector({ client: new Snap1Client() });
  const result1 = await connector1.collect(defaultInput);
  assert.equal(result1.kind, 'success');
  if (result1.kind !== 'success') return;
  const locV1 = result1.sensorLocations[0]!;

  // Initial location: valid_from matches installation date
  assert.equal(locV1.valid_from, '2009-03-25T00:00:00.000Z');
  assert.equal(locV1.valid_to, null);

  // In second snapshot: same sensor, installation_date unchanged, coordinates changed, NO valid_from provided
  const rowV2 = {
    ...rowV1,
    latitude: -37.82000000,
    longitude: 144.97000000,
  };

  class Snap2Client extends OpenDataSoftClient {
    override async fetchRecords(): Promise<OdsRecords> {
      return {
        records: [rowV2],
        totalCount: 1,
        pageCount: 1,
        fetchedAt: '2026-05-01T00:00:00.000Z',
        lastModified: '2026-05-01T00:00:00.000Z',
      };
    }
  }

  const connector2 = new PedestrianLocationsConnector({
    client: new Snap2Client(),
    previousLocations: result1.sensorLocations,
  });
  const result2 = await connector2.collect(defaultInput);
  assert.equal(result2.kind, 'success');
  if (result2.kind !== 'success') return;
  const locV2 = result2.sensorLocations[0]!;

  // 1. Distinguish device installation date from coordinate valid interval
  // 2. New coordinates must NOT be backdated to original installation_date (2009-03-25)
  assert.notEqual(locV2.valid_from, '2009-03-25T00:00:00.000Z');
  assert.equal(locV2.valid_from, '2026-05-01T00:00:00.000Z');
  assert.equal(locV2.valid_to, null);

  // 3. Previous location valid_to was closed at the last snapshot it was observed (2026-01-01)
  assert.equal(locV1.valid_to, '2026-01-01T00:00:00.000Z');

  // Verify time_missing_reason explains snapshot boundary
  const srcV2 = result2.sourceRecords[0]!;
  assert.match(srcV2.time_missing_reason ?? '', /Relocation detected across versions/);

  // Downstream verification with joinPedestrianObservations
  const obsHistorical: PedestrianObservation = {
    batch_id: 'b1',
    source_id: 'melbourne.pedestrian.minute',
    schema_version: 1,
    fetched_at: '2020-06-01T12:00:00Z',
    sensor_id: '3',
    observed_at: '2020-06-01T12:00:00Z',
    version_id: 'v_obs_hist',
    direction_a_count: 10,
    direction_b_count: 20,
    total_count: 30,
    source_record_id: 'obs:hist',
  };

  const obsInGap: PedestrianObservation = {
    ...obsHistorical,
    observed_at: '2026-03-01T12:00:00Z', // In unknown interval [2026-01-01, 2026-05-01)
    source_record_id: 'obs:gap',
  };

  const obsAfterMove: PedestrianObservation = {
    ...obsHistorical,
    observed_at: '2026-06-01T12:00:00Z',
    source_record_id: 'obs:after',
  };

  // When both versions are passed:
  // - Historical observation joins locV1
  // - Gap observation is UNLOCATED (not misattributed to Site 1 or Site 2, and not ambiguous)
  // - After move joins locV2
  const joinedBoth = joinPedestrianObservations({
    observations: [obsHistorical, obsInGap, obsAfterMove],
    locations: [locV1, locV2],
    granularity: 'minute',
  });

  assert.equal(joinedBoth[0]?.locationStatus, 'located');
  assert.equal(joinedBoth[0]?.location?.version_id, locV1.version_id);
  assert.ok(joinedBoth[0]?.location?.geometry_geojson?.includes('-37.81101524'));

  assert.equal(joinedBoth[1]?.locationStatus, 'unlocated', 'Observation in unknown transition gap must be unlocated');
  assert.equal(joinedBoth[1]?.location, null);

  assert.equal(joinedBoth[2]?.locationStatus, 'located');
  assert.equal(joinedBoth[2]?.location?.version_id, locV2.version_id);
  assert.ok(joinedBoth[2]?.location?.geometry_geojson?.includes('-37.82'));

  // If ONLY locV2 is loaded without locV1:
  // Historical observation must NOT match locV2 (avoids attributing 2020 to new coordinates)
  const joinedOnlyV2 = joinPedestrianObservations({
    observations: [obsHistorical],
    locations: [locV2],
    granularity: 'minute',
  });
  assert.equal(joinedOnlyV2[0]?.locationStatus, 'unlocated');
  assert.equal(joinedOnlyV2[0]?.location, null);
});

test('relocation notes with natural language dates do not invent effective dates (Requirement 2)', async () => {
  // Upstream sensor note describes relocation date in natural language, but provides NO valid_from/valid_to
  const rowWithMoveNote = {
    location_id: 25,
    sensor_description: 'Bridge West',
    sensor_name: 'BriW_T',
    installation_date: '2012-04-10',
    note: 'Sensor relocated to new site on 15/04/2021; upgraded on 20/07/2023',
    status: 'A',
    latitude: -37.8190,
    longitude: 144.9660,
  };

  class NaturalDateClient extends OpenDataSoftClient {
    override async fetchRecords(): Promise<OdsRecords> {
      return {
        records: [rowWithMoveNote],
        totalCount: 1,
        pageCount: 1,
        fetchedAt: '2026-09-29T10:00:00.000Z',
        lastModified: '2026-09-29T04:00:00.000Z',
      };
    }
  }

  const connector = new PedestrianLocationsConnector({ client: new NaturalDateClient() });
  const result = await connector.collect(defaultInput);
  assert.equal(result.kind, 'success');
  if (result.kind !== 'success') return;

  const loc = result.sensorLocations[0]!;
  // valid_from must be installation_date, NOT 2021-04-15 or 2023-07-20 extracted from note!
  assert.equal(loc.valid_from, '2012-04-10T00:00:00.000Z');
  // valid_to must remain null, NOT invented from note!
  assert.equal(loc.valid_to, null);
  assert.equal(loc.device_status, 'A');
});

test('coordinate parsing: extracts coordinates from location object or top-level fields', async () => {
  // Sensor with coordinates only in location object
  const rowOnlyLocationObj = {
    location_id: 101,
    sensor_description: 'Location Obj Sensor',
    status: 'A',
    latitude: null,
    longitude: null,
    location: { lat: -37.8123, lon: 144.9678 },
  };

  // Sensor with coordinates only in top-level fields
  const rowOnlyTopLevel = {
    location_id: 102,
    sensor_description: 'Top Level Sensor',
    status: 'A',
    latitude: -37.8145,
    longitude: 144.9689,
    location: null,
  };

  // Sensor with empty location object and null top-level
  const rowEmptyLocation = {
    location_id: 103,
    sensor_description: 'Empty Location Sensor',
    status: 'R',
    latitude: null,
    longitude: null,
    location: { lat: null, lon: null },
  };

  class CoordinatesClient extends OpenDataSoftClient {
    override async fetchRecords(): Promise<OdsRecords> {
      return {
        records: [rowOnlyLocationObj, rowOnlyTopLevel, rowEmptyLocation],
        totalCount: 3,
        pageCount: 1,
        fetchedAt: '2026-09-29T10:00:00.000Z',
        lastModified: null,
      };
    }
  }

  const connector = new PedestrianLocationsConnector({ client: new CoordinatesClient() });
  const result = await connector.collect(defaultInput);
  assert.equal(result.kind, 'success');
  if (result.kind !== 'success') return;

  const loc101 = result.sensorLocations.find(l => l.sensor_id === '101')!;
  assert.ok(loc101.geometry_geojson);
  assert.deepEqual(JSON.parse(loc101.geometry_geojson), {
    type: 'Point',
    coordinates: [144.9678, -37.8123],
  });

  const loc102 = result.sensorLocations.find(l => l.sensor_id === '102')!;
  assert.ok(loc102.geometry_geojson);
  assert.deepEqual(JSON.parse(loc102.geometry_geojson), {
    type: 'Point',
    coordinates: [144.9689, -37.8145],
  });

  const loc103 = result.sensorLocations.find(l => l.sensor_id === '103')!;
  assert.equal(loc103.geometry_geojson, null);
});

test('coordinate validation: rejects conflicting coordinates between latitude/longitude and location object', async () => {
  const rowConflicting = {
    location_id: 104,
    sensor_description: 'Conflicting Sensor',
    latitude: -37.8100,
    longitude: 144.9600,
    location: { lat: -37.8500, lon: 144.9600 },
  };

  class ConflictingClient extends OpenDataSoftClient {
    override async fetchRecords(): Promise<OdsRecords> {
      return {
        records: [rowConflicting],
        totalCount: 1,
        pageCount: 1,
        fetchedAt: '2026-09-29T10:00:00.000Z',
        lastModified: null,
      };
    }
  }

  const connector = new PedestrianLocationsConnector({ client: new ConflictingClient() });
  const result = await connector.collect(defaultInput);
  assert.equal(result.kind, 'failure');
  if (result.kind === 'failure') {
    assert.equal(result.code, 'validation_failed');
    assert.match(result.message, /conflicting latitude coordinates/i);
  }
});

test('device status: faithfully preserves status variants and maps GeoRecord record_status', async () => {
  const records = [
    { location_id: 1, status: 'A', latitude: -37.81, longitude: 144.96 },
    { location_id: 2, status: 'I', latitude: -37.81, longitude: 144.96 },
    { location_id: 3, status: 'R', latitude: -37.81, longitude: 144.96 },
    { location_id: 4, status: null, latitude: -37.81, longitude: 144.96 },
    { location_id: 5, status: 'Active', latitude: -37.81, longitude: 144.96 },
    { location_id: 6, status: 'Removed', latitude: -37.81, longitude: 144.96 },
  ];

  class StatusClient extends OpenDataSoftClient {
    override async fetchRecords(): Promise<OdsRecords> {
      return {
        records,
        totalCount: 6,
        pageCount: 1,
        fetchedAt: '2026-09-29T10:00:00.000Z',
        lastModified: null,
      };
    }
  }

  const connector = new PedestrianLocationsConnector({ client: new StatusClient() });
  const result = await connector.collect(defaultInput);
  assert.equal(result.kind, 'success');
  if (result.kind !== 'success') return;

  assert.equal(result.sensorLocations.find(l => l.sensor_id === '1')!.device_status, 'A');
  assert.equal(result.geoRecords.find(g => g.geo_record_id === `${SOURCE_ID}:1`)!.record_status, 'active');

  assert.equal(result.sensorLocations.find(l => l.sensor_id === '2')!.device_status, 'I');
  assert.equal(result.geoRecords.find(g => g.geo_record_id === `${SOURCE_ID}:2`)!.record_status, 'active');

  assert.equal(result.sensorLocations.find(l => l.sensor_id === '3')!.device_status, 'R');
  assert.equal(result.geoRecords.find(g => g.geo_record_id === `${SOURCE_ID}:3`)!.record_status, 'resolved');

  assert.equal(result.sensorLocations.find(l => l.sensor_id === '4')!.device_status, null);
  assert.equal(result.geoRecords.find(g => g.geo_record_id === `${SOURCE_ID}:4`)!.record_status, 'active');

  assert.equal(result.sensorLocations.find(l => l.sensor_id === '5')!.device_status, 'Active');
  assert.equal(result.geoRecords.find(g => g.geo_record_id === `${SOURCE_ID}:5`)!.record_status, 'active');

  assert.equal(result.sensorLocations.find(l => l.sensor_id === '6')!.device_status, 'Removed');
  assert.equal(result.geoRecords.find(g => g.geo_record_id === `${SOURCE_ID}:6`)!.record_status, 'resolved');
});

test('date parsing: rejects unparseable valid_from or valid_to strings', async () => {
  const rowBadFrom = {
    location_id: 110,
    valid_from: 'not-a-valid-date',
    latitude: -37.81,
    longitude: 144.96,
  };

  class BadDateClient extends OpenDataSoftClient {
    override async fetchRecords(): Promise<OdsRecords> {
      return {
        records: [rowBadFrom],
        totalCount: 1,
        pageCount: 1,
        fetchedAt: '2026-09-29T10:00:00.000Z',
        lastModified: null,
      };
    }
  }

  const connector = new PedestrianLocationsConnector({ client: new BadDateClient() });
  const result = await connector.collect(defaultInput);
  assert.equal(result.kind, 'failure');
  if (result.kind === 'failure') {
    assert.equal(result.code, 'validation_failed');
    assert.match(result.message, /invalid valid_from timestamp/i);
  }
});

test('handles OdsIncompleteWindow and unparseable lastModified header gracefully', async () => {
  class IncompleteClient extends OpenDataSoftClient {
    override async fetchRecords(): Promise<OdsRecords> {
      throw new OdsIncompleteWindow('pagination broken', 10);
    }
  }

  const connector = new PedestrianLocationsConnector({ client: new IncompleteClient() });
  const result = await connector.collect(defaultInput);
  assert.equal(result.kind, 'failure');
  if (result.kind === 'failure') {
    assert.equal(result.code, 'incomplete_window');
  }

  // Graceful handling of unparseable lastModified header
  class BadHeaderClient extends OpenDataSoftClient {
    override async fetchRecords(): Promise<OdsRecords> {
      return {
        records: [{ location_id: 1, latitude: -37.81, longitude: 144.96, status: 'A' }],
        totalCount: 1,
        pageCount: 1,
        fetchedAt: '2026-09-29T10:00:00.000Z',
        lastModified: 'invalid-http-header-date',
      };
    }
  }

  const connector2 = new PedestrianLocationsConnector({ client: new BadHeaderClient() });
  const result2 = await connector2.collect(defaultInput);
  assert.equal(result2.kind, 'success');
  if (result2.kind === 'success') {
    assert.equal(result2.sourceLatestUpdateAt, null);
    assert.equal(result2.sourceRevision, '2026-09-29T10:00:00.000Z');
  }
});

test('fresh instance without injected history (cold start) where coordinates change: assert installation date is not falsely claimed as valid_from for new coordinates (G08)', async () => {
  // Sensor 3 installed 2009-03-25 at [144.96429485, -37.81101524].
  // Upstream snapshot provides new coordinates [145.0, -37.8] with same installation_date but no valid_from.
  const movedRow = {
    location_id: 3,
    sensor_description: 'Melbourne Central (Relocated site)',
    sensor_name: 'Swa295_T',
    installation_date: '2009-03-25',
    latitude: -37.8000,
    longitude: 145.0000,
    status: 'A',
  };
  const fetchedAt = '2026-09-30T00:00:00.000Z';

  class ColdStartClient extends OpenDataSoftClient {
    override async fetchRecords(): Promise<OdsRecords> {
      return {
        records: [movedRow],
        totalCount: 1,
        pageCount: 1,
        fetchedAt,
        lastModified: '2026-09-30T00:00:00.000Z',
      };
    }
  }

  // Fresh instance without injected history or shared state
  const connector = new PedestrianLocationsConnector({
    client: new ColdStartClient(),
    isolated: true,
  });

  const result = await connector.collect(defaultInput);
  assert.equal(result.kind, 'success');
  if (result.kind !== 'success') return;

  const loc = result.sensorLocations[0]!;
  assert.equal(loc.sensor_id, '3');
  // Cold start must NOT falsely claim original installation date (2009-03-25) as valid_from for newly observed coordinates!
  assert.notEqual(loc.valid_from, '2009-03-25T00:00:00.000Z');
  assert.equal(loc.valid_from, fetchedAt);
  assert.equal(loc.valid_to, null);

  const src = result.sourceRecords[0]!;
  assert.match(src.time_missing_reason ?? '', /Relocation detected on cold start/);
});

test('when migration is detected with historical evidence, result.sensorLocations includes both current and closed records (G08)', async () => {
  const initialRow = {
    location_id: 3,
    sensor_description: 'Melbourne Central',
    sensor_name: 'Swa295_T',
    installation_date: '2009-03-25',
    latitude: -37.81101524,
    longitude: 144.96429485,
    status: 'A',
  };

  class InitialClient extends OpenDataSoftClient {
    override async fetchRecords(): Promise<OdsRecords> {
      return {
        records: [initialRow],
        totalCount: 1,
        pageCount: 1,
        fetchedAt: '2026-01-01T00:00:00.000Z',
        lastModified: '2026-01-01T00:00:00.000Z',
      };
    }
  }

  const connector1 = new PedestrianLocationsConnector({ client: new InitialClient(), isolated: true });
  const result1 = await connector1.collect(defaultInput);
  assert.equal(result1.kind, 'success');
  if (result1.kind !== 'success') return;
  const initialLoc = result1.sensorLocations[0]!;
  assert.equal(initialLoc.valid_from, '2009-03-25T00:00:00.000Z');
  assert.equal(initialLoc.valid_to, null);

  const relocatedRow = {
    ...initialRow,
    latitude: -37.8200,
    longitude: 144.9700,
  };

  class RelocatedClient extends OpenDataSoftClient {
    override async fetchRecords(): Promise<OdsRecords> {
      return {
        records: [relocatedRow],
        totalCount: 1,
        pageCount: 1,
        fetchedAt: '2026-05-01T00:00:00.000Z',
        lastModified: '2026-05-01T00:00:00.000Z',
      };
    }
  }

  const connector2 = new PedestrianLocationsConnector({
    client: new RelocatedClient(),
    previousLocations: result1.sensorLocations,
    isolated: true,
  });

  const result2 = await connector2.collect(defaultInput);
  assert.equal(result2.kind, 'success');
  if (result2.kind !== 'success') return;

  // result.sensorLocations must contain BOTH updated/current record AND the closed historical interval record
  assert.equal(result2.sensorLocations.length, 2);
  const currentLoc = result2.sensorLocations[0]!;
  const closedLoc = result2.sensorLocations[1]!;

  assert.equal(currentLoc.valid_to, null);
  assert.equal(currentLoc.valid_from, '2026-05-01T00:00:00.000Z');
  assert.ok(currentLoc.geometry_geojson?.includes('144.97'));

  assert.equal(closedLoc.valid_to, '2026-01-01T00:00:00.000Z');
  assert.equal(closedLoc.valid_from, '2009-03-25T00:00:00.000Z');
  assert.ok(closedLoc.geometry_geojson?.includes('144.96429485'));

  assert.notEqual(currentLoc.version_id, closedLoc.version_id);
  assert.equal(currentLoc.sensor_id, closedLoc.sensor_id);
});
