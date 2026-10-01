import { setTimeout as delay } from 'node:timers/promises';

import { z } from 'zod';

import type { Connector, ConnectorInput, ConnectorResult } from '../../core/connector.js';
import { HttpClient, HttpFailure } from '../../core/http.js';
import type { GeoRecord, GeoRecordSource, GeoRecordStatus, SourceRecord, SourceRecordStatus } from '../../core/types.js';
import { parseGeometryGeojson, type ValidGeometry } from '../../validation/geography.js';
import { sourceRecordId, sourceVersionId } from '../../validation/record.js';

export const SOURCE_ID = 'victoria.transport.road_planned';
export const LANDING_URL = 'https://opendata.transport.vic.gov.au/dataset/planned-disruptions-road';
export const API_URL = 'https://api.opendata.transport.vic.gov.au/opendata/roads/disruptions/planned/v1/';
export const PAGE_SIZE = 1000;
export const MAX_PAGES = 1000;
// The linked OpenAPI still says 10/minute while the landing page says 20/minute.
export const PAGE_DELAY_MS = 6100;
const NORMALIZATION_POLICY = 'documented-victorian-local-provider-status-v2';
const localClock = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Australia/Melbourne', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});

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
  rmaClass: optionalText,
  source: z.object({ sourceName: optionalText, sourceId: optionalText }).passthrough().nullish(),
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

/** The official resource dictionary specifies Victorian local time. */
export function parseVictorianTimestamp(value: string | null | undefined): string | null {
  if (value == null || value.trim() === '') return null;
  const text = value.trim();
  const local = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,3}))?$/.exec(text);
  if (local) {
    const instant = new Date(`${text}Z`);
    if (!Number.isFinite(instant.valueOf()) || instant.toISOString().slice(0, 19) !== local[1]) {
      throw new Error('Invalid offsetless timestamp');
    }
    const matches = [10, 11].map(hours => instant.valueOf() - hours * 3600_000)
      .filter(candidate => {
        const parts = localClock.formatToParts(new Date(candidate));
        const part = (type: Intl.DateTimeFormatPartTypes) =>
          parts.find(value => value.type === type)?.value;
        const roundTrip = `${part('year')}-${part('month')}-${part('day')}`
          + `T${part('hour')}:${part('minute')}:${part('second')}`;
        return roundTrip === local[1];
      });
    // A repeated hour has two candidates; a skipped hour has none.
    return matches.length === 1 && matches[0] !== undefined
      ? new Date(matches[0]).toISOString() : null;
  }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(text)
    || !z.iso.datetime({ offset: true }).safeParse(text).success) {
    throw new Error('Invalid offset timestamp');
  }
  return new Date(text).toISOString();
}

function hasUnresolvedLocalTime(value: string | null | undefined): boolean {
  return value != null && value.trim() !== '' && parseVictorianTimestamp(value) === null;
}

