import { createHash } from 'node:crypto';

import { z } from 'zod';

import type { Connector, ConnectorInput, ConnectorResult } from '../../core/connector.js';
import { HttpClient, HttpFailure } from '../../core/http.js';
import type { GeoRecord, GeoRecordSource, SourceRecord } from '../../core/types.js';
import { parseBoundaryGeometry } from '../../validation/geography.js';
import { sourceRecordId, sourceVersionId } from '../../validation/record.js';

export const SOURCE_ID = 'victoria.vicmap.planning';
export const SERVICE_URL = 'https://services-ap1.arcgis.com/P744lA0wf4LlBZ84/ArcGIS/rest/services/Vicmap_Planning/FeatureServer';
export const LGA_NAME = 'MELBOURNE';
export const CHUNK_SIZE = 100;

export const layers = [
  { kind: 'overlay', id: 2, landingUrl: 'https://discover.data.vic.gov.au/dataset/vicmap-planning-planning-scheme-overlay-polygon' },
  { kind: 'zone', id: 3, landingUrl: 'https://discover.data.vic.gov.au/dataset/vicmap-planning-planning-scheme-zone-polygon' },
] as const;
export type Layer = (typeof layers)[number];

export const metadataSchema = z.object({
  id: z.number().int(),
  objectIdField: z.literal('OBJECTID'),
  editingInfo: z.object({ dataLastEditDate: z.number().int().nonnegative() }),
}).passthrough();

export const idsSchema = z.object({
  objectIdFieldName: z.literal('OBJECTID'),
  objectIds: z.array(z.number().int().nonnegative()),
}).passthrough();

export const featureSchema = z.object({
  type: z.literal('Feature'),
  properties: z.object({
    OBJECTID: z.number().int().nonnegative(),
    ufi: z.number().int().nonnegative(),
    scheme_code: z.string().trim().min(1),
    lga_code: z.string().trim().min(1),
    lga: z.string().trim().min(1),
    zone_num: z.number().int().nullable(),
    zone_status: z.string().nullable(),
    zone_code: z.string().trim().min(1),
    zone_description: z.string().trim().min(1),
    gaz_begin_date: z.number().int().nullable(),
  }).passthrough(),
  geometry: z.unknown(),
}).passthrough();

export const collectionSchema = z.object({
  type: z.literal('FeatureCollection'),
  features: z.array(featureSchema),
}).passthrough();

export type PlanningFeature = z.infer<typeof featureSchema>;
export type PlanningControl = {
  sourceRecord: SourceRecord;
  geoRecords: GeoRecord[];
  geoRecordSources: GeoRecordSource[];
};

export function epochUtc(value: number | null): string | null {
  if (value === null) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error('Invalid Vicmap date');
  return date.toISOString();
}

