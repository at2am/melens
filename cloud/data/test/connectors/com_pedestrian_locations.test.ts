import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  DATASET_ID,
  PedestrianLocationsConnector,
  SOURCE_ID,
  parsePedestrianLocationRow,
} from '../../src/connectors/com_pedestrian_locations/index.js';

import { parseConnectorInput } from '../../src/core/connector.js';
import { HttpClient, HttpFailure } from '../../src/core/http.js';
import { z } from 'zod';
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

test('manifest registers the admitted source: CC BY 4.0 open data and active', async () => {
  const manifestUrl = new URL('../../src/connectors/com_pedestrian_locations/source.json', import.meta.url);
  const manifest = JSON.parse(await readFile(fileURLToPath(manifestUrl), 'utf8'));
  const dataSource = parseSourceManifest(manifest);

  assert.equal(dataSource.source_id, SOURCE_ID);
  assert.equal(dataSource.topic, 'pedestrian');
  assert.equal(dataSource.scope, 'city');
  assert.equal(dataSource.license_status, 'verified_open');
  assert.equal(dataSource.access_status, 'active');
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
  assert.equal(loc3.valid_from, fetchedAt);
  assert.equal(loc3.valid_to, null);
  assert.ok(loc3.geometry_geojson?.includes('144.96429485'));
  assert.ok(loc3.geometry_geojson?.includes('-37.81101524'));

  const geo3 = result.geoRecords.find(g => g.geo_record_id === `${SOURCE_ID}:3`);
  assert.ok(geo3, 'GeoRecord 3 must exist');
  assert.equal(geo3.title, 'Melbourne Central');
  assert.equal(geo3.location_role, 'sensor_site');
  assert.equal(geo3.location_confidence, 'source_coordinate');
  assert.equal(geo3.rights_status, 'verified_open');
  assert.equal(geo3.public_query_allowed, true);
  assert.equal(geo3.record_status, 'active');

  const geo3Validation = validateGeoRecordGeography(geo3);
  assert.equal(geo3Validation.valid, true);

  // Sensor with a handoff note has no documented coordinate start date
  const loc14 = result.sensorLocations.find(l => l.sensor_id === '14');
  assert.ok(loc14, 'Sensor 14 must exist');
  assert.equal(loc14.device_status, 'A');
  assert.equal(loc14.valid_from, fetchedAt);
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
    assert.equal(src.rights_status, 'verified_open');
    assert.equal(src.assertion_kind, 'observation');
    assert.equal(src.source_id, SOURCE_ID);
    assert.ok(src.time_missing_reason, 'Snapshot-only coordinate history must explain the missing official start time');
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

  const connector2 = new PedestrianLocationsConnector({ client: new SecondSnapshotClient(), previousLocations: result1.sensorLocations });
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

  // The original result stays immutable; a distinct closure version supplies history.
  assert.equal(locV1.valid_to, null);
  const closedV1 = result2.sensorLocations.find(location => location.valid_to !== null);
  assert.ok(closedV1);
  assert.equal(closedV1.valid_to, '2026-09-15T00:00:00.000Z');
  assert.notEqual(closedV1.version_id, locV1.version_id);

  const joined = joinPedestrianObservations({
    observations: [obsBefore, obsAfter],
    locations: [closedV1, locV2],
    granularity: 'minute',
  });

  assert.equal(joined[0]?.location?.version_id, closedV1.version_id);
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

  const connector2 = new PedestrianLocationsConnector({ client: new Stage2Client(), previousLocations: result1.sensorLocations });
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

  const connector3 = new PedestrianLocationsConnector({ client: new Stage3Client(), previousLocations: result2.sensorLocations });
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
  // Stage 1 begins at the first observed snapshot
  assert.equal(loc1.valid_from, '2026-01-01T00:00:00.000Z');
  assert.equal(loc1.valid_to, null);
  assert.equal(result2.sensorLocations.find(location => location.valid_to !== null)?.valid_to, '2026-01-01T00:00:00.000Z');

  // Stage 2 (relocation without official date) is valid from Stage 2 snapshot observation time,
  // NOT backdated to 2020-01-15!
  assert.notEqual(loc2.valid_from, '2020-01-15T00:00:00.000Z');
  assert.equal(loc2.valid_from, '2026-05-01T00:00:00.000Z');
  assert.equal(loc2.valid_to, null);
  assert.equal(result3.sensorLocations.find(location => location.valid_to !== null)?.valid_to, '2026-05-01T00:00:00.000Z');

  // Stage 3 (decommissioned/removed) is valid from Stage 3 snapshot observation time
  assert.equal(loc3.valid_from, '2026-09-01T00:00:00.000Z');
  assert.equal(loc3.valid_to, null);
});

