import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  ALLOWED_FIELDS,
  DATASET_ID,
  DEFAULT_PORTAL_URL,
  MICROCLIMATE_METRICS,
  MicroclimateConnector,
  SOURCE_ID,
  collectMicroclimate,
  connector,
  fetchMicroclimateDataProcessed,
  filterRetainableRawRecord,
  toMetric,
  type ComMicroclimateRawRecord,
} from '../../src/connectors/com_microclimate/index.js';
import { parseConnectorInput } from '../../src/core/connector.js';
import { HttpClient, HttpFailure, type HttpRequest, type HttpResponse } from '../../src/core/http.js';
import { OdsIncompleteWindow, OpenDataSoftClient, type OdsQuery, type OdsRecords } from '../../src/core/opendatasoft.js';
import { loadConnector, loadSourceRegistry, parseSourceManifest } from '../../src/core/registry.js';
import { validateGeoRecordGeography } from '../../src/validation/geography.js';
import { parseSourceRecord } from '../../src/validation/record.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(__dirname, '../fixtures/com_microclimate.json');
const manifestPath = join(__dirname, '../../src/connectors/com_microclimate/source.json');

async function loadFixture(): Promise<{ total_count: number; results: ComMicroclimateRawRecord[] }> {
  const content = await readFile(fixturePath, 'utf8');
  return JSON.parse(content);
}

test('Source manifest parses successfully, conforms to registry, and stays review_required and candidate', async () => {
  const manifestRaw = JSON.parse(await readFile(manifestPath, 'utf8'));
  const dataSource = parseSourceManifest(manifestRaw);

  assert.equal(dataSource.source_id, SOURCE_ID);
  assert.equal(dataSource.provider, 'City of Melbourne');
  assert.equal(dataSource.dataset_title, 'Microclimate sensors data');
  assert.equal(dataSource.topic, 'other');
  assert.equal(dataSource.scope, 'city');
  assert.equal(dataSource.cadence_seconds, 900);
  assert.equal(dataSource.check_interval_seconds, 900);
  assert.equal(dataSource.license_status, 'review_required', 'Must remain review_required pending verified upstream terms');
  assert.equal(dataSource.access_status, 'candidate', 'Must remain candidate pending live access verification');
  assert.equal(dataSource.record_granularity, 'sensor_observation');
  assert.equal(dataSource.landing_url, 'https://data.melbourne.vic.gov.au/explore/dataset/microclimate-sensors-data/');

  // Discover via SourceRegistry
  const connectorsRoot = join(__dirname, '../../src/connectors');
  const registry = await loadSourceRegistry(connectorsRoot);
  const entry = registry.get(SOURCE_ID);
  assert.ok(entry, `${SOURCE_ID} must be discovered in connectors directory`);
  assert.equal(entry.dataSource.source_id, SOURCE_ID);

  // Candidate review_required source must not be in active()
  assert.equal(
    registry.active().some(s => s.dataSource.source_id === SOURCE_ID),
    false,
    'Candidate review_required source must not be in active()',
  );

  // Dynamic connector loading
  const loadedConnector = await loadConnector(entry);
  assert.equal(loadedConnector.sourceId, SOURCE_ID);
  assert.equal(connector.sourceId, SOURCE_ID);
});

test('com_microclimate parses fixture, collects 5 observations, and produces valid core records', async () => {
  const fixture = await loadFixture();
  const fetchedAt = '2026-09-29T12:00:00Z';
  const lastModified = '2026-04-28T16:00:00Z';

  class MockClient extends OpenDataSoftClient {
    override async fetchRecords(query: OdsQuery): Promise<OdsRecords> {
      assert.equal(query.datasetId, DATASET_ID);
      assert.equal(query.orderBy, 'received_at ASC, device_id ASC');
      return {
        records: fixture.results,
        totalCount: fixture.total_count,
        pageCount: 1,
        fetchedAt,
        lastModified,
      };
    }
  }

  const testConnector = new MicroclimateConnector(new MockClient());
  const input = parseConnectorInput({
    sourceId: SOURCE_ID,
    window: { kind: 'snapshot', revision: '2026-04-28' },
    checkpoint: null,
    runId: 'test_microclimate_run_01',
  });

  const result = await testConnector.collect(input);
  assert.equal(result.kind, 'success');
  if (result.kind !== 'success') return;

  assert.equal(result.inputCount, 5);
  assert.equal(result.outputCount, 5);
  assert.equal(result.rejectedCount, 0);
  assert.equal(result.sourceRecords.length, 5);
  assert.equal(result.geoRecords.length, 5);
  assert.equal(result.geoRecordSources.length, 5);
  assert.equal(result.sensorLocations.length, 5);
  // 5 records * 13 microclimate metrics = 65 area indicators
  assert.equal(result.areaIndicators.length, 5 * MICROCLIMATE_METRICS.length);
  assert.equal('microclimateObservations' in result, false, 'Extraneous non-standard field microclimateObservations must be removed');
  assert.equal(result.retainableRawRecords?.length, 5);
  assert.equal(result.sourceRevision, '2026-04-28T15:25:15.000Z');
  assert.equal(result.sourceLatestUpdateAt, '2026-04-28T16:00:00.000Z');
  assert.equal(result.checkpointAfter, '2026-04-28');

  // Verify completeness
  assert.equal(result.completeness.complete, true);
  assert.equal(result.completeness.method, 'pagination');
  assert.equal(result.completeness.expected_records, 5);
  assert.equal(result.completeness.fetched_records, 5);
  assert.equal(result.completeness.expected_pages, 1);
  assert.equal(result.completeness.fetched_pages, 1);

  // Validate all SourceRecords against schema
  for (const record of result.sourceRecords) {
    const validated = parseSourceRecord(record);
    assert.equal(validated.source_id, SOURCE_ID);
    assert.equal(validated.rights_status, 'review_required');
    assert.equal(validated.assertion_kind, 'observation');
    assert.equal(validated.record_status, 'active');
    assert.ok(validated.observed_at);
  }

  // Validate all GeoRecords against geography validation rules
  for (const geo of result.geoRecords) {
    const geoValidation = validateGeoRecordGeography(geo);
    assert.equal(geoValidation.valid, true, `GeoRecord failed geography validation: ${geoValidation.issues.join(', ')}`);
    assert.equal(geo.rights_status, 'review_required');
    assert.equal(geo.assertion_kind, 'observation');
    assert.equal(geo.public_query_allowed, false);
  }

  // Validate all AreaIndicators against invariants
  for (const ind of result.areaIndicators) {
    assert.equal(ind.assertion_kind, 'observation');
    assert.ok(ind.indicator_id.startsWith(SOURCE_ID));
    assert.ok(ind.boundary_id.startsWith('sensor_site:'));
    assert.ok(ind.period_start);
    assert.equal(ind.period_start, ind.period_end);
    assert.ok(ind.unit);
    if (ind.status === 'observed') {
      assert.ok(typeof ind.value === 'number' && Number.isFinite(ind.value));
    } else {
      assert.equal(ind.value, null);
    }
  }
});

