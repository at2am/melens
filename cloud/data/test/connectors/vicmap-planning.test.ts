import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  CHUNK_SIZE,
  LGA_NAME,
  SERVICE_URL,
  SOURCE_ID,
  VicmapPlanningConnector,
  epochUtc,
  layers,
  metadataUrl,
  normalizePlanningControl,
  queryUrl,
  splitPolygon,
  type Layer,
} from '../../src/connectors/vicmap_planning/index.js';
import { isConnector, parseConnectorInput } from '../../src/core/connector.js';
import { HttpClient, HttpFailure, type HttpResponse } from '../../src/core/http.js';
import { loadConnector, loadSourceRegistry } from '../../src/core/registry.js';
import { validateGeoRecordGeography } from '../../src/validation/geography.js';
import { parseSourceRecord } from '../../src/validation/record.js';

interface VicmapFixtureData {
  overlay: {
    metadata: { id: number; objectIdField: string; editingInfo: { dataLastEditDate: number } };
    ids: { objectIdFieldName: string; objectIds: number[] };
    collection: { type: string; features: unknown[] };
  };
  zone: {
    metadata: { id: number; objectIdField: string; editingInfo: { dataLastEditDate: number } };
    ids: { objectIdFieldName: string; objectIds: number[] };
    collection: { type: string; features: unknown[] };
  };
}

const input = parseConnectorInput({
  sourceId: SOURCE_ID,
  window: { kind: 'snapshot', revision: 'latest' },
  checkpoint: null,
  runId: 'vicmap-test-run',
});
const fetchedAt = '2026-09-29T00:00:00.000Z';

async function loadFixture(): Promise<VicmapFixtureData> {
  const fixtureUrl = new URL('../fixtures/vicmap_planning.json', import.meta.url);
  const text = await readFile(fixtureUrl, 'utf8');
  return JSON.parse(text) as VicmapFixtureData;
}

test('Vicmap Planning connector conforms to frozen Connector interface and registers in source registry', async () => {
  const connectorsDir = fileURLToPath(new URL('../../src/connectors', import.meta.url));
  const registry = await loadSourceRegistry(connectorsDir);

  const entry = registry.get(SOURCE_ID);
  assert.ok(entry, `Source ${SOURCE_ID} must be registered`);
  assert.equal(entry.dataSource.source_id, SOURCE_ID);
  assert.equal(entry.dataSource.provider, 'Department of Transport and Planning');
  assert.equal(entry.dataSource.topic, 'planning');
  assert.equal(entry.dataSource.scope, 'victoria');

  // Must maintain review_required and candidate status per task constraints
  assert.equal(entry.dataSource.license_status, 'review_required');
  assert.equal(entry.dataSource.access_status, 'candidate');

  const connector = await loadConnector(entry);
  assert.ok(isConnector(connector));
  assert.equal(connector.sourceId, SOURCE_ID);
  assert.equal(typeof connector.collect, 'function');
});

test('epochUtc converts milliseconds to ISO string and rejects invalid values', () => {
  assert.equal(epochUtc(null), null);
  assert.equal(epochUtc(928368000000), '1999-06-03T00:00:00.000Z');
  assert.equal(epochUtc(1711843200000), '2024-03-31T00:00:00.000Z');
  assert.throws(() => epochUtc(Number.NaN), /Invalid Vicmap date/);
});

test('splitPolygon separates MultiPolygon into individual Polygons and keeps single Polygon unchanged', () => {
  const singlePolygon = {
    type: 'Polygon',
    coordinates: [[[144.95, -37.81], [144.96, -37.81], [144.96, -37.82], [144.95, -37.82], [144.95, -37.81]]],
  };
  const singleResult = splitPolygon(singlePolygon);
  assert.equal(singleResult.length, 1);
  assert.equal(singleResult[0]?.type, 'Polygon');

  const multiPolygon = {
    type: 'MultiPolygon',
    coordinates: [
      [[[144.95, -37.81], [144.96, -37.81], [144.96, -37.82], [144.95, -37.82], [144.95, -37.81]]],
      [[[144.97, -37.81], [144.98, -37.81], [144.98, -37.82], [144.97, -37.82], [144.97, -37.81]]],
    ],
  };
  const multiResult = splitPolygon(multiPolygon);
  assert.equal(multiResult.length, 2);
  assert.equal(multiResult[0]?.type, 'Polygon');
  assert.equal(multiResult[1]?.type, 'Polygon');
});