test('relocation across versions preserves first observation for initial location and keeps unknown history and transition gap unlocated (G08)', async () => {
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

  // Initial location: current coordinates are only known at the first snapshot
  assert.equal(locV1.valid_from, '2026-01-01T00:00:00.000Z');
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

  // 3. A new immutable closure records the last confirmed snapshot.
  assert.equal(locV1.valid_to, null);
  const closedV1 = result2.sensorLocations.find(location => location.valid_to !== null);
  assert.ok(closedV1);
  assert.equal(closedV1.valid_to, '2026-01-01T00:00:00.000Z');
  assert.notEqual(closedV1.version_id, locV1.version_id);

  // Verify time_missing_reason explains snapshot boundary
  const srcV2 = result2.sourceRecords[0]!;
  assert.match(srcV2.time_missing_reason ?? '', /earliest observed snapshot timestamp, not official relocation time/);

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
  // - Reading before the first snapshot remains unlocated
  // - Gap observation is UNLOCATED (not misattributed to Site 1 or Site 2, and not ambiguous)
  // - After move joins locV2
  const joinedBoth = joinPedestrianObservations({
    observations: [obsHistorical, obsInGap, obsAfterMove],
    locations: [closedV1, locV2],
    granularity: 'minute',
  });

  assert.equal(joinedBoth[0]?.locationStatus, 'unlocated');
  assert.equal(joinedBoth[0]?.location, null);

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
  // valid_from must NOT be invented from natural language dates (2021-04-15 or 2023-07-20)
  // and because it relocated, cold start must NOT backdate to installation date (2012-04-10)
  assert.notEqual(loc.valid_from, '2021-04-15T00:00:00.000Z');
  assert.notEqual(loc.valid_from, '2023-07-20T00:00:00.000Z');
  assert.notEqual(loc.valid_from, '2012-04-10T00:00:00.000Z');
  assert.equal(loc.valid_from, '2026-09-29T10:00:00.000Z');
  // valid_to must remain null, NOT invented from note!
  assert.equal(loc.valid_to, null);
  assert.equal(loc.device_status, 'A');
  assert.match(result.sourceRecords[0]?.time_missing_reason ?? '', /earliest observed snapshot timestamp, not official relocation time/);
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
    assert.match(result2.sourceRevision ?? '', /^observation-snapshot:2026-09-29T10:00:00\.000Z:[a-f0-9]{64}$/);
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
  assert.match(src.time_missing_reason ?? '', /earliest observed snapshot timestamp, not official relocation time/);
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
  assert.equal(initialLoc.valid_from, '2026-01-01T00:00:00.000Z');
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
  assert.equal(closedLoc.valid_from, '2026-01-01T00:00:00.000Z');
  assert.ok(closedLoc.geometry_geojson?.includes('144.96429485'));

  assert.notEqual(currentLoc.version_id, closedLoc.version_id);
  assert.equal(currentLoc.sensor_id, closedLoc.sensor_id);
});