test('Preserves observed time, explicit scientific units, and real 0.0 values without zero-filling nulls', async () => {
  const fixture = await loadFixture();

  class MockClient extends OpenDataSoftClient {
    override async fetchRecords(): Promise<OdsRecords> {
      return {
        records: fixture.results,
        totalCount: fixture.total_count,
        pageCount: 1,
        fetchedAt: '2026-09-29T12:00:00Z',
        lastModified: null,
      };
    }
  }

  const testConnector = new MicroclimateConnector(new MockClient());
  const input = parseConnectorInput({
    sourceId: SOURCE_ID,
    window: { kind: 'time', from: '2026-04-28T00:00:00Z', to: '2026-04-29T00:00:00Z' },
    checkpoint: null,
    runId: 'test_units_and_nulls',
  });

  const result = await testConnector.collect(input);
  assert.equal(result.kind, 'success');
  if (result.kind !== 'success') return;

  const indicators = result.areaIndicators;
  const getMetric = (deviceId: string, metricId: string) => {
    const ind = indicators.find(i => i.source_area_code === deviceId && i.indicator_id === `${SOURCE_ID}:${deviceId}:${metricId}`);
    assert.ok(ind, `Indicator ${metricId} for device ${deviceId} must be present`);
    return ind;
  };

  // 1. Record 1: ICTMicroclimate-08 (all fields present, includes real 0.0)
  const r1Temp = getMetric('ICTMicroclimate-08', 'air_temperature');
  assert.equal(r1Temp.period_start, '2026-04-28T15:25:15.000Z');
  assert.equal(r1Temp.status, 'observed');
  assert.equal(r1Temp.value, 16.7);
  assert.equal(r1Temp.unit, 'celsius');
  assert.equal(r1Temp.source_area_code, 'ICTMicroclimate-08');
  assert.equal(r1Temp.source_area_name, 'Swanston St - Tram Stop 13 adjacent Federation Sq & Flinders St Station');
  assert.equal(r1Temp.boundary_id, 'sensor_site:ICTMicroclimate-08');

  const r1Hum = getMetric('ICTMicroclimate-08', 'relative_humidity');
  assert.equal(r1Hum.status, 'observed');
  assert.equal(r1Hum.value, 79.9);
  assert.equal(r1Hum.unit, 'percent');

  const r1Press = getMetric('ICTMicroclimate-08', 'atmospheric_pressure');
  assert.equal(r1Press.status, 'observed');
  assert.equal(r1Press.value, 1026.1);
  assert.equal(r1Press.unit, 'hPa');

  // Ensure real 0.0 wind speed and direction are preserved as observed, NOT missing
  const r1WindMin = getMetric('ICTMicroclimate-08', 'wind_speed_minimum');
  assert.equal(r1WindMin.status, 'observed');
  assert.equal(r1WindMin.value, 0.0);
  assert.equal(r1WindMin.unit, 'm_s');

  const r1WindAvg = getMetric('ICTMicroclimate-08', 'wind_speed_average');
  assert.equal(r1WindAvg.status, 'observed');
  assert.equal(r1WindAvg.value, 0.5);
  assert.equal(r1WindAvg.unit, 'm_s');

  const r1Wind = getMetric('ICTMicroclimate-08', 'wind_speed');
  assert.equal(r1Wind.status, 'observed');
  assert.equal(r1Wind.value, 0.5);
  assert.equal(r1Wind.unit, 'm_s');

  const r1WindGust = getMetric('ICTMicroclimate-08', 'wind_speed_gust');
  assert.equal(r1WindGust.status, 'observed');
  assert.equal(r1WindGust.value, 2.5);
  assert.equal(r1WindGust.unit, 'm_s');

  const r1DirMin = getMetric('ICTMicroclimate-08', 'wind_direction_minimum');
  assert.equal(r1DirMin.status, 'observed');
  assert.equal(r1DirMin.value, 0.0);
  assert.equal(r1DirMin.unit, 'degrees');

  const r1DirAvg = getMetric('ICTMicroclimate-08', 'wind_direction_average');
  assert.equal(r1DirAvg.status, 'observed');
  assert.equal(r1DirAvg.value, 220.0);
  assert.equal(r1DirAvg.unit, 'degrees');

  const r1DirMax = getMetric('ICTMicroclimate-08', 'wind_direction_maximum');
  assert.equal(r1DirMax.status, 'observed');
  assert.equal(r1DirMax.value, 314.0);
  assert.equal(r1DirMax.unit, 'degrees');

  const r1Pm25 = getMetric('ICTMicroclimate-08', 'pm25');
  assert.equal(r1Pm25.status, 'observed');
  assert.equal(r1Pm25.value, 10.0);
  assert.equal(r1Pm25.unit, 'ug_m3');

  const r1Pm10 = getMetric('ICTMicroclimate-08', 'pm10');
  assert.equal(r1Pm10.status, 'observed');
  assert.equal(r1Pm10.value, 12.0);
  assert.equal(r1Pm10.unit, 'ug_m3');

  const r1Noise = getMetric('ICTMicroclimate-08', 'noise');
  assert.equal(r1Noise.status, 'observed');
  assert.equal(r1Noise.value, 58.7);
  assert.equal(r1Noise.unit, 'decibels');

  // 2. Record 3: ICTMicroclimate-05 (sensor outage: all measurement readings are null)
  const r3Temp = getMetric('ICTMicroclimate-05', 'air_temperature');
  assert.equal(r3Temp.period_start, '2026-04-28T15:20:00.000Z');
  // Critical invariant: null readings must strictly remain null with status 'missing', NEVER zero-filled!
  assert.equal(r3Temp.status, 'missing');
  assert.equal(r3Temp.value, null);
  assert.notEqual(r3Temp.value, 0, 'Null temperature must not be zero-filled');
  assert.equal(r3Temp.unit, 'celsius');

  const r3Hum = getMetric('ICTMicroclimate-05', 'relative_humidity');
  assert.equal(r3Hum.status, 'missing');
  assert.equal(r3Hum.value, null);
  assert.equal(r3Hum.unit, 'percent');

  const r3Press = getMetric('ICTMicroclimate-05', 'atmospheric_pressure');
  assert.equal(r3Press.status, 'missing');
  assert.equal(r3Press.value, null);
  assert.equal(r3Press.unit, 'hPa');

  const r3WindMin = getMetric('ICTMicroclimate-05', 'wind_speed_minimum');
  assert.equal(r3WindMin.status, 'missing');
  assert.equal(r3WindMin.value, null);
  assert.equal(r3WindMin.unit, 'm_s');

  const r3Wind = getMetric('ICTMicroclimate-05', 'wind_speed');
  assert.equal(r3Wind.status, 'missing');
  assert.equal(r3Wind.value, null);
  assert.equal(r3Wind.unit, 'm_s');

  const r3WindGust = getMetric('ICTMicroclimate-05', 'wind_speed_gust');
  assert.equal(r3WindGust.status, 'missing');
  assert.equal(r3WindGust.value, null);
  assert.equal(r3WindGust.unit, 'm_s');

  const r3DirMin = getMetric('ICTMicroclimate-05', 'wind_direction_minimum');
  assert.equal(r3DirMin.status, 'missing');
  assert.equal(r3DirMin.value, null);
  assert.equal(r3DirMin.unit, 'degrees');

  const r3DirAvg = getMetric('ICTMicroclimate-05', 'wind_direction_average');
  assert.equal(r3DirAvg.status, 'missing');
  assert.equal(r3DirAvg.value, null);
  assert.equal(r3DirAvg.unit, 'degrees');

  const r3DirMax = getMetric('ICTMicroclimate-05', 'wind_direction_maximum');
  assert.equal(r3DirMax.status, 'missing');
  assert.equal(r3DirMax.value, null);
  assert.equal(r3DirMax.unit, 'degrees');

  const r3Pm25 = getMetric('ICTMicroclimate-05', 'pm25');
  assert.equal(r3Pm25.status, 'missing');
  assert.equal(r3Pm25.value, null);
  assert.equal(r3Pm25.unit, 'ug_m3');

  const r3Pm10 = getMetric('ICTMicroclimate-05', 'pm10');
  assert.equal(r3Pm10.status, 'missing');
  assert.equal(r3Pm10.value, null);
  assert.equal(r3Pm10.unit, 'ug_m3');

  const r3Noise = getMetric('ICTMicroclimate-05', 'noise');
  assert.equal(r3Noise.status, 'missing');
  assert.equal(r3Noise.value, null);
  assert.equal(r3Noise.unit, 'decibels');

  // 3. Record 4: ICTMicroclimate-10 (partial outage: temperature, humidity, noise observed; wind and pm missing)
  const r4Temp = getMetric('ICTMicroclimate-10', 'air_temperature');
  assert.equal(r4Temp.status, 'observed');
  assert.equal(r4Temp.value, 18.5);
  assert.equal(r4Temp.unit, 'celsius');

  const r4Hum = getMetric('ICTMicroclimate-10', 'relative_humidity');
  assert.equal(r4Hum.status, 'observed');
  assert.equal(r4Hum.value, 74.6);
  assert.equal(r4Hum.unit, 'percent');

  const r4Press = getMetric('ICTMicroclimate-10', 'atmospheric_pressure');
  assert.equal(r4Press.status, 'observed');
  assert.equal(r4Press.value, 1019.3);
  assert.equal(r4Press.unit, 'hPa');

  const r4Noise = getMetric('ICTMicroclimate-10', 'noise');
  assert.equal(r4Noise.status, 'observed');
  assert.equal(r4Noise.value, 62.6);
  assert.equal(r4Noise.unit, 'decibels');

  const r4WindMin = getMetric('ICTMicroclimate-10', 'wind_speed_minimum');
  assert.equal(r4WindMin.status, 'missing');
  assert.equal(r4WindMin.value, null);

  const r4Pm25 = getMetric('ICTMicroclimate-10', 'pm25');
  assert.equal(r4Pm25.status, 'missing');
  assert.equal(r4Pm25.value, null);

  const r4Pm10 = getMetric('ICTMicroclimate-10', 'pm10');
  assert.equal(r4Pm10.status, 'missing');
  assert.equal(r4Pm10.value, null);
});