export function classifyPlannedStatus(status: string, start: string | null, fetchedAt: string): {
  sourceRecordStatus: SourceRecordStatus;
  geoRecordStatus: GeoRecordStatus;
} {
  const norm = status.trim().toLowerCase();
  if (norm === 'cancelled' || norm === 'canceled') {
    return { sourceRecordStatus: 'cancelled', geoRecordStatus: 'cancelled' };
  }
  if (norm === 'completed' || norm === 'resolved' || norm === 'inactive' || norm === 'closed') {
    return { sourceRecordStatus: 'active', geoRecordStatus: 'resolved' };
  }
  if (norm === 'pending') {
    return { sourceRecordStatus: 'active', geoRecordStatus: 'planned' };
  }
  if (norm === 'active') {
    return {
      sourceRecordStatus: 'active',
      geoRecordStatus: 'active',
    };
  }
  throw new Error(`Undocumented planned disruption status: ${status}`);
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
    geoRecordSources: GeoRecordSource[]; latestUpdate: string | null; sourceRevision: string;
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
    const updatedAt = parseVictorianTimestamp(p.lastUpdated);
    const start = parseVictorianTimestamp(p.duration?.start);
    const end = parseVictorianTimestamp(p.duration?.end);
    const localTimeUnresolved = [p.lastUpdated, p.duration?.start, p.duration?.end]
      .some(hasUnresolvedLocalTime);
    if (start !== null && end !== null && end < start) {
      throw new Error('Planned disruption ends before it starts');
    }
    const { sourceRecordStatus, geoRecordStatus } = classifyPlannedStatus(p.status, start, fetchedAt);
    if (updatedAt !== null && (latestUpdate === null || updatedAt > latestUpdate)) {
      latestUpdate = updatedAt;
    }
    const sourceId = sourceRecordId({ sourceId: SOURCE_ID, nativeId: p.id,
      originalUrl: LANDING_URL, sourceTime: null });
    const sourceVersion = sourceVersionId(updatedAt, {
      normalizationPolicy: NORMALIZATION_POLICY, feature,
    });
    const detail = JSON.stringify({ source_status: p.status, road: p.closedRoadName,
      start_intersection: p.startIntersectionRoadName,
      start_locality: p.startIntersectionLocality,
      end_intersection: p.endIntersectionRoadName,
      end_locality: p.endIntersectionLocality,
      local_government_area: p.localGovernmentArea,
      rma_class: p.rmaClass ?? null,
      event_type: p.eventType, event_subtype: p.eventSubType ?? p.eventSubtype,
      event_due_to: p.eventDueTo, description: p.description,
      impact: p.impact, duration: p.duration,
      source_last_updated: p.lastUpdated ?? null,
      source_timezone: 'Australia/Melbourne',
      timezone_status: localTimeUnresolved ? 'ambiguous_or_nonexistent_local_time'
        : 'documented_victorian_local_or_explicit_offset',
      validity_note: p.duration?.recurrences?.length
        ? 'Overall plan period; recurrence schedule determines impact times'
        : 'Overall plan period; traffic impact depends on source status' });
    sourceRecords.push({ batch_id: input.runId, source_id: SOURCE_ID, schema_version: 1,
      fetched_at: fetchedAt, source_record_id: sourceId, version_id: sourceVersion,
      original_url: LANDING_URL, raw_uri: null, published_at: null,
      observed_at: null, first_accessible_at: fetchedAt,
      time_missing_reason: localTimeUnresolved
        ? 'Source creation time absent; ambiguous or nonexistent Victorian local time retained without an absolute instant'
        : 'Source does not provide an event creation time',
      valid_from: start, valid_to: end, source_updated_at: updatedAt,
      source_version_ordinal: null, record_status: sourceRecordStatus, assertion_kind: 'plan',
      rights_status: 'review_required' });
    const geoms = geometriesFor(feature);
    for (const [index, geometry] of geoms.entries()) {
      const geoId = sourceRecordId({ sourceId: SOURCE_ID,
        nativeId: `${p.id}:geometry:${index + 1}`, originalUrl: LANDING_URL,
        sourceTime: null });
      const geoVersion = sourceVersionId(updatedAt, { sourceVersion, index, geometry });
      const point = geometry?.type === 'Point' ? geometry.coordinates : null;
      geoRecords.push({ batch_id: input.runId, source_id: SOURCE_ID, schema_version: 1,
        fetched_at: fetchedAt, geo_record_id: geoId, version_id: geoVersion,
        topic: 'road_disruption', assertion_kind: 'plan',
        title: p.closedRoadName ? `Planned disruption: ${p.closedRoadName}`
          : p.eventType ? `Planned disruption: ${p.eventType}`
          : 'Planned road disruption', summary: detail, original_url: LANDING_URL,
        geometry_geojson: geometry === null ? null : JSON.stringify(geometry),
        centroid_lon: point?.[0] ?? null, centroid_lat: point?.[1] ?? null,
        location_role: geometry === null ? 'unknown' : 'event_site',
        location_confidence: geometry === null ? 'unverified' : 'source_coordinate',
        area_refs: [], published_at: null, observed_at: null,
        valid_from: start, valid_to: end, source_updated_at: updatedAt,
        source_version_ordinal: null, freshness_state: 'unknown',
        record_status: geoRecordStatus, rights_status: 'review_required',
        public_query_allowed: false });
      geoRecordSources.push({ batch_id: input.runId, source_id: SOURCE_ID,
        schema_version: 1, fetched_at: fetchedAt, geo_record_id: geoId,
        version_id: geoVersion, source_record_id: sourceId,
        source_version_id: sourceVersion, evidence_role: 'planned_disruption',
        original_url: LANDING_URL });
    }
  }
  const canonicalMembership = geoRecords.map(row => [row.geo_record_id, row.version_id])
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  const snapshotId = sourceRecordId({ sourceId: SOURCE_ID, nativeId: `snapshot:${fetchedAt}`,
    originalUrl: LANDING_URL, sourceTime: null });
  const snapshotVersion = sourceVersionId(null, { policy: 'complete-road-snapshot-v1',
    canonicalMembership });
  sourceRecords.push({ batch_id: input.runId, source_id: SOURCE_ID, schema_version: 1,
    fetched_at: fetchedAt, source_record_id: snapshotId, version_id: snapshotVersion,
    original_url: LANDING_URL, raw_uri: null, published_at: null, observed_at: null,
    first_accessible_at: fetchedAt,
    time_missing_reason: 'Complete fetch snapshot membership; fetch time is not event time',
    valid_from: null, valid_to: null, source_updated_at: null, source_version_ordinal: null,
    record_status: 'active', assertion_kind: 'observation', rights_status: 'review_required' });
  for (const row of geoRecords) {
    geoRecordSources.push({ batch_id: input.runId, source_id: SOURCE_ID, schema_version: 1,
      fetched_at: fetchedAt, geo_record_id: row.geo_record_id, version_id: row.version_id,
      source_record_id: snapshotId, source_version_id: snapshotVersion,
      evidence_role: 'road_snapshot_membership', original_url: LANDING_URL });
  }
  return { sourceRecords, geoRecords, geoRecordSources, latestUpdate,
    sourceRevision: sourceVersionId(null, { normalizationPolicy: NORMALIZATION_POLICY,
      snapshotId, snapshotVersion,
      features: [...features].sort((a, b) => a.properties.id.localeCompare(b.properties.id)) }) };
}