test('migration reproduced using real-shape snapshots of the same sensor (Sensor 47) across historical and current sites (GM-08)', async () => {
  // Snapshot 1: Real-shape row for Sensor 47 at original site (St Francis Church at 266 Elizabeth St)
  const realShapeSnap1 = {
    location_id: 47,
    sensor_description: 'Pushbox - St Francis Church 266 Elizabeth St',
    sensor_name: 'Eli266_T',
    installation_date: '2017-08-24',
    note: null,
    location_type: 'Outdoor',
    status: 'A',
    direction_1: 'North',
    direction_2: 'South',
    latitude: -37.81216,
    longitude: 144.96282,
    location: {
      lon: 144.96282,
      lat: -37.81216,
    },
  };

  class Snap1Client extends OpenDataSoftClient {
    override async fetchRecords(): Promise<OdsRecords> {
      return {
        records: [realShapeSnap1],
        totalCount: 1,
        pageCount: 1,
        fetchedAt: '2022-01-01T00:00:00.000Z',
        lastModified: '2022-01-01T00:00:00.000Z',
      };
    }
  }

  const connector1 = new PedestrianLocationsConnector({ client: new Snap1Client(), isolated: true });
  const result1 = await connector1.collect(defaultInput);
  assert.equal(result1.kind, 'success');
  if (result1.kind !== 'success') return;

  const locV1 = result1.sensorLocations[0]!;
  assert.equal(locV1.sensor_id, '47');
  assert.equal(locV1.valid_from, '2022-01-01T00:00:00.000Z');
  assert.equal(locV1.valid_to, null);
  assert.ok(locV1.geometry_geojson?.includes('144.96282'));

  // Snapshot 2: Real-shape official row for Sensor 47 after move to 250 Elizabeth St (from City of Melbourne API)
  const realShapeSnap2 = {
    location_id: 47,
    sensor_description: 'Pushbox Upgrade, 25/07/2023. Move to 250 Elizabeth Street from adjacent St. Francis Church at 266 Elizabeth.',
    sensor_name: 'Eli250_T',
    installation_date: '2017-08-24',
    note: 'Pushbox Upgrade, 25/07/2023. Move to 250 Elizabeth Street from adjacent St. Francis Church at 266 Elizabeth.',
    location_type: 'Outdoor',
    status: 'A',
    direction_1: 'North',
    direction_2: 'South',
    latitude: -37.81258467,
    longitude: 144.9625775,
    location: {
      lon: 144.9625775,
      lat: -37.81258467,
    },
  };

  class Snap2Client extends OpenDataSoftClient {
    override async fetchRecords(): Promise<OdsRecords> {
      return {
        records: [realShapeSnap2],
        totalCount: 1,
        pageCount: 1,
        fetchedAt: '2024-01-01T00:00:00.000Z',
        lastModified: '2024-01-01T00:00:00.000Z',
      };
    }
  }

  const connector2 = new PedestrianLocationsConnector({
    client: new Snap2Client(),
    previousLocations: result1.sensorLocations,
    isolated: true,
  });

  const result2 = await connector2.collect(defaultInput);
  assert.equal(result2.kind, 'success');
  if (result2.kind !== 'success') return;

  // Both current and closed historical locations are included
  assert.equal(result2.sensorLocations.length, 2);
  const currentLoc = result2.sensorLocations[0]!;
  const closedLoc = result2.sensorLocations[1]!;

  // Current location:
  assert.equal(currentLoc.sensor_id, '47');
  assert.equal(currentLoc.valid_from, '2024-01-01T00:00:00.000Z');
  assert.equal(currentLoc.valid_to, null);
  assert.notEqual(currentLoc.valid_from, '2017-08-24T00:00:00.000Z', 'Must not backdate new coordinates to installation date');
  assert.notEqual(currentLoc.valid_from, '2022-01-01T00:00:00.000Z', 'Must not fabricate effective starting point before observation');
  assert.ok(currentLoc.geometry_geojson?.includes('144.9625775'));

  // Closed historical location:
  assert.equal(closedLoc.sensor_id, '47');
  assert.equal(closedLoc.valid_from, '2022-01-01T00:00:00.000Z');
  assert.equal(closedLoc.valid_to, '2022-01-01T00:00:00.000Z', 'Closed at last observed snapshot timestamp');
  assert.ok(closedLoc.geometry_geojson?.includes('144.96282'));

  // Downstream join testing observations across all three intervals:
  // 1. Reading before the first old-site snapshot remains unknown
  const obsAtOldSite: PedestrianObservation = {
    batch_id: 'b1',
    source_id: 'melbourne.pedestrian.minute',
    schema_version: 1,
    fetched_at: '2020-06-01T12:00:00Z',
    sensor_id: '47',
    observed_at: '2020-06-01T12:00:00Z',
    version_id: 'v1',
    direction_a_count: 15,
    direction_b_count: 25,
    total_count: 40,
    source_record_id: 'obs:47:old',
  };

  // 2. Observed in unknown migration transition gap [2022-01-01, 2024-01-01)
  const obsInGap: PedestrianObservation = {
    ...obsAtOldSite,
    observed_at: '2023-01-01T12:00:00Z',
    source_record_id: 'obs:47:gap',
  };

  // 3. Observed at new site (2024)
  const obsAtNewSite: PedestrianObservation = {
    ...obsAtOldSite,
    observed_at: '2024-06-01T12:00:00Z',
    source_record_id: 'obs:47:new',
  };

  const joined = joinPedestrianObservations({
    observations: [obsAtOldSite, obsInGap, obsAtNewSite],
    locations: [currentLoc, closedLoc],
    granularity: 'minute',
  });

  // No source evidence establishes the 2020 coordinate interval.
  assert.equal(joined[0]?.locationStatus, 'unlocated');
  assert.equal(joined[0]?.location, null);

  // Gap observation is UNLOCATED: no fabrication of effective start or extension of old site
  assert.equal(joined[1]?.locationStatus, 'unlocated', 'Transition gap observation must remain unlocated');
  assert.equal(joined[1]?.location, null);

  // New site observation is located at 250 Elizabeth St
  assert.equal(joined[2]?.locationStatus, 'located');
  assert.equal(joined[2]?.location?.version_id, currentLoc.version_id);
  assert.ok(joined[2]?.location?.geometry_geojson?.includes('144.9625775'));
});