test('toMetric correctly preserves 0 as observed, null/undefined/NaN as missing', () => {
  assert.deepEqual(toMetric(0, 'm_s'), { value: 0, unit: 'm_s', status: 'observed' });
  assert.deepEqual(toMetric(0.0, 'degrees'), { value: 0, unit: 'degrees', status: 'observed' });
  assert.deepEqual(toMetric(-5.2, 'celsius'), { value: -5.2, unit: 'celsius', status: 'observed' });
  assert.deepEqual(toMetric(null, 'celsius'), { value: null, unit: 'celsius', status: 'missing' });
  assert.deepEqual(toMetric(undefined, 'percent'), { value: null, unit: 'percent', status: 'missing' });
  assert.deepEqual(toMetric(Number.NaN, 'hPa'), { value: null, unit: 'hPa', status: 'missing' });
  assert.deepEqual(toMetric(Number.POSITIVE_INFINITY, 'hPa'), { value: null, unit: 'hPa', status: 'missing' });
});

test('Preserves current equipment evidence and rejects historical location table as active inventory', async () => {
  const fixture = await loadFixture();

  class MockClient extends OpenDataSoftClient {
    override async fetchRecords(): Promise<OdsRecords> {
      return {
        records: fixture.results,
        totalCount: fixture.total_count,
        pageCount: 1,
        fetchedAt: '2026-09-29T12:00:00Z',
        lastModified: null,
      };
    }
  }

  const testConnector = new MicroclimateConnector(new MockClient());
  const input = parseConnectorInput({
    sourceId: SOURCE_ID,
    window: { kind: 'snapshot', revision: 'current' },
    checkpoint: null,
    runId: 'test_equipment_evidence',
  });

  const result = await testConnector.collect(input);
  assert.equal(result.kind, 'success');
  if (result.kind !== 'success') return;

  // Invariant check: evidence for current equipment is derived strictly from active telemetry stream
  for (const loc of result.sensorLocations) {
    assert.equal(loc.device_status, null);
    assert.ok(loc.valid_from);
    assert.equal(loc.valid_to, loc.valid_from);
  }

  for (const source of result.geoRecordSources) {
    assert.equal(source.evidence_role, 'official_sensor_telemetry');
  }

  // Record 1 has valid coordinates
  const r1Geo = result.geoRecords.find(g => g.title?.includes('Swanston St'));
  assert.ok(r1Geo);
  assert.equal(r1Geo.location_role, 'sensor_site');
  assert.equal(r1Geo.location_confidence, 'source_coordinate');
  assert.ok(r1Geo.geometry_geojson?.includes('Point'));
  assert.equal(r1Geo.centroid_lon, 144.9678474);
  assert.equal(r1Geo.centroid_lat, -37.8184515);

  const r1Location = result.sensorLocations.find(l => l.sensor_id === 'ICTMicroclimate-08');
  assert.ok(r1Location);
  assert.ok(r1Location.geometry_geojson?.includes('Point'));

  // Record 5 (ICTMicroclimate-02) has null coordinates in telemetry:
  // Must NOT invent or fabricate (0,0); coordinates and geometry must remain null with unverified confidence
  const r5Geo = result.geoRecords.find(g => g.title?.includes('101 Collins St'));
  assert.ok(r5Geo);
  assert.equal(r5Geo.geometry_geojson, null);
  assert.equal(r5Geo.centroid_lat, null);
  assert.equal(r5Geo.centroid_lon, null);
  assert.equal(r5Geo.location_role, 'unknown');
  assert.equal(r5Geo.location_confidence, 'unverified');

  const r5Location = result.sensorLocations.find(l => l.sensor_id === 'ICTMicroclimate-02');
  assert.ok(r5Location);
  assert.equal(r5Location.geometry_geojson, null);

  // Area indicators preserve device ID and location name
  const r5Indicators = result.areaIndicators.filter(i => i.source_area_code === 'ICTMicroclimate-02');
  assert.ok(r5Indicators.length > 0);
  for (const ind of r5Indicators) {
    assert.equal(ind.source_area_code, 'ICTMicroclimate-02');
    assert.equal(ind.boundary_id, 'sensor_site:ICTMicroclimate-02');
    assert.equal(ind.source_area_name, '101 Collins St L11 Rooftop (Maintenance Test)');
  }
});