export function queryUrl(layer: Layer, params: Readonly<Record<string, string>>, serviceUrl: string = SERVICE_URL): URL {
  const url = new URL(`${serviceUrl}/${layer.id}/query`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url;
}

export function metadataUrl(layer: Layer, serviceUrl: string = SERVICE_URL): URL {
  return new URL(`${serviceUrl}/${layer.id}?f=pjson`);
}

export function splitPolygon(geometry: unknown): Array<{ type: 'Polygon'; coordinates: number[][][] }> {
  const parsed = parseBoundaryGeometry(geometry);
  if (parsed.type === 'Polygon') return [parsed];
  return parsed.coordinates.map(coordinates => ({ type: 'Polygon', coordinates }));
}

/** One current legal control may contain several disjoint polygons; keep one source fact for all parts. */
export function normalizePlanningControl(
  raw: unknown, layer: Layer, runId: string, fetchedAt: string, layerEditedAt: string,
): PlanningControl {
  const feature: PlanningFeature = featureSchema.parse(raw);
  const fields = feature.properties;
  if (fields.lga.toUpperCase() !== LGA_NAME || fields.lga_code !== '343') {
    throw new Error('Vicmap returned a planning control outside Melbourne LGA');
  }
  if (layer.kind === 'zone' ? fields.scheme_code !== 'ZN' : fields.scheme_code === 'ZN') {
    throw new Error('Vicmap planning layer and scheme code disagree');
  }
  const polygons = splitPolygon(feature.geometry);
  const effectiveFrom = epochUtc(fields.gaz_begin_date);
  const nativeKey = `${layer.kind}:${fields.ufi}`;
  const sourceId = sourceRecordId({ sourceId: SOURCE_ID, nativeId: nativeKey,
    originalUrl: layer.landingUrl, sourceTime: null });
  const versionId = sourceVersionId(layerEditedAt, {
    kind: layer.kind, objectId: fields.OBJECTID, ufi: fields.ufi, lgaCode: fields.lga_code,
    schemeCode: fields.scheme_code, zoneNumber: fields.zone_num,
    zoneStatus: fields.zone_status, zoneCode: fields.zone_code,
    zoneDescription: fields.zone_description, gazBeginDate: fields.gaz_begin_date,
    geometry: feature.geometry,
  });
  const provenance = { batch_id: runId, source_id: SOURCE_ID, schema_version: 1, fetched_at: fetchedAt };
  const sourceRecord: SourceRecord = {
    ...provenance, source_record_id: sourceId, version_id: versionId,
    original_url: layer.landingUrl, raw_uri: null,
    published_at: null, observed_at: null, first_accessible_at: null,
    time_missing_reason: 'The current planning layer has an edit time, not a per-feature publication time',
    valid_from: effectiveFrom, valid_to: null, source_updated_at: layerEditedAt,
    source_version_ordinal: null, record_status: 'active', assertion_kind: 'plan',
    rights_status: 'review_required',
  };
  const summary = JSON.stringify({
    control_kind: layer.kind,
    scheme_code: fields.scheme_code,
    lga_code: fields.lga_code,
    lga: fields.lga,
    control_number: fields.zone_num,
    control_status: fields.zone_status,
    control_code: fields.zone_code,
    control_description: fields.zone_description,
    gazette_effective_from: effectiveFrom,
    layer_edited_at: layerEditedAt,
  });
  const geoRecords = polygons.map((polygon, partIndex): GeoRecord => ({
    ...provenance,
    geo_record_id: `${sourceId}:part:${partIndex + 1}`,
    version_id: versionId,
    topic: 'planning', assertion_kind: 'plan',
    title: `${layer.kind === 'zone' ? 'Planning zone' : 'Planning overlay'} ${fields.zone_code}`,
    summary, original_url: layer.landingUrl,
    geometry_geojson: JSON.stringify(polygon), centroid_lat: null, centroid_lon: null,
    location_role: 'area_only', location_confidence: 'source_coordinate',
    area_refs: [`vicmap_lga:${fields.lga_code}`],
    published_at: null, observed_at: null,
    valid_from: effectiveFrom, valid_to: null,
    source_updated_at: layerEditedAt, source_version_ordinal: null,
    freshness_state: 'unknown', record_status: 'active',
    rights_status: 'review_required', public_query_allowed: false,
  }));
  const geoRecordSources = geoRecords.map((row): GeoRecordSource => ({
    ...provenance, geo_record_id: row.geo_record_id, version_id: row.version_id,
    source_record_id: sourceId, source_version_id: versionId,
    evidence_role: 'official_planning_control', original_url: layer.landingUrl,
  }));
  return { sourceRecord, geoRecords, geoRecordSources };
}

export class VicmapPlanningConnector implements Connector {
  readonly sourceId = SOURCE_ID;

  constructor(
    private readonly http: HttpClient = new HttpClient(),
    private readonly serviceUrl: string = SERVICE_URL,
    private readonly chunkSize: number = CHUNK_SIZE,
  ) {}

  async collect(input: ConnectorInput): Promise<ConnectorResult> {
    const checkedAt = new Date().toISOString();
    let expectedRecords = 0;
    let fetchedRecords = 0;
    let expectedPages = 0;
    let fetchedPages = 0;
    try {
      const sourceRecords: SourceRecord[] = [];
      const geoRecords: GeoRecord[] = [];
      const geoRecordSources: GeoRecordSource[] = [];
      const revisions: string[] = [];
      let fetchedAt = checkedAt;
      let sourceLatestUpdateAt: string | null = null;
      for (const layer of layers) {
        const before = metadataSchema.parse((await this.http.getJson({ url: metadataUrl(layer, this.serviceUrl) })).body);
        if (before.id !== layer.id) throw new Error('Unexpected Vicmap planning layer');
        const editedAt = epochUtc(before.editingInfo.dataLastEditDate);
        if (editedAt === null) throw new Error('Missing Vicmap layer version');
        const listResponse = await this.http.getJson({ url: queryUrl(layer, {
          where: `lga='${LGA_NAME}'`, returnIdsOnly: 'true', f: 'json',
        }, this.serviceUrl) });
        const listed = idsSchema.parse(listResponse.body);
        const ids = [...new Set(listed.objectIds)].sort((a, b) => a - b);
        if (ids.length === 0 || ids.length !== listed.objectIds.length) {
          throw new Error('Vicmap planning object ID list is empty or duplicated');
        }
        expectedRecords += ids.length;
        expectedPages += Math.ceil(ids.length / this.chunkSize);
        const seenIds = new Set<number>();
        const seenUfis = new Set<number>();
        for (let index = 0; index < ids.length; index += this.chunkSize) {
          const chunk = ids.slice(index, index + this.chunkSize);
          const page = await this.http.getJson({ url: queryUrl(layer, {
            objectIds: chunk.join(','), outFields: 'OBJECTID,ufi,scheme_code,lga_code,lga,zone_num,zone_status,zone_code,zone_description,gaz_begin_date',
            outSR: '4326', f: 'geojson',
          }, this.serviceUrl), timeoutMs: 60_000 });
          fetchedAt = page.fetchedAt;
          fetchedPages += 1;
          const collection = collectionSchema.parse(page.body);
          if (collection.features.length !== chunk.length) throw new Error('Vicmap planning page is incomplete');
          for (const feature of collection.features) {
            const objectId = feature.properties.OBJECTID;
            const ufi = feature.properties.ufi;
            if (!chunk.includes(objectId) || seenIds.has(objectId) || seenUfis.has(ufi)) {
              throw new Error('Vicmap planning page has an unexpected or duplicate ID');
            }
            seenIds.add(objectId);
            seenUfis.add(ufi);
            const normalized = normalizePlanningControl(feature, layer, input.runId, fetchedAt, editedAt);
            sourceRecords.push(normalized.sourceRecord);
            geoRecords.push(...normalized.geoRecords);
            geoRecordSources.push(...normalized.geoRecordSources);
            fetchedRecords += 1;
          }
        }
        if (seenIds.size !== ids.length) throw new Error('Vicmap planning layer is incomplete');
        const after = metadataSchema.parse((await this.http.getJson({ url: metadataUrl(layer, this.serviceUrl) })).body);
        if (after.id !== layer.id || after.editingInfo.dataLastEditDate !== before.editingInfo.dataLastEditDate) {
          throw new Error('Vicmap planning layer changed during collection');
        }
        revisions.push(`${layer.kind}:${editedAt}:${ids.length}`);
        if (sourceLatestUpdateAt === null || editedAt > sourceLatestUpdateAt) sourceLatestUpdateAt = editedAt;
      }
      const sourceRevision = createHash('sha256').update(revisions.join('\n')).digest('hex');
      return {
        kind: 'success', sourceId: SOURCE_ID, runId: input.runId,
        fetchedAt, sourceRevision, sourceLatestUpdateAt,
        checkpointAfter: input.window.kind === 'time' ? input.window.to : sourceRevision,
        completeness: { complete: true, method: 'export_count', expected_records: expectedRecords,
          fetched_records: fetchedRecords, expected_pages: expectedPages, fetched_pages: fetchedPages,
          evidence: 'Every object ID in both Melbourne LGA planning layers was fetched exactly once and layer edit times stayed unchanged' },
        inputCount: fetchedRecords, outputCount: geoRecords.length, rejectedCount: 0,
        sourceRecords, geoRecords, geoRecordSources,
        boundaries: [], areaIndicators: [], parkingBays: [], parkingObservations: [],
        parkingRules: [], sensorLocations: [], pedestrianObservations: [], retainableRawRecords: null,
      };
    } catch (error) {
      const code = error instanceof HttpFailure ? error.code
        : error instanceof z.ZodError ? 'schema_changed' : 'incomplete_window';
      return {
        kind: 'failure', sourceId: SOURCE_ID, runId: input.runId, checkedAt,
        code, message: 'Vicmap planning snapshot could not be validated', retryAfterSeconds: null,
        completeness: { complete: false, expected_records: expectedRecords || null,
          fetched_records: fetchedRecords, expected_pages: expectedPages || null,
          fetched_pages: fetchedPages, evidence: 'Both planning layers must be complete and remain at one release version' },
        sourceLatestUpdateAt: null,
      };
    }
  }
}

export const connector: Connector = new VicmapPlanningConnector();
export default connector;