test('normalizePlanningControl correctly normalizes zone feature (single Polygon)', async () => {
  const fixture = await loadFixture();
  const zoneLayer = layers.find(l => l.kind === 'zone');
  assert.ok(zoneLayer);
  const zoneFeature = fixture.zone.collection.features[0];
  const layerEditedAt = '2024-03-31T00:00:00.000Z';

  const control = normalizePlanningControl(zoneFeature, zoneLayer, input.runId, fetchedAt, layerEditedAt);

  // SourceRecord checks
  assert.equal(control.sourceRecord.source_id, SOURCE_ID);
  assert.equal(control.sourceRecord.record_status, 'active');
  assert.equal(control.sourceRecord.assertion_kind, 'plan');
  assert.equal(control.sourceRecord.rights_status, 'review_required');
  assert.equal(control.sourceRecord.valid_from, '1999-06-03T00:00:00.000Z');
  assert.equal(control.sourceRecord.valid_to, null);
  assert.equal(control.sourceRecord.source_updated_at, layerEditedAt);
  assert.ok(control.sourceRecord.time_missing_reason);
  assert.doesNotThrow(() => parseSourceRecord(control.sourceRecord));

  // GeoRecords checks
  assert.equal(control.geoRecords.length, 1);
  const geo = control.geoRecords[0];
  assert.ok(geo);
  assert.equal(geo.topic, 'planning');
  assert.equal(geo.assertion_kind, 'plan');
  assert.equal(geo.rights_status, 'review_required');
  assert.equal(geo.public_query_allowed, false);
  assert.equal(geo.location_role, 'area_only');
  assert.equal(geo.location_confidence, 'source_coordinate');
  assert.deepEqual(geo.area_refs, ['vicmap_lga:343']);
  assert.equal(geo.valid_from, '1999-06-03T00:00:00.000Z');
  assert.equal(geo.valid_to, null);

  // Geography validation
  const geoValidation = validateGeoRecordGeography(geo);
  assert.equal(geoValidation.valid, true, `Geography must be valid: ${geoValidation.issues.join(', ')}`);

  // Summary must preserve control status without falsely asserting approved development
  const summary = JSON.parse(geo.summary ?? '{}');
  assert.equal(summary.control_kind, 'zone');
  assert.equal(summary.scheme_code, 'ZN');
  assert.equal(summary.control_code, 'CCZ1');
  assert.equal(summary.lga, 'MELBOURNE');
  assert.equal(summary.lga_code, '343');

  // GeoRecordSources checks
  assert.equal(control.geoRecordSources.length, 1);
  assert.equal(control.geoRecordSources[0]?.evidence_role, 'official_planning_control');
  assert.equal(control.geoRecordSources[0]?.source_record_id, control.sourceRecord.source_record_id);
});