test('Standard representation in areaIndicators and geoRecords conforms strictly to ConnectorSuccess without non-standard fields', async () => {
  const fixture = await loadFixture();

  class MockClient extends OpenDataSoftClient {
    override async fetchRecords(): Promise<OdsRecords> {
      return {
        records: fixture.results,
        totalCount: fixture.total_count,
        pageCount: 1,
        fetchedAt: '2026-09-29T12:00:00Z',
        lastModified: null,
      };
    }
  }

  const testConnector = new MicroclimateConnector(new MockClient());
  const input = parseConnectorInput({
    sourceId: SOURCE_ID,
    window: { kind: 'snapshot', revision: '2026-04-28' },
    checkpoint: null,
    runId: 'test_standard_representation',
  });

  const result = await testConnector.collect(input);
  assert.equal(result.kind, 'success');
  if (result.kind !== 'success') return;

  // Requirement 1 & 3: strictly ConnectorSuccess, no extraneous non-standard fields
  assert.equal('microclimateObservations' in result, false);
  const expectedKeys = new Set([
    'kind', 'sourceId', 'runId', 'fetchedAt', 'sourceRevision', 'sourceLatestUpdateAt',
    'checkpointAfter', 'completeness', 'inputCount', 'outputCount', 'rejectedCount',
    'sourceRecords', 'geoRecords', 'geoRecordSources', 'boundaries', 'areaIndicators',
    'parkingBays', 'parkingObservations', 'parkingRules', 'sensorLocations',
    'pedestrianObservations', 'retainableRawRecords',
  ]);
  for (const key of Object.keys(result)) {
    assert.ok(expectedKeys.has(key), `Result must not contain non-standard field: ${key}`);
  }

  // Requirement 2: scientific units (celsius, percent, m_s, ug_m3, decibels)
  const unitsFound = new Set(result.areaIndicators.map(i => i.unit));
  assert.ok(unitsFound.has('celsius'), 'Must include celsius unit');
  assert.ok(unitsFound.has('percent'), 'Must include percent unit');
  assert.ok(unitsFound.has('m_s'), 'Must include m_s unit');
  assert.ok(unitsFound.has('ug_m3'), 'Must include ug_m3 unit');
  assert.ok(unitsFound.has('decibels'), 'Must include decibels unit');

  // Invariant assertion_kind: 'observation'
  for (const ind of result.areaIndicators) {
    assert.equal(ind.assertion_kind, 'observation');
  }

  // Check geoRecords summary contains parsed measurements
  const geoR1 = result.geoRecords.find(g => g.title?.includes('Swanston St'));
  assert.ok(geoR1);
  assert.ok(geoR1.summary?.includes('16.7 celsius'));
  assert.ok(geoR1.summary?.includes('79.9%'));
  assert.ok(geoR1.summary?.includes('0.5 m_s'));
  assert.ok(geoR1.summary?.includes('10 ug_m3'));
  assert.ok(geoR1.summary?.includes('58.7 decibels'));
});

test('Raw records are filtered to allowed fields declared in source manifest', () => {
  const rawWithExtra = {
    device_id: 'ICTMicroclimate-99',
    received_at: '2026-04-28T15:00:00+00:00',
    airtemperature: 21.5,
    relativehumidity: 60.0,
    atmosphericpressure: 1015.0,
    pm25: 8.0,
    pm10: 10.0,
    noise: 55.0,
    internal_debug_token: 'secret-token-12345',
    unapproved_payload: { raw: true },
  };

  const filtered = filterRetainableRawRecord(rawWithExtra);
  assert.equal(filtered.device_id, 'ICTMicroclimate-99');
  assert.equal(filtered.airtemperature, 21.5);
  assert.equal('internal_debug_token' in filtered, false, 'Unapproved field must be stripped');
  assert.equal('unapproved_payload' in filtered, false, 'Unapproved field must be stripped');

  for (const field of Object.keys(filtered)) {
    assert.ok(ALLOWED_FIELDS.includes(field as (typeof ALLOWED_FIELDS)[number]), `Field ${field} must be in ALLOWED_FIELDS`);
  }
});

test('Deduplicates identical readings and fails validation on conflicting duplicate readings', async () => {
  const baseRecord: ComMicroclimateRawRecord = {
    device_id: 'ICTMicroclimate-08',
    received_at: '2026-04-28T15:25:15+00:00',
    sensorlocation: 'Swanston St',
    latlong: { lon: 144.9678474, lat: -37.8184515 },
    airtemperature: 16.7,
    relativehumidity: 79.9,
    atmosphericpressure: 1026.1,
  };

  // 1. Identical duplicate row
  class MockIdenticalClient extends OpenDataSoftClient {
    override async fetchRecords(): Promise<OdsRecords> {
      return {
        records: [baseRecord, { ...baseRecord }],
        totalCount: 2,
        pageCount: 1,
        fetchedAt: '2026-09-29T12:00:00Z',
        lastModified: null,
      };
    }
  }

  const connector1 = new MicroclimateConnector(new MockIdenticalClient());
  const input1 = parseConnectorInput({
    sourceId: SOURCE_ID,
    window: { kind: 'snapshot', revision: 'current' },
    checkpoint: null,
    runId: 'test_identical_dup',
  });
  const res1 = await connector1.collect(input1);
  assert.equal(res1.kind, 'success');
  if (res1.kind === 'success') {
    assert.equal(res1.outputCount, 1, 'Identical duplicate must be deduplicated to 1');
  }

  // 2. Conflicting duplicate row (same sensor and timestamp, conflicting metric)
  class MockConflictingClient extends OpenDataSoftClient {
    override async fetchRecords(): Promise<OdsRecords> {
      return {
        records: [baseRecord, { ...baseRecord, airtemperature: 35.0 }],
        totalCount: 2,
        pageCount: 1,
        fetchedAt: '2026-09-29T12:00:00Z',
        lastModified: null,
      };
    }
  }

  const connector2 = new MicroclimateConnector(new MockConflictingClient());
  const input2 = parseConnectorInput({
    sourceId: SOURCE_ID,
    window: { kind: 'snapshot', revision: 'current' },
    checkpoint: null,
    runId: 'test_conflicting_dup',
  });
  const res2 = await connector2.collect(input2);
  assert.equal(res2.kind, 'failure');
  if (res2.kind === 'failure') {
    assert.equal(res2.code, 'validation_failed');
    assert.ok(res2.message.includes('Conflicting duplicate reading'));
  }
});

test('Error conditions: rejects wrong source ID', async () => {
  const input = parseConnectorInput({
    sourceId: 'other.source',
    window: { kind: 'snapshot', revision: 'current' },
    checkpoint: null,
    runId: 'test_wrong_source',
  });

  const res = await collectMicroclimate(input);
  assert.equal(res.kind, 'failure');
  if (res.kind === 'failure') {
    assert.equal(res.code, 'validation_failed');
    assert.ok(res.message.includes('Invalid source ID'));
  }
});

