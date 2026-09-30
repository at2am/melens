import { setTimeout as delay } from 'node:timers/promises';

import { z } from 'zod';

import type { Connector, ConnectorInput, ConnectorResult } from '../../core/connector.js';
import { HttpClient, HttpFailure } from '../../core/http.js';
import type { GeoRecord, GeoRecordSource, SourceRecord } from '../../core/types.js';
import { parseGeometryGeojson, type ValidGeometry } from '../../validation/geography.js';
import { sourceRecordId, sourceVersionId } from '../../validation/record.js';

const SOURCE_ID = 'victoria.transport.road_planned';
const LANDING_URL = 'https://opendata.transport.vic.gov.au/dataset/planned-disruptions-road';
const API_URL = 'https://api.opendata.transport.vic.gov.au/opendata/roads/disruptions/planned/v1/';
const PAGE_SIZE = 1000;
const MAX_PAGES = 1000;
// The linked OpenAPI still says 10/minute while the landing page says 20/minute.
const PAGE_DELAY_MS = 6100;

const optionalText = z.string().nullish();
const recurrenceSchema = z.object({
  startDay: optionalText,
  daysDuration: z.number().int().min(1).max(7).nullish(),
  startTime: optionalText,
  duration: optionalText,
  allDay: z.boolean().nullish(),
}).passthrough();
const propertiesSchema = z.object({
  id: z.string().trim().min(1),
  status: z.string().trim().min(1),
  closedRoadName: optionalText,
  startIntersectionRoadName: optionalText,
  startIntersectionLocality: optionalText,
  endIntersectionRoadName: optionalText,
  endIntersectionLocality: optionalText,
  localGovernmentArea: optionalText,
  eventType: optionalText,
  eventSubType: optionalText,
  eventSubtype: optionalText,
  eventDueTo: optionalText,
  description: optionalText,
  lastUpdated: optionalText,
  impact: z.object({ direction: optionalText, impactType: optionalText,
    delay: optionalText, numberLanesImpacted: optionalText,
    speedLimitOnSite: optionalText }).passthrough().nullish(),
  duration: z.object({ start: optionalText, end: optionalText,
    recurrences: z.array(recurrenceSchema).nullish() }).passthrough().nullish(),
}).passthrough();
const featureSchema = z.object({
  type: z.literal('Feature'),
  geometry: z.unknown(),
  properties: propertiesSchema,
}).passthrough();
const modernPageSchema = z.object({
  meta: z.object({ total_records: z.number().int().nonnegative(),
    total_pages: z.number().int().nonnegative(), page: z.number().int().positive(),
    count: z.number().int().nonnegative() }).passthrough(),
  data: z.object({ type: z.literal('FeatureCollection'),
    features: z.array(featureSchema) }).passthrough(),
}).passthrough();
const tokenPageSchema = z.object({
  type: z.literal('FeatureCollection'),
  features: z.array(featureSchema),
  nextPageDetails: z.object({ hasMoreRecords: z.boolean(),
    nextPageToken: z.string().nullish() }).passthrough(),
}).passthrough();

type RoadFeature = z.infer<typeof featureSchema>;
type RoadPage = { kind: 'numbered'; body: z.infer<typeof modernPageSchema> }
  | { kind: 'token'; body: z.infer<typeof tokenPageSchema> };

export function parsePlannedRoadPage(value: unknown): RoadPage {
  const modern = modernPageSchema.safeParse(value);
  if (modern.success) return { kind: 'numbered', body: modern.data };
  return { kind: 'token', body: tokenPageSchema.parse(value) };
}