export class PlannedRoadConnector implements Connector {
  readonly sourceId = SOURCE_ID;
  constructor(private readonly client = new HttpClient(),
    private readonly keyProvider: () => string | undefined = () => process.env.TRANSPORT_VICTORIA_KEY_ID,
    private readonly pageDelayMs = PAGE_DELAY_MS) {}

  async collect(input: ConnectorInput): Promise<ConnectorResult> {
    if (input.sourceId !== SOURCE_ID) return failure(input, 'validation_failed');
    const key = this.keyProvider()?.trim();
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
          redirect: 'error', timeoutMs: 25000, maxAttempts: 1 });
        const parsed = parsePlannedRoadPage(response.body);
        fetchedAt = response.fetchedAt;
        fetchedPages = page;
        if (format !== null && format !== parsed.kind) return failure(input, 'schema_changed');
        format = parsed.kind;
        if (parsed.kind === 'numbered') {
          const { meta, data } = parsed.body;
          if (meta.page !== page || meta.count !== data.features.length
            || meta.total_pages > MAX_PAGES
            || (meta.total_records === 0 && (meta.total_pages > 1 || meta.count !== 0))
            || (meta.total_records > 0 && (meta.total_pages === 0 || meta.count === 0))
            || (meta.total_pages > 0 && page > meta.total_pages)
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
          if (parsed.body.features.length === 0 || !details.nextPageToken?.trim()
            || seenTokens.has(details.nextPageToken)) {
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
        fetchedAt, sourceRevision: normalized.sourceRevision,
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