test('Error conditions: upstream HTTP rate limit returns rate_limited with retryAfterSeconds', async () => {
  class RateLimitedClient extends OpenDataSoftClient {
    override async fetchRecords(): Promise<OdsRecords> {
      throw new HttpFailure('rate_limited', 429, 1, 45000);
    }
  }

  const testConnector = new MicroclimateConnector(new RateLimitedClient());
  const input = parseConnectorInput({
    sourceId: SOURCE_ID,
    window: { kind: 'snapshot', revision: 'current' },
    checkpoint: null,
    runId: 'test_rate_limit',
  });

  const res = await testConnector.collect(input);
  assert.equal(res.kind, 'failure');
  if (res.kind === 'failure') {
    assert.equal(res.code, 'rate_limited');
    assert.equal(res.retryAfterSeconds, 45);
  }
});

test('Error conditions: upstream unavailable returns upstream_unavailable', async () => {
  class UnavailableClient extends OpenDataSoftClient {
    override async fetchRecords(): Promise<OdsRecords> {
      throw new HttpFailure('upstream_unavailable', 503, 3, null);
    }
  }

  const testConnector = new MicroclimateConnector(new UnavailableClient());
  const input = parseConnectorInput({
    sourceId: SOURCE_ID,
    window: { kind: 'snapshot', revision: 'current' },
    checkpoint: null,
    runId: 'test_unavailable',
  });

  const res = await testConnector.collect(input);
  assert.equal(res.kind, 'failure');
  if (res.kind === 'failure') {
    assert.equal(res.code, 'upstream_unavailable');
    assert.equal(res.retryAfterSeconds, null);
  }
});

test('Error conditions: schema change / malformed upstream records returns schema_changed', async () => {
  class MalformedClient extends OpenDataSoftClient {
    override async fetchRecords(): Promise<OdsRecords> {
      return {
        records: [
          // Missing required device_id and received_at
          { foo: 'bar', broken: 123 },
        ],
        totalCount: 1,
        pageCount: 1,
        fetchedAt: '2026-09-29T12:00:00Z',
        lastModified: null,
      };
    }
  }

  const testConnector = new MicroclimateConnector(new MalformedClient());
  const input = parseConnectorInput({
    sourceId: SOURCE_ID,
    window: { kind: 'snapshot', revision: 'current' },
    checkpoint: null,
    runId: 'test_schema_change',
  });

  const res = await testConnector.collect(input);
  assert.equal(res.kind, 'failure');
  if (res.kind === 'failure') {
    assert.equal(res.code, 'schema_changed');
  }
});

test('Error conditions: incomplete window error returns incomplete_window', async () => {
  class IncompleteClient extends OpenDataSoftClient {
    override async fetchRecords(): Promise<OdsRecords> {
      throw new OdsIncompleteWindow('ODS response truncated', 10);
    }
  }

  const testConnector = new MicroclimateConnector(new IncompleteClient());
  const input = parseConnectorInput({
    sourceId: SOURCE_ID,
    window: { kind: 'snapshot', revision: 'current' },
    checkpoint: null,
    runId: 'test_incomplete_window',
  });

  const res = await testConnector.collect(input);
  assert.equal(res.kind, 'failure');
  if (res.kind === 'failure') {
    assert.equal(res.code, 'incomplete_window');
  }
});

test('fetchMicroclimateDataProcessed retrieves official data_processed timestamp and fetchMetadataRevision option populates sourceLatestUpdateAt', async () => {
  const fixture = await loadFixture();
  const officialProcessed = '2026-09-30T04:39:38.000Z';

  class MockMetadataClient extends OpenDataSoftClient {
    override async fetchDatasetDataProcessed(): Promise<string> {
      return officialProcessed;
    }

    override async fetchRecords(): Promise<OdsRecords> {
      return {
        records: fixture.results.slice(0, 2),
        totalCount: 2,
        pageCount: 1,
        fetchedAt: '2026-09-30T12:00:00Z',
        lastModified: null,
      };
    }
  }

  const client = new MockMetadataClient();
  const fetchedTimestamp = await fetchMicroclimateDataProcessed(client);
  assert.equal(fetchedTimestamp, officialProcessed);

  const testConnector = new MicroclimateConnector(client, undefined, { fetchMetadataRevision: true });
  const input = parseConnectorInput({
    sourceId: SOURCE_ID,
    window: { kind: 'snapshot', revision: 'current' },
    checkpoint: null,
    runId: 'test_meta_revision',
  });

  const res = await testConnector.collect(input);
  assert.equal(res.kind, 'success');
  if (res.kind === 'success') {
    assert.equal(res.sourceLatestUpdateAt, officialProcessed);
  }
});

test('Historical telemetry remains bounded observation evidence without asserting current asset status', async () => {
  // Telemetry batch containing historical readings from older devices alongside current active devices
  const mixedTelemetry: ComMicroclimateRawRecord[] = [
    {
      device_id: 'ICTMicroclimate-01', // No recent telemetry for 3 months (latest in June 2026)
      received_at: '2026-06-30T17:41:38+00:00',
      sensorlocation: 'Birrarung Marr Park - Pole 1131',
      latlong: { lon: 144.9716404, lat: -37.8185931 },
      airtemperature: 12.5,
      relativehumidity: 78.0,
      atmosphericpressure: 1020.0,
      averagewindspeed: 1.2,
      noise: 64.0,
    },
    {
      device_id: 'ICTMicroclimate-04', // No recent telemetry for 13 days (latest Sep 17, 2026)
      received_at: '2026-09-17T00:47:36+00:00',
      sensorlocation: 'Batman Park',
      latlong: { lon: 144.9562225, lat: -37.8221828 },
      airtemperature: 15.0,
      relativehumidity: 65.0,
      atmosphericpressure: 1018.0,
      averagewindspeed: 0.9,
      noise: 68.0,
    },
    {
      device_id: 'ICTMicroclimate-02', // Current active device, earlier observation
      received_at: '2026-09-30T04:13:39+00:00',
      sensorlocation: '101 Collins St L11 Rooftop',
      latlong: { lon: 144.9702991, lat: -37.814604 },
      airtemperature: 22.7,
      relativehumidity: 50.5,
      atmosphericpressure: 1010.7,
      averagewindspeed: 2.5,
      noise: 72.9,
    },
    {
      device_id: 'ICTMicroclimate-02', // Current active device, latest observation
      received_at: '2026-09-30T04:28:42+00:00',
      sensorlocation: '101 Collins St L11 Rooftop',
      latlong: { lon: 144.9702991, lat: -37.814604 },
      airtemperature: 22.8,
      relativehumidity: 50.4,
      atmosphericpressure: 1010.6,
      averagewindspeed: 1.9,
      noise: 70.0,
    },
    {
      device_id: 'ICTMicroclimate-05', // Current active device, latest observation
      received_at: '2026-09-30T04:39:19+00:00',
      sensorlocation: 'Enterprize Park - Pole ID: COM1667',
      latlong: { lon: 144.9591192, lat: -37.8204083 },
      airtemperature: 22.8,
      relativehumidity: 51.2,
      atmosphericpressure: 1014.9,
      averagewindspeed: 0.8,
      noise: 75.1,
    },
  ];

  class MockMixedClient extends OpenDataSoftClient {
    override async fetchRecords(): Promise<OdsRecords> {
      return {
        records: mixedTelemetry,
        totalCount: mixedTelemetry.length,
        pageCount: 1,
        fetchedAt: '2026-09-30T12:00:00Z',
        lastModified: '2026-09-30T04:39:38.000Z',
      };
    }
  }

  const testConnector = new MicroclimateConnector(new MockMixedClient());
  const input = parseConnectorInput({
    sourceId: SOURCE_ID,
    window: { kind: 'snapshot', revision: 'current' },
    checkpoint: null,
    runId: 'test_historical_vs_active_equipment',
  });

  const result = await testConnector.collect(input);
  assert.equal(result.kind, 'success');
  if (result.kind !== 'success') return;

  // 1. Invariant: Historical observations MUST be strictly preserved as immutable observation facts
  assert.equal(result.sourceRecords.length, 5);
  const r01Source = result.sourceRecords.find(s => s.source_record_id.includes('ICTMicroclimate-01'));
  assert.ok(r01Source, 'Historical ICTMicroclimate-01 observation record must be preserved');
  assert.equal(r01Source.observed_at, '2026-06-30T17:41:38.000Z');
  assert.equal(r01Source.assertion_kind, 'observation');

  // Indicators for ICTMicroclimate-01 preserved with historical observed time
  const r01Indicators = result.areaIndicators.filter(i => i.source_area_code === 'ICTMicroclimate-01');
  assert.equal(r01Indicators.length, MICROCLIMATE_METRICS.length);
  for (const ind of r01Indicators) {
    assert.equal(ind.period_start, '2026-06-30T17:41:38.000Z');
    assert.equal(ind.period_end, '2026-06-30T17:41:38.000Z');
    assert.equal(ind.assertion_kind, 'observation');
  }

  // A coordinate is proven only at its observation time. Telemetry does not
  // establish asset lifecycle, even when another device has reported recently.
  for (const location of result.sensorLocations) {
    assert.equal(location.device_status, null);
    assert.equal(location.valid_to, location.valid_from);
  }
  for (const observation of result.geoRecords) {
    assert.equal(observation.freshness_state, 'unknown');
    assert.equal(observation.valid_to, observation.observed_at);
  }
  assert.equal(result.sensorLocations.some(s => s.device_status === 'active' && s.valid_to === null), false);

});