test('planning zones retain official version and raw planning status and are never treated as approved construction projects', async () => {
  const fixture = await loadFixture();
  const zoneLayer = layers.find(l => l.kind === 'zone')!;
  const baseZoneFeature = fixture.zone.collection.features[0] as { properties: Record<string, unknown>; geometry: unknown };
  const rawFeature = {
    ...baseZoneFeature,
    properties: {
      ...baseZoneFeature.properties,
      zone_status: 'Gazetted',
      gaz_begin_date: 1609459200000,
    },
  };
  const layerEditedAt = '2024-03-31T00:00:00.000Z';
  const control = normalizePlanningControl(rawFeature, zoneLayer, input.runId, fetchedAt, layerEditedAt);

  // 1. Raw planning status is retained
  const summary = JSON.parse(control.geoRecords[0]?.summary ?? '{}');
  assert.equal(summary.control_status, 'Gazetted');
  assert.equal(summary.control_kind, 'zone');
  assert.equal(summary.control_code, 'CCZ1');

  // 2. Official version is retained in source_updated_at, layer_edited_at and gaz_begin_date
  assert.equal(summary.layer_edited_at, layerEditedAt);
  assert.equal(summary.gazette_effective_from, '2021-01-01T00:00:00.000Z');
  assert.equal(control.sourceRecord.source_updated_at, layerEditedAt);
  assert.equal(control.sourceRecord.valid_from, '2021-01-01T00:00:00.000Z');
  assert.equal(control.geoRecords[0]?.source_updated_at, layerEditedAt);
  assert.equal(control.geoRecords[0]?.valid_from, '2021-01-01T00:00:00.000Z');

  // 3. Planning zones must NOT be treated as approved construction projects
  // In planning controls, assertion_kind is strictly 'plan' (never 'observation' or approved development),
  // topic is 'planning', evidence_role is 'official_planning_control', and record_status is 'active' legal control.
  assert.equal(control.sourceRecord.assertion_kind, 'plan');
  assert.notEqual(control.sourceRecord.assertion_kind, 'observation');
  assert.equal(control.geoRecords[0]?.assertion_kind, 'plan');
  assert.notEqual(control.geoRecords[0]?.assertion_kind, 'observation');
  assert.equal(control.geoRecords[0]?.topic, 'planning');
  assert.equal(control.geoRecordSources[0]?.evidence_role, 'official_planning_control');

  // Must not claim project approval or construction activity
  assert.doesNotMatch(control.geoRecords[0]?.title ?? '', /approved|construction|project/i);
  assert.doesNotMatch(summary.control_status ?? '', /approved_project|under_construction/i);
});

test('normalizePlanningControl correctly normalizes overlay feature (MultiPolygon) into disjoint parts', async () => {
  const fixture = await loadFixture();
  const overlayLayer = layers.find(l => l.kind === 'overlay');
  assert.ok(overlayLayer);
  const overlayFeature = fixture.overlay.collection.features[0];
  const layerEditedAt = '2024-03-31T00:00:00.000Z';

  const control = normalizePlanningControl(overlayFeature, overlayLayer, input.runId, fetchedAt, layerEditedAt);

  // One source fact for all parts
  assert.doesNotThrow(() => parseSourceRecord(control.sourceRecord));
  assert.equal(control.sourceRecord.assertion_kind, 'plan');

  // MultiPolygon was split into 2 distinct GeoRecords
  assert.equal(control.geoRecords.length, 2);
  assert.ok(control.geoRecords[0]?.geo_record_id.endsWith(':part:1'));
  assert.ok(control.geoRecords[1]?.geo_record_id.endsWith(':part:2'));

  for (const part of control.geoRecords) {
    assert.equal(part.topic, 'planning');
    assert.equal(part.assertion_kind, 'plan');
    assert.equal(part.rights_status, 'review_required');
    assert.equal(part.public_query_allowed, false);
    assert.equal(part.location_role, 'area_only');
    const partGeoValidation = validateGeoRecordGeography(part);
    assert.equal(partGeoValidation.valid, true);
  }

  // Two evidence links, both pointing to the same parent source record
  assert.equal(control.geoRecordSources.length, 2);
  assert.equal(control.geoRecordSources[0]?.source_record_id, control.sourceRecord.source_record_id);
  assert.equal(control.geoRecordSources[1]?.source_record_id, control.sourceRecord.source_record_id);
});

