import { createHash } from 'node:crypto';

import { z } from 'zod';

import type { Connector, ConnectorInput, ConnectorResult } from '../../core/connector.js';
import { HttpClient, HttpFailure } from '../../core/http.js';
import type { Boundary, SourceRecord } from '../../core/types.js';
import { parseBoundaryGeometry } from '../../validation/geography.js';
import { sourceRecordId, sourceVersionId } from '../../validation/record.js';

const SOURCE_ID = 'abs.asgs.boundaries';
const LANDING_URL = 'https://www.abs.gov.au/statistics/standards/australian-statistical-geography-standard-asgs/edition-4-july-2026-june-2031/access-and-downloads/geospatial-web-services';

interface Layer {
  edition: '2021' | '2025' | '2026';
  service: 'GCCSA' | 'STE' | 'LGA' | 'SA2';
  scheme: string;
  where: string;
  code: string;
  name: string;
  vintage: string;
  validFrom: string;
  validTo: string | null;
}

function layersFor(revision: '2021' | '2026'): readonly Layer[] {
  if (revision === '2021') return [
    { edition: '2021', service: 'GCCSA', scheme: 'ASGS_GCCSA', where: "gccsa_code_2021='2GMEL'", code: 'gccsa_code_2021', name: 'gccsa_name_2021', vintage: '2021', validFrom: '2021-07-01T00:00:00Z', validTo: '2026-07-01T00:00:00Z' },
    { edition: '2021', service: 'STE', scheme: 'ASGS_STE', where: "state_code_2021='2'", code: 'state_code_2021', name: 'state_name_2021', vintage: '2021', validFrom: '2021-07-01T00:00:00Z', validTo: '2026-07-01T00:00:00Z' },
    { edition: '2021', service: 'LGA', scheme: 'ASGS_LGA', where: "state_code_2021='2'", code: 'lga_code_2021', name: 'lga_name_2021', vintage: '2021', validFrom: '2021-07-01T00:00:00Z', validTo: '2022-07-01T00:00:00Z' },
    { edition: '2021', service: 'SA2', scheme: 'ASGS_SA2', where: "gccsa_code_2021='2GMEL'", code: 'sa2_code_2021', name: 'sa2_name_2021', vintage: '2021', validFrom: '2021-07-01T00:00:00Z', validTo: '2026-07-01T00:00:00Z' },
  ];
  return [
    { edition: '2026', service: 'GCCSA', scheme: 'ASGS_GCCSA', where: "gccsa_code_2026='2GMEL'", code: 'gccsa_code_2026', name: 'gccsa_name_2026', vintage: '2026', validFrom: '2026-07-01T00:00:00Z', validTo: '2031-07-01T00:00:00Z' },
    { edition: '2026', service: 'STE', scheme: 'ASGS_STE', where: "state_code_2026='2'", code: 'state_code_2026', name: 'state_name_2026', vintage: '2026', validFrom: '2026-07-01T00:00:00Z', validTo: '2031-07-01T00:00:00Z' },
    { edition: '2025', service: 'LGA', scheme: 'ASGS_LGA', where: "state_code_2021='2'", code: 'lga_code_2025', name: 'lga_name_2025', vintage: '2025', validFrom: '2025-07-01T00:00:00Z', validTo: null },
    { edition: '2026', service: 'SA2', scheme: 'ASGS_SA2', where: "gccsa_code_2026='2GMEL'", code: 'sa2_code_2026', name: 'sa2_name_2026', vintage: '2026', validFrom: '2026-07-01T00:00:00Z', validTo: '2031-07-01T00:00:00Z' },
  ];
}

const idsSchema = z.object({ objectIdFieldName: z.string(), objectIds: z.array(z.number().int().nonnegative()) });
const collectionSchema = z.object({
  type: z.literal('FeatureCollection'),
  features: z.array(z.object({
    type: z.literal('Feature'),
    properties: z.record(z.string(), z.unknown()),
    geometry: z.unknown(),
  })),
});

function property(properties: Record<string, unknown>, field: string): unknown {
  const key = Object.keys(properties).find(candidate => candidate.toLowerCase() === field.toLowerCase());
  if (key === undefined) throw new Error(`ABS field missing: ${field}`);
  return properties[key];
}