/** The documented timestamps have Victorian local time but may lack an offset. */
export function parseVictorianTimestamp(value: string | null | undefined): string | null {
  if (value == null || value.trim() === '') return null;
  const text = value.trim();
  if (/Z$|[+-]\d{2}:\d{2}$/.test(text)) {
    const parsed = Date.parse(text);
    if (!Number.isFinite(parsed)) throw new Error('Invalid offset timestamp');
    return new Date(parsed).toISOString();
  }
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/.exec(text);
  if (!parts) throw new Error('Invalid Victorian local timestamp');
  const [, year, month, day, hour, minute, second, fraction] = parts;
  const local = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour),
    Number(minute), Number(second), Number((fraction ?? '').padEnd(3, '0')));
  const formatter = new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Melbourne',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit',
    minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  const target = `${year}-${month}-${day}T${hour}:${minute}:${second}`;
  const matches = [10, 11].map(offset => new Date(local - offset * 3600000))
    .filter(candidate => {
      const formatted = Object.fromEntries(formatter.formatToParts(candidate)
        .map(part => [part.type, part.value]));
      return `${formatted.year}-${formatted.month}-${formatted.day}T${formatted.hour}:` +
        `${formatted.minute}:${formatted.second}` === target;
    });
  if (matches.length !== 1) throw new Error('Ambiguous or invalid Victorian local timestamp');
  return matches[0]?.toISOString() ?? null;
}

function geometriesFor(feature: RoadFeature): Array<ValidGeometry | null> {
  if (feature.geometry == null) return [null];
  const raw = feature.geometry;
  if (typeof raw === 'object' && raw !== null && 'type' in raw
    && raw.type === 'GeometryCollection' && 'geometries' in raw
    && Array.isArray(raw.geometries)) {
    return raw.geometries.length === 0 ? [null]
      : raw.geometries.map(value => parseGeometryGeojson(JSON.stringify(value)));
  }
  return [parseGeometryGeojson(JSON.stringify(raw))];
}

function failure(input: ConnectorInput, code: 'rate_limited' | 'upstream_unavailable'
  | 'schema_changed' | 'auth_failed' | 'incomplete_window' | 'validation_failed',
  retryAfterSeconds: number | null = null): ConnectorResult {
  return { kind: 'failure', sourceId: SOURCE_ID, runId: input.runId,
    checkedAt: new Date().toISOString(), code,
    message: 'Planned road snapshot could not be validated', retryAfterSeconds,
    completeness: { complete: false, expected_records: null, fetched_records: 0,
      expected_pages: null, fetched_pages: 0,
      evidence: 'Every numbered page or token page must be complete, unique, and schema-valid' },
    sourceLatestUpdateAt: null };
}