class MockPaginationHttpClient extends HttpClient {
  constructor(
    private readonly handler: (url: URL) => { status?: number; total_count: number; results: unknown[] },
  ) {
    super();
  }

  override async getJson(request: HttpRequest): Promise<HttpResponse<unknown>> {
    const url = typeof request.url === 'string' ? new URL(request.url) : request.url;
    const res = this.handler(url);
    return {
      body: { total_count: res.total_count, results: res.results },
      status: res.status ?? 200,
      fetchedAt: '2026-09-30T12:00:00Z',
      etag: null,
      lastModified: '2026-09-30T04:39:38.000Z',
      contentType: 'application/json',
    };
  }
}

test('Production OpenDataSoftClient pagination issues real offset/limit HTTP requests across pages', async () => {
  const baseRecord: ComMicroclimateRawRecord = {
    device_id: 'ICTMicroclimate-08',
    received_at: '2026-09-30T04:00:00+00:00',
    sensorlocation: 'Swanston St',
    latlong: { lon: 144.9678474, lat: -37.8184515 },
    airtemperature: 20.0,
    relativehumidity: 50.0,
    atmosphericpressure: 1015.0,
  };

  const records11: ComMicroclimateRawRecord[] = Array.from({ length: 11 }, (_, i) => ({
    ...baseRecord,
    device_id: `ICTMicroclimate-${String(i).padStart(2, '0')}`,
    received_at: `2026-09-30T04:${String(i * 2).padStart(2, '0')}:00+00:00`,
  }));

  const requestedOffsets: { offset: string | null; limit: string | null }[] = [];
  const mockHttp = new MockPaginationHttpClient((url) => {
    const offsetStr = url.searchParams.get('offset');
    const limitStr = url.searchParams.get('limit');
    requestedOffsets.push({ offset: offsetStr, limit: limitStr });

    const offset = offsetStr ? Number(offsetStr) : 0;
    const limit = limitStr ? Number(limitStr) : 100;
    const pageResults = records11.slice(offset, offset + limit);

    return { total_count: 11, results: pageResults };
  });

  const client = new OpenDataSoftClient(mockHttp);
  const testConnector = new MicroclimateConnector(client, undefined);
  const input = parseConnectorInput({
    sourceId: SOURCE_ID,
    window: { kind: 'time', from: '2026-09-30T04:00:00Z', to: '2026-09-30T05:00:00Z' },
    checkpoint: null,
    runId: 'test_real_ods_pagination',
  });

  // Collect with custom pageSize via client query or default
  // To verify multi-page, test OpenDataSoftClient fetchRecords with pageSize: 5 directly through collect
  const recordsResult = await client.fetchRecords({
    portalUrl: DEFAULT_PORTAL_URL,
    datasetId: DATASET_ID,
    where: `received_at >= '2026-09-30T04:00:00Z' AND received_at < '2026-09-30T05:00:00Z'`,
    orderBy: 'received_at ASC, device_id ASC',
    pageSize: 5,
  });

  assert.equal(recordsResult.records.length, 11);
  assert.equal(recordsResult.pageCount, 3);
  assert.equal(recordsResult.totalCount, 11);

  // Assert exact offset/limit params were requested across HTTP boundary
  assert.deepEqual(requestedOffsets, [
    { offset: '0', limit: '5' },
    { offset: '5', limit: '5' },
    { offset: '10', limit: '1' },
  ]);

  // Feed through connector and verify complete pagination accounting
  class MockPageSizeClient extends OpenDataSoftClient {
    override async fetchRecords(query: OdsQuery): Promise<OdsRecords> {
      return client.fetchRecords({ ...query, pageSize: 5 });
    }
  }

  const connectorWithPaging = new MicroclimateConnector(new MockPageSizeClient());
  const res = await connectorWithPaging.collect(input);
  assert.equal(res.kind, 'success');
  if (res.kind !== 'success') return;

  assert.equal(res.completeness.complete, true);
  assert.equal(res.completeness.method, 'pagination');
  assert.equal(res.completeness.expected_records, 11);
  assert.equal(res.completeness.fetched_records, 11);
  assert.equal(res.completeness.expected_pages, 3);
  assert.equal(res.completeness.fetched_pages, 3);
  assert.equal(res.sourceRecords.length, 11);
  assert.equal(res.geoRecords.length, 11);
  assert.equal(res.sensorLocations.length, 11);
});