test('normalizePlanningControl rejects out-of-boundary features and scheme mismatches', async () => {
  const fixture = await loadFixture();
  const zoneLayer = layers.find(l => l.kind === 'zone')!;
  const baseFeature = JSON.parse(JSON.stringify(fixture.zone.collection.features[0]));

  // LGA mismatch
  const wrongLga = { ...baseFeature, properties: { ...baseFeature.properties, lga: 'YARRA' } };
  assert.throws(() => normalizePlanningControl(wrongLga, zoneLayer, input.runId, fetchedAt, '2024-03-31T00:00:00.000Z'),
    /outside Melbourne LGA/);

  // LGA code mismatch
  const wrongLgaCode = { ...baseFeature, properties: { ...baseFeature.properties, lga_code: '370' } };
  assert.throws(() => normalizePlanningControl(wrongLgaCode, zoneLayer, input.runId, fetchedAt, '2024-03-31T00:00:00.000Z'),
    /outside Melbourne LGA/);

  // Scheme code mismatch (zone layer must have ZN, not PO)
  const wrongScheme = { ...baseFeature, properties: { ...baseFeature.properties, scheme_code: 'PO' } };
  assert.throws(() => normalizePlanningControl(wrongScheme, zoneLayer, input.runId, fetchedAt, '2024-03-31T00:00:00.000Z'),
    /layer and scheme code disagree/);
});

test('queryUrl and metadataUrl construct expected ArcGIS REST endpoints', () => {
  const zoneLayer = layers.find(l => l.kind === 'zone')!;
  const metaUrl = metadataUrl(zoneLayer);
  assert.equal(metaUrl.pathname, '/P744lA0wf4LlBZ84/ArcGIS/rest/services/Vicmap_Planning/FeatureServer/3');
  assert.equal(metaUrl.searchParams.get('f'), 'pjson');

  const qUrl = queryUrl(zoneLayer, { where: `lga='${LGA_NAME}'`, returnIdsOnly: 'true', f: 'json' });
  assert.equal(qUrl.pathname, '/P744lA0wf4LlBZ84/ArcGIS/rest/services/Vicmap_Planning/FeatureServer/3/query');
  assert.equal(qUrl.searchParams.get('where'), "lga='MELBOURNE'");
  assert.equal(qUrl.searchParams.get('returnIdsOnly'), 'true');
  assert.equal(qUrl.searchParams.get('f'), 'json');
});

test('VicmapPlanningConnector.collect executes end-to-end collection over both layers', async () => {
  const fixture = await loadFixture();

  class MockVicmapClient extends HttpClient {
    override async getJson<T>(request: Parameters<HttpClient['getJson']>[0]): Promise<HttpResponse<T>> {
      const url = new URL(request.url);
      const pathname = url.pathname;

      // Overlay layer (id 2)
      if (pathname.endsWith('/2')) {
        return { body: fixture.overlay.metadata as T, status: 200, fetchedAt, etag: null, lastModified: null, contentType: 'application/json' };
      }
      if (pathname.endsWith('/2/query')) {
        if (url.searchParams.get('returnIdsOnly') === 'true') {
          return { body: fixture.overlay.ids as T, status: 200, fetchedAt, etag: null, lastModified: null, contentType: 'application/json' };
        }
        return { body: fixture.overlay.collection as T, status: 200, fetchedAt, etag: null, lastModified: null, contentType: 'application/json' };
      }

      // Zone layer (id 3)
      if (pathname.endsWith('/3')) {
        return { body: fixture.zone.metadata as T, status: 200, fetchedAt, etag: null, lastModified: null, contentType: 'application/json' };
      }
      if (pathname.endsWith('/3/query')) {
        if (url.searchParams.get('returnIdsOnly') === 'true') {
          return { body: fixture.zone.ids as T, status: 200, fetchedAt, etag: null, lastModified: null, contentType: 'application/json' };
        }
        return { body: fixture.zone.collection as T, status: 200, fetchedAt, etag: null, lastModified: null, contentType: 'application/json' };
      }

      throw new Error(`Unexpected request URL: ${request.url.toString()}`);
    }
  }

  const connector = new VicmapPlanningConnector(new MockVicmapClient());
  const result = await connector.collect(input);

  assert.equal(result.kind, 'success');
  if (result.kind === 'success') {
    assert.equal(result.sourceId, SOURCE_ID);
    assert.equal(result.completeness.complete, true);
    assert.equal(result.completeness.method, 'export_count');
    assert.equal(result.completeness.expected_records, 2);
    assert.equal(result.completeness.fetched_records, 2);

    // 1 zone control + 1 overlay control = 2 source records
    assert.equal(result.sourceRecords.length, 2);
    for (const record of result.sourceRecords) {
      assert.equal(record.source_id, SOURCE_ID);
      assert.equal(record.rights_status, 'review_required');
      assert.equal(record.assertion_kind, 'plan');
      assert.doesNotThrow(() => parseSourceRecord(record));
    }

    // 1 single-polygon zone + 2 multi-polygon overlay parts = 3 geo records
    assert.equal(result.geoRecords.length, 3);
    for (const geo of result.geoRecords) {
      assert.equal(geo.topic, 'planning');
      assert.equal(geo.assertion_kind, 'plan');
      assert.equal(geo.rights_status, 'review_required');
      assert.equal(geo.public_query_allowed, false);
      const validation = validateGeoRecordGeography(geo);
      assert.equal(validation.valid, true);
    }

    assert.equal(result.geoRecordSources.length, 3);
    assert.ok(result.sourceRevision);
    assert.equal(result.sourceRevision.length, 64); // sha256 hex
    assert.equal(result.sourceLatestUpdateAt, '2024-03-31T00:00:00.000Z');
  }
});