test('cold start ingestion of real-shape moved sensors (Sensors 37 & 47) fixes backdating new coordinates to installation date (GM-08)', async () => {
  // Official real-shape rows from City of Melbourne API
  const sensor37 = {
    location_id: 37,
    sensor_description: 'Lygon St',
    sensor_name: 'Lyg260_T',
    installation_date: '2015-02-11',
    note: 'Pushbox Upgrade, 30/06/2023. Move from 174 to 260 Lygon Street (12/08/2024)',
    location_type: 'Outdoor',
    status: 'A',
    direction_1: 'North',
    direction_2: 'South',
    latitude: -37.80107122,
    longitude: 144.96704554,
    location: {
      lon: 144.96704554,
      lat: -37.80107122,
    },
  };

  const sensor47 = {
    location_id: 47,
    sensor_description: 'Pushbox Upgrade, 25/07/2023. Move to 250 Elizabeth Street from adjacent St. Francis Church at 266 Elizabeth.',
    sensor_name: 'Eli250_T',
    installation_date: '2017-08-24',
    note: 'Pushbox Upgrade, 25/07/2023. Move to 250 Elizabeth Street from adjacent St. Francis Church at 266 Elizabeth.',
    location_type: 'Outdoor',
    status: 'A',
    direction_1: 'North',
    direction_2: 'South',
    latitude: -37.81258467,
    longitude: 144.9625775,
    location: {
      lon: 144.9625775,
      lat: -37.81258467,
    },
  };

  const fetchedAt = '2026-09-30T10:00:00.000Z';

  class RealShapeColdStartClient extends OpenDataSoftClient {
    override async fetchRecords(): Promise<OdsRecords> {
      return {
        records: [sensor37, sensor47],
        totalCount: 2,
        pageCount: 1,
        fetchedAt,
        lastModified: '2026-09-30T00:00:00.000Z',
      };
    }
  }

  // Fresh instance without injected history or shared state (Cold Start)
  const connector = new PedestrianLocationsConnector({
    client: new RealShapeColdStartClient(),
    isolated: true,
  });

  const result = await connector.collect(defaultInput);
  assert.equal(result.kind, 'success');
  if (result.kind !== 'success') return;

  const loc37 = result.sensorLocations.find(l => l.sensor_id === '37')!;
  const loc47 = result.sensorLocations.find(l => l.sensor_id === '47')!;

  // Sensor 37:
  // Must NOT backdate 260 Lygon St coordinates to original install date (2015-02-11)
  assert.notEqual(loc37.valid_from, '2015-02-11T00:00:00.000Z', 'Cold start must not backdate sensor 37 to 2015');
  assert.equal(loc37.valid_from, fetchedAt);
  assert.equal(loc37.valid_to, null);
  assert.ok(loc37.geometry_geojson?.includes('144.96704554'));

  const src37 = result.sourceRecords.find(s => s.source_record_id.endsWith(':37'))!;
  assert.match(src37.time_missing_reason ?? '', /earliest observed snapshot timestamp, not official relocation time/);

  // Sensor 47:
  // Must NOT backdate 250 Elizabeth St coordinates to original install date (2017-08-24)
  assert.notEqual(loc47.valid_from, '2017-08-24T00:00:00.000Z', 'Cold start must not backdate sensor 47 to 2017');
  assert.equal(loc47.valid_from, fetchedAt);
  assert.equal(loc47.valid_to, null);
  assert.ok(loc47.geometry_geojson?.includes('144.9625775'));

  const src47 = result.sourceRecords.find(s => s.source_record_id.endsWith(':47'))!;
  assert.match(src47.time_missing_reason ?? '', /earliest observed snapshot timestamp, not official relocation time/);

  // Downstream join testing: historical observations before cold start snapshot remain unlocated
  const histObs37: PedestrianObservation = {
    batch_id: 'b-hist',
    source_id: 'melbourne.pedestrian.minute',
    schema_version: 1,
    fetched_at: '2020-01-01T00:00:00Z',
    sensor_id: '37',
    observed_at: '2020-01-01T00:00:00Z',
    version_id: 'v-obs-hist',
    direction_a_count: 5,
    direction_b_count: 10,
    total_count: 15,
    source_record_id: 'obs:37:hist',
  };

  const currObs37: PedestrianObservation = {
    ...histObs37,
    observed_at: '2026-10-01T00:00:00Z',
    source_record_id: 'obs:37:curr',
  };

  const joined = joinPedestrianObservations({
    observations: [histObs37, currObs37],
    locations: [loc37],
    granularity: 'minute',
  });

  // Historical reading cannot be placed at 260 Lygon St without historical location record
  assert.equal(joined[0]?.locationStatus, 'unlocated');
  assert.equal(joined[0]?.location, null);

  // Current reading is located at 260 Lygon St
  assert.equal(joined[1]?.locationStatus, 'located');
  assert.ok(joined[1]?.location?.geometry_geojson?.includes('144.96704554'));
});