test('Production OpenDataSoftClient pagination detects truncated / empty page before total_count (末页缺失) and fails with incomplete_window', async () => {
  const baseRecord: ComMicroclimateRawRecord = {
    device_id: 'ICTMicroclimate-08',
    received_at: '2026-09-30T04:00:00+00:00',
    sensorlocation: 'Swanston St',
    latlong: { lon: 144.9678474, lat: -37.8184515 },
    airtemperature: 20.0,
    relativehumidity: 50.0,
    atmosphericpressure: 1015.0,
  };

  // Upstream claims total_count = 11, returns 5 rows on page 1, but returns empty [] on page 2
  const mockHttp = new MockPaginationHttpClient((url) => {
    const offset = Number(url.searchParams.get('offset') ?? '0');
    if (offset === 0) {
      return { total_count: 11, results: Array(5).fill(baseRecord) };
    }
    // Truncated: returns empty results before reaching total_count
    return { total_count: 11, results: [] };
  });

  class MockTruncatedClient extends OpenDataSoftClient {
    constructor() {
      super(mockHttp);
    }
    override async fetchRecords(query: OdsQuery): Promise<OdsRecords> {
      return super.fetchRecords({ ...query, pageSize: 5 });
    }
  }

  const testConnector = new MicroclimateConnector(new MockTruncatedClient());
  const input = parseConnectorInput({
    sourceId: SOURCE_ID,
    window: { kind: 'time', from: '2026-09-30T04:00:00Z', to: '2026-09-30T05:00:00Z' },
    checkpoint: null,
    runId: 'test_truncated_page',
  });

  const res = await testConnector.collect(input);
  assert.equal(res.kind, 'failure');
  if (res.kind === 'failure') {
    assert.equal(res.code, 'incomplete_window');
    assert.ok(res.message.includes('empty page before total_count'));
    assert.equal(res.completeness.complete, false);
  }
});

test('Production OpenDataSoftClient pagination detects total_count drift during pagination (总数变化) and fails with incomplete_window', async () => {
  const baseRecord: ComMicroclimateRawRecord = {
    device_id: 'ICTMicroclimate-08',
    received_at: '2026-09-30T04:00:00+00:00',
    sensorlocation: 'Swanston St',
    latlong: { lon: 144.9678474, lat: -37.8184515 },
    airtemperature: 20.0,
    relativehumidity: 50.0,
    atmosphericpressure: 1015.0,
  };

  // Upstream returns total_count: 11 on page 1, but total_count changes to 12 on page 2 (drift during pagination)
  const mockHttp = new MockPaginationHttpClient((url) => {
    const offset = Number(url.searchParams.get('offset') ?? '0');
    if (offset === 0) {
      return { total_count: 11, results: Array(5).fill(baseRecord) };
    }
    // Drift: total_count changed
    return { total_count: 12, results: Array(5).fill(baseRecord) };
  });

  class MockDriftClient extends OpenDataSoftClient {
    constructor() {
      super(mockHttp);
    }
    override async fetchRecords(query: OdsQuery): Promise<OdsRecords> {
      return super.fetchRecords({ ...query, pageSize: 5 });
    }
  }

  const testConnector = new MicroclimateConnector(new MockDriftClient());
  const input = parseConnectorInput({
    sourceId: SOURCE_ID,
    window: { kind: 'time', from: '2026-09-30T04:00:00Z', to: '2026-09-30T05:00:00Z' },
    checkpoint: null,
    runId: 'test_total_count_drift',
  });

  const res = await testConnector.collect(input);
  assert.equal(res.kind, 'failure');
  if (res.kind === 'failure') {
    assert.equal(res.code, 'incomplete_window');
    assert.ok(res.message.includes('total_count changed during pagination'));
    assert.equal(res.completeness.complete, false);
  }
});

test('Production OpenDataSoftClient pagination handles cross-page duplicate records (页间重复)', async () => {
  const baseRecord = (id: string, time: string, temp = 20.0): ComMicroclimateRawRecord => ({
    device_id: id,
    received_at: time,
    sensorlocation: 'Swanston St',
    latlong: { lon: 144.9678474, lat: -37.8184515 },
    airtemperature: temp,
    relativehumidity: 50.0,
    atmosphericpressure: 1015.0,
  });

  // Page 1: 5 distinct records (rec 0 to rec 4)
  const page1Records = [
    baseRecord('ICTMicroclimate-01', '2026-09-30T04:00:00+00:00'),
    baseRecord('ICTMicroclimate-02', '2026-09-30T04:02:00+00:00'),
    baseRecord('ICTMicroclimate-03', '2026-09-30T04:04:00+00:00'),
    baseRecord('ICTMicroclimate-04', '2026-09-30T04:06:00+00:00'),
    baseRecord('ICTMicroclimate-05', '2026-09-30T04:08:00+00:00'),
  ];

  // Case 1: Identical duplicate across boundary: page 2 includes rec 4 (identical) and 4 more
  const page2Identical = [
    baseRecord('ICTMicroclimate-05', '2026-09-30T04:08:00+00:00'), // Identical to last item of page 1
    baseRecord('ICTMicroclimate-06', '2026-09-30T04:10:00+00:00'),
    baseRecord('ICTMicroclimate-07', '2026-09-30T04:12:00+00:00'),
    baseRecord('ICTMicroclimate-08', '2026-09-30T04:14:00+00:00'),
    baseRecord('ICTMicroclimate-09', '2026-09-30T04:16:00+00:00'),
  ];
  const page3Identical = [
    baseRecord('ICTMicroclimate-10', '2026-09-30T04:18:00+00:00'),
  ];

  // Mock returning identical duplicate across page 1 and page 2
  const identicalHttp = new MockPaginationHttpClient((url) => {
    const offset = Number(url.searchParams.get('offset') ?? '0');
    if (offset === 0) return { total_count: 11, results: page1Records };
    if (offset === 5) return { total_count: 11, results: page2Identical };
    return { total_count: 11, results: page3Identical };
  });

  class MockPageDupClient extends OpenDataSoftClient {
    constructor(http: HttpClient) {
      super(http);
    }
    override async fetchRecords(query: OdsQuery): Promise<OdsRecords> {
      return super.fetchRecords({ ...query, pageSize: 5 });
    }
  }

  const connector1 = new MicroclimateConnector(new MockPageDupClient(identicalHttp));
  const input1 = parseConnectorInput({
    sourceId: SOURCE_ID,
    window: { kind: 'time', from: '2026-09-30T04:00:00Z', to: '2026-09-30T05:00:00Z' },
    checkpoint: null,
    runId: 'test_cross_page_identical_dup',
  });

  const res1 = await connector1.collect(input1);
  assert.equal(res1.kind, 'success');
  if (res1.kind === 'success') {
    // 11 fetched rows contain 1 duplicate across page boundary -> deduplicated to 10 unique observations
    assert.equal(res1.inputCount, 11);
    assert.equal(res1.outputCount, 10);
    assert.equal(res1.sourceRecords.length, 10);
  }

  // Case 2: Conflicting duplicate across page boundary (same sensor & timestamp, mutated value)
  const page2Conflicting = [
    baseRecord('ICTMicroclimate-05', '2026-09-30T04:08:00+00:00', 38.5), // Conflicting temperature (38.5 vs 20.0)
    baseRecord('ICTMicroclimate-06', '2026-09-30T04:10:00+00:00'),
    baseRecord('ICTMicroclimate-07', '2026-09-30T04:12:00+00:00'),
    baseRecord('ICTMicroclimate-08', '2026-09-30T04:14:00+00:00'),
    baseRecord('ICTMicroclimate-09', '2026-09-30T04:16:00+00:00'),
  ];

  const conflictingHttp = new MockPaginationHttpClient((url) => {
    const offset = Number(url.searchParams.get('offset') ?? '0');
    if (offset === 0) return { total_count: 11, results: page1Records };
    if (offset === 5) return { total_count: 11, results: page2Conflicting };
    return { total_count: 11, results: page3Identical };
  });

  const connector2 = new MicroclimateConnector(new MockPageDupClient(conflictingHttp));
  const input2 = parseConnectorInput({
    sourceId: SOURCE_ID,
    window: { kind: 'time', from: '2026-09-30T04:00:00Z', to: '2026-09-30T05:00:00Z' },
    checkpoint: null,
    runId: 'test_cross_page_conflicting_dup',
  });

  const res2 = await connector2.collect(input2);
  assert.equal(res2.kind, 'failure');
  if (res2.kind === 'failure') {
    assert.equal(res2.code, 'validation_failed');
    assert.ok(res2.message.includes('Conflicting duplicate reading for device ICTMicroclimate-05'));
  }
});