export function normalizePlannedRoadSnapshot(features: readonly RoadFeature[],
  input: ConnectorInput, fetchedAt: string): {
    sourceRecords: SourceRecord[]; geoRecords: GeoRecord[];
    geoRecordSources: GeoRecordSource[]; latestUpdate: string | null;
  } {
  const sourceRecords: SourceRecord[] = [];
  const geoRecords: GeoRecord[] = [];
  const geoRecordSources: GeoRecordSource[] = [];
  const seen = new Set<string>();
  let latestUpdate: string | null = null;
  for (const feature of features) {
    const p = feature.properties;
    if (seen.has(p.id)) throw new Error('Duplicate planned disruption ID');
    seen.add(p.id);
    if (p.status !== 'Pending' && p.status !== 'Active') {
      throw new Error('Undocumented planned disruption status');
    }
    const updatedAt = parseVictorianTimestamp(p.lastUpdated);
    const start = parseVictorianTimestamp(p.duration?.start);
    const end = parseVictorianTimestamp(p.duration?.end);
    if (start !== null && end !== null && end < start) {
      throw new Error('Planned disruption ends before it starts');
    }
    if (updatedAt !== null && (latestUpdate === null || updatedAt > latestUpdate)) {
      latestUpdate = updatedAt;
    }
    const sourceId = sourceRecordId({ sourceId: SOURCE_ID, nativeId: p.id,
      originalUrl: LANDING_URL, sourceTime: null });
    const sourceVersion = sourceVersionId(updatedAt, feature);
    const detail = JSON.stringify({ source_status: p.status, road: p.closedRoadName,
      start_intersection: p.startIntersectionRoadName,
      start_locality: p.startIntersectionLocality,
      end_intersection: p.endIntersectionRoadName,
      end_locality: p.endIntersectionLocality,
      local_government_area: p.localGovernmentArea,
      event_type: p.eventType, event_subtype: p.eventSubType ?? p.eventSubtype,
      event_due_to: p.eventDueTo, description: p.description,
      impact: p.impact, duration: p.duration,
      validity_note: p.duration?.recurrences?.length
        ? 'Overall plan period; recurrence schedule determines impact times'
        : 'Overall plan period; traffic impact depends on source status' });
    sourceRecords.push({ batch_id: input.runId, source_id: SOURCE_ID, schema_version: 1,
      fetched_at: fetchedAt, source_record_id: sourceId, version_id: sourceVersion,
      original_url: LANDING_URL, raw_uri: null, published_at: null,
      observed_at: null, first_accessible_at: fetchedAt,
      time_missing_reason: 'Source does not provide an event creation time',
      valid_from: start, valid_to: end, source_updated_at: updatedAt,
      source_version_ordinal: null, record_status: 'active', assertion_kind: 'plan',
      rights_status: 'review_required' });
    const geoms = geometriesFor(feature);
    for (const [index, geometry] of geoms.entries()) {
      const geoId = sourceRecordId({ sourceId: SOURCE_ID,
        nativeId: `${p.id}:geometry:${index + 1}`, originalUrl: LANDING_URL,
        sourceTime: null });
      const geoVersion = sourceVersionId(updatedAt, { sourceVersion, index, geometry });
      const point = geometry?.type === 'Point' ? geometry.coordinates : null;
      const recordStatus = p.status === 'Pending' || (start !== null && start > fetchedAt)
        ? 'planned' : 'active';
      geoRecords.push({ batch_id: input.runId, source_id: SOURCE_ID, schema_version: 1,
        fetched_at: fetchedAt, geo_record_id: geoId, version_id: geoVersion,
        topic: 'road_disruption', assertion_kind: 'plan',
        title: p.closedRoadName ? `Planned disruption: ${p.closedRoadName}`
          : 'Planned road disruption', summary: detail, original_url: LANDING_URL,
        geometry_geojson: geometry === null ? null : JSON.stringify(geometry),
        centroid_lon: point?.[0] ?? null, centroid_lat: point?.[1] ?? null,
        location_role: geometry === null ? 'unknown' : 'event_site',
        location_confidence: geometry === null ? 'unverified' : 'source_coordinate',
        area_refs: [], published_at: null, observed_at: null,
        valid_from: start, valid_to: end, source_updated_at: updatedAt,
        source_version_ordinal: null, freshness_state: 'unknown',
        record_status: recordStatus, rights_status: 'review_required',
        public_query_allowed: false });
      geoRecordSources.push({ batch_id: input.runId, source_id: SOURCE_ID,
        schema_version: 1, fetched_at: fetchedAt, geo_record_id: geoId,
        version_id: geoVersion, source_record_id: sourceId,
        source_version_id: sourceVersion, evidence_role: 'planned_disruption',
        original_url: LANDING_URL });
    }
  }
  return { sourceRecords, geoRecords, geoRecordSources, latestUpdate };
}

export class PlannedRoadConnector implements Connector {
  readonly sourceId = SOURCE_ID;
  constructor(private readonly client = new HttpClient(),
    private readonly keyProvider: () => string | undefined = () => process.env.TRANSPORT_VICTORIA_KEY_ID,
    private readonly pageDelayMs = PAGE_DELAY_MS) {}