test('VicmapPlanningConnector.collect detects layer change during collection and fails closed', async () => {
  const fixture = await loadFixture();
  let callCount = 0;

  class ChangingVicmapClient extends HttpClient {
    override async getJson<T>(request: Parameters<HttpClient['getJson']>[0]): Promise<HttpResponse<T>> {
      const url = new URL(request.url);
      const pathname = url.pathname;

      if (pathname.endsWith('/2')) {
        callCount += 1;
        // On second check of layer 2, simulate that upstream updated the edit timestamp
        const editDate = callCount === 1 ? 1711843200000 : 1711929600000;
        return {
          body: { ...fixture.overlay.metadata, editingInfo: { dataLastEditDate: editDate } } as T,
          status: 200, fetchedAt, etag: null, lastModified: null, contentType: 'application/json',
        };
      }
      if (pathname.endsWith('/2/query')) {
        if (url.searchParams.get('returnIdsOnly') === 'true') {
          return { body: fixture.overlay.ids as T, status: 200, fetchedAt, etag: null, lastModified: null, contentType: 'application/json' };
        }
        return { body: fixture.overlay.collection as T, status: 200, fetchedAt, etag: null, lastModified: null, contentType: 'application/json' };
      }

      throw new Error(`Unexpected request URL: ${request.url.toString()}`);
    }
  }

  const connector = new VicmapPlanningConnector(new ChangingVicmapClient());
  const result = await connector.collect(input);

  assert.equal(result.kind, 'failure');
  if (result.kind === 'failure') {
    assert.equal(result.sourceId, SOURCE_ID);
    assert.equal(result.completeness.complete, false);
    assert.equal(result.message, 'Vicmap planning snapshot could not be validated');
  }
});

test('VicmapPlanningConnector.collect handles network or upstream HTTP failures', async () => {
  class FailingClient extends HttpClient {
    override async getJson<T>(): Promise<HttpResponse<T>> {
      throw new HttpFailure('upstream_unavailable', 503, 1);
    }
  }

  const connector = new VicmapPlanningConnector(new FailingClient());
  const result = await connector.collect(input);

  assert.equal(result.kind, 'failure');
  if (result.kind === 'failure') {
    assert.equal(result.code, 'upstream_unavailable');
    assert.equal(result.completeness.complete, false);
  }
});