test('cold start scenario 1: unlisted sensor 999 with relocation note uses fetchedAt and does not backdate (GM-08 R03)', async () => {
  const row999 = {
    location_id: 999,
    sensor_description: '368 Elizabeth Street',
    sensor_name: 'Eli368_T',
    installation_date: '2016-03-01',
    note: 'Relocated to 368 Elizabeth Street',
    location_type: 'Outdoor',
    status: 'A',
    latitude: -37.8095,
    longitude: 144.9615,
  };
  const fetchedAt = '2026-09-30T10:00:00.000Z';

  class UnlistedRelocatedClient extends OpenDataSoftClient {
    override async fetchRecords(): Promise<OdsRecords> {
      return {
        records: [row999],
        totalCount: 1,
        pageCount: 1,
        fetchedAt,
        lastModified: '2026-09-30T00:00:00.000Z',
      };
    }
  }

  const connector = new PedestrianLocationsConnector({
    client: new UnlistedRelocatedClient(),
    isolated: true,
  });

  const result = await connector.collect(defaultInput);
  assert.equal(result.kind, 'success');
  if (result.kind !== 'success') return;

  const loc = result.sensorLocations[0]!;
  assert.equal(loc.sensor_id, '999');
  assert.notEqual(loc.valid_from, '2016-03-01T00:00:00.000Z', 'Must not backdate unlisted relocated sensor to installation date');
  assert.equal(loc.valid_from, fetchedAt);
  assert.equal(loc.valid_to, null);

  const src = result.sourceRecords[0]!;
  assert.match(src.time_missing_reason ?? '', /earliest observed snapshot timestamp, not official relocation time/);

  // Joining historical observations prior to fetchedAt must leave them unlocated
  const histObs: PedestrianObservation = {
    batch_id: 'b-hist',
    source_id: 'melbourne.pedestrian.minute',
    schema_version: 1,
    fetched_at: '2018-01-01T00:00:00Z',
    sensor_id: '999',
    observed_at: '2018-01-01T00:00:00Z',
    version_id: 'v-obs-hist',
    direction_a_count: 10,
    direction_b_count: 15,
    total_count: 25,
    source_record_id: 'obs:999:hist',
  };

  const joined = joinPedestrianObservations({
    observations: [histObs],
    locations: [loc],
    granularity: 'minute',
  });
  assert.equal(joined[0]?.locationStatus, 'unlocated');
  assert.equal(joined[0]?.location, null);
});