  async collect(input: ConnectorInput): Promise<ConnectorResult> {
    if (input.sourceId !== SOURCE_ID) return failure(input, 'validation_failed');
    const key = this.keyProvider();
    if (!key) return failure(input, 'auth_failed');
    try {
      const features: RoadFeature[] = [];
      let fetchedAt = new Date().toISOString();
      let expectedRecords: number | null = null;
      let expectedPages: number | null = null;
      let format: RoadPage['kind'] | null = null;
      let nextToken: string | null = null;
      const seenTokens = new Set<string>();
      let fetchedPages = 0;
      for (let page = 1; page <= MAX_PAGES; page += 1) {
        if (page > 1 && this.pageDelayMs > 0) await delay(this.pageDelayMs);
        const url = new URL(API_URL);
        url.searchParams.set('format', 'GeoJson');
        url.searchParams.set('page', String(page));
        url.searchParams.set('limit', String(PAGE_SIZE));
        const response = await this.client.getJson({ url,
          headers: { KeyID: key, ...(nextToken === null ? {} : { NextPageToken: nextToken }) },
          timeoutMs: 25000, maxAttempts: 3 });
        const parsed = parsePlannedRoadPage(response.body);
        fetchedAt = response.fetchedAt;
        fetchedPages = page;
        if (format !== null && format !== parsed.kind) return failure(input, 'schema_changed');
        format = parsed.kind;
        if (parsed.kind === 'numbered') {
          const { meta, data } = parsed.body;
          if (meta.page !== page || meta.count !== data.features.length
            || (expectedRecords !== null && meta.total_records !== expectedRecords)
            || (expectedPages !== null && meta.total_pages !== expectedPages)) {
            return failure(input, 'incomplete_window');
          }
          expectedRecords = meta.total_records;
          expectedPages = meta.total_pages;
          features.push(...data.features);
          if (page >= Math.max(1, meta.total_pages)) break;
        } else {
          features.push(...parsed.body.features);
          const details = parsed.body.nextPageDetails;
          if (!details.hasMoreRecords) break;
          if (!details.nextPageToken || seenTokens.has(details.nextPageToken)) {
            return failure(input, 'incomplete_window');
          }
          nextToken = details.nextPageToken;
          seenTokens.add(nextToken);
        }
        if (page === MAX_PAGES) return failure(input, 'incomplete_window');
      }
      if (expectedRecords !== null && features.length !== expectedRecords) {
        return failure(input, 'incomplete_window');
      }
      const normalized = normalizePlannedRoadSnapshot(features, input, fetchedAt);
      return { kind: 'success', sourceId: SOURCE_ID, runId: input.runId,
        fetchedAt, sourceRevision: normalized.latestUpdate,
        sourceLatestUpdateAt: normalized.latestUpdate,
        checkpointAfter: input.window.kind === 'time' ? input.window.to : input.window.revision,
        completeness: { complete: true, method: 'pagination',
          expected_records: expectedRecords, fetched_records: features.length,
          expected_pages: expectedPages, fetched_pages: fetchedPages,
          evidence: format === 'numbered'
            ? 'All numbered pages agreed on totals and unique event IDs'
            : 'Token chain ended with hasMoreRecords=false and unique event IDs' },
        inputCount: features.length, outputCount: normalized.sourceRecords.length,
        rejectedCount: 0, sourceRecords: normalized.sourceRecords,
        geoRecords: normalized.geoRecords,
        geoRecordSources: normalized.geoRecordSources,
        boundaries: [], areaIndicators: [], parkingBays: [], parkingObservations: [],
        parkingRules: [], sensorLocations: [], pedestrianObservations: [],
        retainableRawRecords: null };
    } catch (error) {
      const code = error instanceof HttpFailure ? error.code
        : error instanceof z.ZodError ? 'schema_changed' : 'validation_failed';
      const retryAfterSeconds = error instanceof HttpFailure && error.retryAfterMs !== null
        ? Math.ceil(error.retryAfterMs / 1000) : null;
      return failure(input, code, retryAfterSeconds);
    }
  }
}

export const connector: Connector = new PlannedRoadConnector();