test('Live official API bounded read-only inspection against data.melbourne.vic.gov.au', { skip: process.env.RUN_LIVE_PUBLIC_DATA !== '1' }, async () => {
  const liveConnector = new MicroclimateConnector();
  const input = parseConnectorInput({
    sourceId: SOURCE_ID,
    window: { kind: 'time', from: '2026-09-30T04:00:00Z', to: '2026-09-30T04:30:00Z' },
    checkpoint: null,
    runId: 'live_microclimate_inspection',
  });

  const res = await liveConnector.collect(input);

  // If environment has no network or upstream is down, expect upstream_unavailable
  if (res.kind === 'failure') {
    assert.ok(
      res.code === 'upstream_unavailable' || res.code === 'rate_limited',
      `Live check failed with code ${res.code}: ${res.message}`,
    );
    return;
  }

  assert.equal(res.kind, 'success');
  assert.equal(res.sourceId, SOURCE_ID);
  assert.equal(res.completeness.complete, true);
  assert.equal(res.completeness.fetched_records, 10);
  assert.equal(res.sourceRecords.length, 10);
  assert.equal(res.geoRecords.length, 10);
  assert.equal(res.sensorLocations.length, 10);
  assert.equal(res.areaIndicators.length, 10 * MICROCLIMATE_METRICS.length);

  // Check active devices in live feed: only active devices present
  const liveSensors = new Set(res.sensorLocations.map(s => s.sensor_id));
  const expectedActiveDevices = ['ICTMicroclimate-02', 'ICTMicroclimate-03', 'ICTMicroclimate-05', 'ICTMicroclimate-08', 'aws5-0999'];
  for (const expectedDevice of expectedActiveDevices) {
    assert.ok(liveSensors.has(expectedDevice), `Active device ${expectedDevice} must be present in live telemetry`);
  }

  // Inactive devices stopped months or weeks ago must NOT be present
  assert.equal(liveSensors.has('ICTMicroclimate-01'), false);
  assert.equal(liveSensors.has('ICTMicroclimate-04'), false);
  assert.equal(liveSensors.has('ICTMicroclimate-06'), false);
  assert.equal(liveSensors.has('ICTMicroclimate-07'), false);
  assert.equal(liveSensors.has('ICTMicroclimate-09'), false);
  assert.equal(liveSensors.has('ICTMicroclimate-11'), false);

  // Check no-zero-filling rule: aws5-0999 does not measure pm25/pm10/noise, so status is missing and value is null (NEVER 0!)
  const awsIndicators = res.areaIndicators.filter(i => i.source_area_code === 'aws5-0999');
  const awsPm25 = awsIndicators.find(i => i.indicator_id.endsWith(':pm25'));
  assert.ok(awsPm25, 'aws5-0999 pm25 indicator must be generated');
  assert.equal(awsPm25.status, 'missing');
  assert.equal(awsPm25.value, null);
  assert.notEqual(awsPm25.value, 0, 'Missing metric must never be zero-filled');

  const awsNoise = awsIndicators.find(i => i.indicator_id.endsWith(':noise'));
  assert.ok(awsNoise, 'aws5-0999 noise indicator must be generated');
  assert.equal(awsNoise.status, 'missing');
  assert.equal(awsNoise.value, null);
  assert.notEqual(awsNoise.value, 0, 'Missing metric must never be zero-filled');

  // Check real 0.0 values are preserved as observed
  const windMinInds = res.areaIndicators.filter(i => i.indicator_id.endsWith(':wind_speed_minimum') && i.value === 0);
  assert.ok(windMinInds.length > 0, 'At least one reading should have real 0.0 minimum wind speed');
  for (const wind0 of windMinInds) {
    assert.equal(wind0.status, 'observed');
    assert.equal(wind0.value, 0);
  }
});



test('Microclimate observation replay is immutable across windows, neighbouring readings and fetch times', async () => {
  const fixture = await loadFixture();
  const observation = fixture.results[0];
  assert.ok(observation);
  class ReplayClient extends OpenDataSoftClient {
    constructor(private readonly rows: unknown[], private readonly fetched: string) { super(); }
    override async fetchRecords(): Promise<OdsRecords> {
      return { records: this.rows, totalCount: this.rows.length, pageCount: 1,
        fetchedAt: this.fetched, lastModified: null };
    }
  }
  const base = parseConnectorInput({ sourceId: SOURCE_ID, window: { kind: 'snapshot', revision: 'current' },
    checkpoint: null, runId: 'single-observation' });
  const single = await new MicroclimateConnector(new ReplayClient([observation], '2026-09-30T12:00:00Z')).collect(base);
  const expanded = await new MicroclimateConnector(new ReplayClient(fixture.results, '2026-10-03T12:00:00Z'))
    .collect({ ...base, runId: 'expanded-later-replay', window: { kind: 'time',
      from: '2026-09-28T00:00:00Z', to: '2026-09-30T00:00:00Z' } });
  assert.equal(single.kind, 'success');
  assert.equal(expanded.kind, 'success');
  if (single.kind !== 'success' || expanded.kind !== 'success') return;
  const stripAudit = (row: object) => Object.fromEntries(Object.entries(row)
    .filter(([key]) => key !== 'batch_id' && key !== 'fetched_at'));
  for (const row of single.sensorLocations) {
    const replay: (typeof expanded.sensorLocations)[number] | undefined = expanded.sensorLocations
      .find(other => other.sensor_id === row.sensor_id && other.version_id === row.version_id);
    assert.ok(replay);
    assert.deepEqual(stripAudit(replay), stripAudit(row));
  }
  for (const row of single.geoRecords) {
    const replay: (typeof expanded.geoRecords)[number] | undefined = expanded.geoRecords
      .find(other => other.geo_record_id === row.geo_record_id && other.version_id === row.version_id);
    assert.ok(replay);
    assert.deepEqual(stripAudit(replay), stripAudit(row));
  }
});