test('cold start scenario 2: unlisted sensor 888 without note uses fetchedAt preserving history as unlocated (GM-08 R03)', async () => {
  const row888 = {
    location_id: 888,
    sensor_description: 'Fresh Uncataloged Sensor',
    sensor_name: 'Uncat888_T',
    installation_date: '2015-05-15',
    note: null,
    location_type: 'Outdoor',
    status: 'A',
    latitude: -37.8105,
    longitude: 144.9625,
  };
  const fetchedAt = '2026-09-30T10:00:00.000Z';

  class UnlistedNoNoteClient extends OpenDataSoftClient {
    override async fetchRecords(): Promise<OdsRecords> {
      return {
        records: [row888],
        totalCount: 1,
        pageCount: 1,
        fetchedAt,
        lastModified: '2026-09-30T00:00:00.000Z',
      };
    }
  }

  const connector = new PedestrianLocationsConnector({
    client: new UnlistedNoNoteClient(),
    isolated: true,
  });

  const result = await connector.collect(defaultInput);
  assert.equal(result.kind, 'success');
  if (result.kind !== 'success') return;

  const loc = result.sensorLocations[0]!;
  assert.equal(loc.sensor_id, '888');
  // Without verified baseline snapshot evidence, must NOT blindly fallback to installation_date
  assert.notEqual(loc.valid_from, '2015-05-15T00:00:00.000Z', 'Must not backdate unlisted sensor without baseline evidence');
  assert.equal(loc.valid_from, fetchedAt);
  assert.equal(loc.valid_to, null);

  // Historical reading before fetchedAt remains unlocated
  const histObs: PedestrianObservation = {
    batch_id: 'b-hist',
    source_id: 'melbourne.pedestrian.minute',
    schema_version: 1,
    fetched_at: '2017-06-01T00:00:00Z',
    sensor_id: '888',
    observed_at: '2017-06-01T00:00:00Z',
    version_id: 'v-obs-hist',
    direction_a_count: 8,
    direction_b_count: 12,
    total_count: 20,
    source_record_id: 'obs:888:hist',
  };

  const currObs: PedestrianObservation = {
    ...histObs,
    observed_at: '2026-10-01T00:00:00Z',
    source_record_id: 'obs:888:curr',
  };

  const joined = joinPedestrianObservations({
    observations: [histObs, currObs],
    locations: [loc],
    granularity: 'minute',
  });
  assert.equal(joined[0]?.locationStatus, 'unlocated', 'Historical observation prior to fetchedAt must remain unlocated');
  assert.equal(joined[0]?.location, null);
  assert.equal(joined[1]?.locationStatus, 'located');
});