function queryUrl(layer: Layer, params: Readonly<Record<string, string>>): URL {
  const url = new URL(`https://geo.abs.gov.au/arcgis/rest/services/ASGS${layer.edition}/${layer.service}/MapServer/0/query`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url;
}

export async function collectLayer(http: HttpClient, layer: Layer, runId: string): Promise<{
  records: SourceRecord[];
  boundaries: Boundary[];
  expected: number;
  pages: number;
  fetchedAt: string;
}> {
  const idResponse = await http.getJson({ url: queryUrl(layer, {
    where: layer.where, returnIdsOnly: 'true', f: 'json',
  }), timeoutMs: 30_000 });
  const listed = idsSchema.parse(idResponse.body);
  if (listed.objectIdFieldName.toLowerCase() !== 'objectid') throw new Error('Unexpected ABS object ID field');
  const ids = [...new Set(listed.objectIds)].sort((a, b) => a - b);
  if (ids.length === 0 || ids.length !== listed.objectIds.length) throw new Error('Missing or repeated ABS IDs');
  const records: SourceRecord[] = [];
  const boundaries: Boundary[] = [];
  let fetchedAt = idResponse.fetchedAt;
  let pages = 0;
  const seenIds = new Set<number>();
  for (let start = 0; start < ids.length; start += 20) {
    const chunk = ids.slice(start, start + 20);
    const response = await http.getJson({ url: queryUrl(layer, {
      objectIds: chunk.join(','), outFields: `objectid,${layer.code},${layer.name}`,
      outSR: '4326', f: 'geojson',
    }), timeoutMs: 60_000 });
    fetchedAt = response.fetchedAt;
    pages += 1;
    const collection = collectionSchema.parse(response.body);
    if (collection.features.length !== chunk.length) throw new Error('ABS page is incomplete');
    for (const feature of collection.features) {
      const objectId = z.number().int().parse(property(feature.properties, 'objectid'));
      if (!chunk.includes(objectId) || seenIds.has(objectId)) throw new Error('ABS page has unexpected or duplicate ID');
      seenIds.add(objectId);
      const code = z.string().min(1).parse(property(feature.properties, layer.code));
      const name = z.string().min(1).parse(property(feature.properties, layer.name));
      const geometry = feature.geometry === null ? null : parseBoundaryGeometry(feature.geometry);
      const versionId = sourceVersionId(null, { code, name, geometry });
      const sourceId = sourceRecordId({ sourceId: SOURCE_ID,
        nativeId: `${layer.scheme}:${code}:${layer.vintage}`, originalUrl: LANDING_URL, sourceTime: null });
      records.push({
        batch_id: runId, source_id: SOURCE_ID, schema_version: 1,
        fetched_at: fetchedAt, source_record_id: sourceId, version_id: versionId,
        original_url: LANDING_URL, raw_uri: null, published_at: null, observed_at: null,
        first_accessible_at: null,
        time_missing_reason: 'The ASGS feature service does not expose a per-boundary publication timestamp',
        valid_from: null, valid_to: null, source_updated_at: null,
        source_version_ordinal: null, record_status: 'active',
        assertion_kind: 'observation', rights_status: 'verified_open',
      });
      if (geometry !== null) boundaries.push({
        batch_id: runId, source_id: SOURCE_ID, schema_version: 1,
        fetched_at: fetchedAt, boundary_id: `${layer.scheme}:${code}:${layer.vintage}`,
        version_id: versionId, scheme: layer.scheme, code, name, vintage: layer.vintage,
        geometry_geojson: JSON.stringify(geometry), valid_from: layer.validFrom,
        valid_to: layer.validTo, source_record_id: sourceId,
      });
    }
  }
  if (seenIds.size !== ids.length) throw new Error('ABS layer is incomplete');
  return { records, boundaries, expected: ids.length, pages, fetchedAt };
}

export const connector: Connector = {
  sourceId: SOURCE_ID,
  async collect(input: ConnectorInput): Promise<ConnectorResult> {
    const checkedAt = new Date().toISOString();
    if (input.window.kind === 'snapshot' && !['2021', '2026'].includes(input.window.revision)) {
      return { kind: 'failure', sourceId: SOURCE_ID, runId: input.runId, checkedAt,
        code: 'validation_failed', message: 'This connector supports ASGS 2021 or 2026 snapshots',
        retryAfterSeconds: null, sourceLatestUpdateAt: null,
        completeness: { complete: false, expected_records: null, fetched_records: 0,
          expected_pages: null, fetched_pages: 0, evidence: 'Unsupported ASGS vintage' } };
    }
    try {
      const http = new HttpClient();
      const parts = [];
      const revision: '2021' | '2026' = input.window.kind === 'snapshot'
        && input.window.revision === '2021' ? '2021' : '2026';
      for (const layer of layersFor(revision)) {
        parts.push(await collectLayer(http, layer, input.runId));
      }
      const sourceRecords = parts.flatMap(part => part.records);
      const boundaries = parts.flatMap(part => part.boundaries);
      const expected = parts.reduce((sum, part) => sum + part.expected, 0);
      const pages = parts.reduce((sum, part) => sum + part.pages, 0);
      const sourceRevision = createHash('sha256').update(sourceRecords.map(row => row.version_id).sort().join('\n'))
        .digest('hex');
      const fetchedAt = parts.at(-1)?.fetchedAt ?? checkedAt;
      return { kind: 'success', sourceId: SOURCE_ID, runId: input.runId,
        fetchedAt, sourceRevision, sourceLatestUpdateAt: null,
        checkpointAfter: input.window.kind === 'time' ? input.window.to : null,
        completeness: { complete: true, method: 'feed_snapshot', expected_records: expected,
          fetched_records: sourceRecords.length, expected_pages: pages, fetched_pages: pages,
          evidence: 'All requested ABS ArcGIS object IDs were returned exactly once; non-spatial LGA codes retain source facts without boundaries' },
        inputCount: expected, outputCount: boundaries.length,
        rejectedCount: sourceRecords.length - boundaries.length,
        sourceRecords, geoRecords: [], geoRecordSources: [], boundaries,
        areaIndicators: [], parkingBays: [], parkingObservations: [],
        parkingRules: [], sensorLocations: [], pedestrianObservations: [],
        retainableRawRecords: null };
    } catch (error) {
      const code = error instanceof HttpFailure ? error.code
        : error instanceof z.ZodError ? 'schema_changed' : 'incomplete_window';
      return { kind: 'failure', sourceId: SOURCE_ID, runId: input.runId, checkedAt,
        code, message: 'ASGS boundary snapshot is incomplete', retryAfterSeconds: null,
        sourceLatestUpdateAt: null,
        completeness: { complete: false, expected_records: null, fetched_records: 0,
          expected_pages: null, fetched_pages: 0, evidence: 'One or more official boundary layers failed validation' } };
    }
  },
};