test('cold start scenario 3: sensor 777 with general relocation phrasing triggers relocation protection (GM-08 R03)', async () => {
  const row777 = {
    location_id: 777,
    sensor_description: 'Flinders / Swanston',
    sensor_name: 'FliSwa_T',
    installation_date: '2014-11-20',
    note: 'Relocated to corner of Flinders and Swanston Street',
    location_type: 'Outdoor',
    status: 'A',
    latitude: -37.8175,
    longitude: 144.9675,
  };
  const fetchedAt = '2026-09-30T10:00:00.000Z';

  class GeneralPhrasingClient extends OpenDataSoftClient {
    override async fetchRecords(): Promise<OdsRecords> {
      return {
        records: [row777],
        totalCount: 1,
        pageCount: 1,
        fetchedAt,
        lastModified: '2026-09-30T00:00:00.000Z',
      };
    }
  }

  const connector = new PedestrianLocationsConnector({
    client: new GeneralPhrasingClient(),
    isolated: true,
  });

  const result = await connector.collect(defaultInput);
  assert.equal(result.kind, 'success');
  if (result.kind !== 'success') return;

  const loc = result.sensorLocations[0]!;
  assert.equal(loc.sensor_id, '777');
  assert.notEqual(loc.valid_from, '2014-11-20T00:00:00.000Z');
  assert.equal(loc.valid_from, fetchedAt);
  assert.equal(loc.valid_to, null);

  const src = result.sourceRecords[0]!;
  assert.match(src.time_missing_reason ?? '', /earliest observed snapshot timestamp, not official relocation time/);
});

test('cold start scenario 4: sensor 52 returning to original installation coordinates does not backdate (GM-08 R03)', async () => {
  // Sensor 52 original installation coordinates: [144.9652, -37.8134]
  // Snapshot has matching coordinates, but note indicates it moved away and returned
  const row52Returned = {
    location_id: 52,
    sensor_description: 'Bourke Street Mall',
    sensor_name: 'Bou292_T',
    installation_date: '2013-09-02',
    note: 'Sensor relocated to temporary site in 2020 and returned to original site in 2024',
    location_type: 'Outdoor',
    status: 'A',
    latitude: -37.8134,
    longitude: 144.9652,
  };
  const fetchedAt = '2026-09-30T10:00:00.000Z';

  class ReturnedClient extends OpenDataSoftClient {
    override async fetchRecords(): Promise<OdsRecords> {
      return {
        records: [row52Returned],
        totalCount: 1,
        pageCount: 1,
        fetchedAt,
        lastModified: '2026-09-30T00:00:00.000Z',
      };
    }
  }

  const connector = new PedestrianLocationsConnector({
    client: new ReturnedClient(),
    isolated: true,
  });

  const result = await connector.collect(defaultInput);
  assert.equal(result.kind, 'success');
  if (result.kind !== 'success') return;

  const loc = result.sensorLocations[0]!;
  assert.equal(loc.sensor_id, '52');
  // Matching original coordinates cannot prove continuous presence throughout history!
  // Must NOT backdate to installation date (2013-09-02)
  assert.notEqual(loc.valid_from, '2013-09-02T00:00:00.000Z', 'Must not backdate returning sensor to original install date');
  assert.equal(loc.valid_from, fetchedAt);
  assert.equal(loc.valid_to, null);

  const src = result.sourceRecords[0]!;
  assert.match(src.time_missing_reason ?? '', /earliest observed snapshot timestamp, not official relocation time/);

  // Observation from intermediate period (e.g. 2021) cannot be placed at original site
  const intermObs: PedestrianObservation = {
    batch_id: 'b-interm',
    source_id: 'melbourne.pedestrian.minute',
    schema_version: 1,
    fetched_at: '2021-06-01T00:00:00Z',
    sensor_id: '52',
    observed_at: '2021-06-01T00:00:00Z',
    version_id: 'v-obs-interm',
    direction_a_count: 50,
    direction_b_count: 60,
    total_count: 110,
    source_record_id: 'obs:52:interm',
  };

  const joined = joinPedestrianObservations({
    observations: [intermObs],
    locations: [loc],
    granularity: 'minute',
  });
  assert.equal(joined[0]?.locationStatus, 'unlocated', 'Intermediate observation while relocated must remain unlocated');
});

test('bounded read-only verification of official City of Melbourne pedestrian sensor locations endpoint (GM-08)', async t => {
  const officialUrl = 'https://data.melbourne.vic.gov.au/api/explore/v2.1/catalog/datasets/pedestrian-counting-system-sensor-locations/records?limit=5';
  let body: unknown;
  try {
    body = (await new HttpClient().getJson({ url: officialUrl, timeoutMs: 10_000, maxAttempts: 1 })).body;
  } catch (error) {
    if (!(error instanceof HttpFailure) || error.code !== 'upstream_unavailable') throw error;
    t.skip(`Official sensor endpoint unavailable: ${error.message}`);
    return;
  }
  const data = z.object({
    total_count: z.number().int().nonnegative(),
    results: z.array(z.record(z.string(), z.unknown())),
  }).parse(body);
  assert.ok(data.total_count >= 100, `Expected at least 100 pedestrian sensors, got ${data.total_count}`);
  assert.equal(data.results.length, 5);
  const first = data.results[0];
  assert.ok(first);
  for (const field of ['location_id', 'latitude', 'longitude', 'location', 'status']) {
    assert.ok(field in first);
  }
});

test('default collection does not backdate coordinates when a known baseline happens to match', async t => {
  const rows = [
    { location_id: 3, installation_date: '2009-03-25', latitude: -37.81101524, longitude: 144.96429485, status: 'A' },
    { location_id: 999, installation_date: '2015-02-11', latitude: -37.81, longitude: 144.96, status: 'A' },
  ];
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    requests += 1;
    return new Response(JSON.stringify({ total_count: rows.length, results: rows }), {
      headers: { 'content-type': 'application/json' },
    });
  });
  // Use the default HTTP client and default history options used by registry loading.
  const result = await new PedestrianLocationsConnector().collect(defaultInput);
  assert.equal(result.kind, 'success');
  if (result.kind !== 'success') return;
  assert.equal(requests, 1);
  for (const location of result.sensorLocations) {
    assert.equal(location.valid_from, result.fetchedAt);
    assert.match(result.sourceRecords.find(record => record.source_record_id === location.source_record_id)?.time_missing_reason ?? '', /earliest observed snapshot timestamp/);
    const observation: PedestrianObservation = {
      batch_id: 'historical-reading', source_id: 'melbourne.pedestrian.minute', schema_version: 1,
      fetched_at: '2020-01-01T00:00:00Z', sensor_id: location.sensor_id,
      observed_at: '2020-01-01T00:00:00Z', version_id: 'reading-version',
      direction_a_count: 1, direction_b_count: 1, total_count: 2, source_record_id: 'historical-record',
    };
    assert.equal(joinPedestrianObservations({ observations: [observation], locations: [location], granularity: 'minute' })[0]?.locationStatus, 'unlocated');
  }
});
