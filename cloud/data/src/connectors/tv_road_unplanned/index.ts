import { setTimeout as delay } from 'node:timers/promises';

import { z } from 'zod';

import type { Connector, ConnectorInput, ConnectorResult } from '../../core/connector.js';
import { HttpClient, HttpFailure } from '../../core/http.js';
import type { GeoRecord, GeoRecordSource, SourceRecord } from '../../core/types.js';
import { parseGeometryGeojson, type ValidGeometry } from '../../validation/geography.js';
import { sourceRecordId, sourceVersionId } from '../../validation/record.js';

const SOURCE_ID = 'victoria.transport.road_unplanned';
const LANDING_URL = 'https://opendata.transport.vic.gov.au/dataset/unplanned-disruptions-road';
const API_URL = 'https://api.opendata.transport.vic.gov.au/api/opendata/roads/disruptions/unplanned/v3';
const PAGE_SIZE = 100;
const PAGE_DELAY_MS = 3100; // Safely below the documented 20 calls per 60 seconds.

/** Only explicitly offset timestamps prove an absolute instant. */
export function parseVictorianTimestamp(value: string | null | undefined): string | null {
  if (value == null || value.trim() === '') return null;
  const text = value.trim();
  const local = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,3}))?$/.exec(text);
  if (local) {
    const instant = new Date(`${text}Z`);
    if (!Number.isFinite(instant.valueOf()) || instant.toISOString().slice(0, 19) !== local[1]) {
      throw new Error('Invalid offsetless timestamp');
    }
    // The provider has not documented whether this wall clock is UTC or Melbourne.
    // Retain the original string in source content; never infer an absolute time.
    return null;
  }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(text)
    || !z.iso.datetime({ offset: true }).safeParse(text).success) {
    throw new Error('Invalid offset timestamp');
  }
  return new Date(text).toISOString();
}

function hasUnverifiedTimezone(value: string | null | undefined): boolean {
  return value != null && value.trim() !== '' && parseVictorianTimestamp(value) === null;
}

const timestamp = z.string().refine(value => {
  try {
    parseVictorianTimestamp(value);
    return true;
  } catch {
    return false;
  }
}, 'Must be a valid timestamp; an omitted offset remains unverified');
const nullableTimestamp = timestamp.nullish();

const propertiesSchema = z.object({
  id: z.string().trim().min(1),
  impactId: z.string().trim().min(1).nullish(),
  status: z.string().nullish(),
  eventLocationStatus: z.string().nullish(),
  eventType: z.string().nullish(),
  eventSubType: z.string().nullish(),
  description: z.string().nullish(),
  created: nullableTimestamp,
  lastUpdated: nullableTimestamp,
  lastClosed: nullableTimestamp,
  endTime: nullableTimestamp,
  nextUpdateDue: nullableTimestamp,
  reference: z.object({ localRoadName: z.string().nullish(),
    localGovernmentArea: z.string().nullish() }).passthrough().nullish(),
  impact: z.object({ impactType: z.string().nullish(),
    direction: z.string().nullish() }).passthrough().nullish(),
}).passthrough();

const featureSchema = z.object({
  type: z.literal('Feature'),
  geometry: z.unknown(),
  properties: propertiesSchema,
}).passthrough();

const pageSchema = z.object({
  meta: z.object({ total_records: z.number().int().nonnegative(),
    total_pages: z.number().int().nonnegative(), page: z.number().int().positive(),
    count: z.number().int().nonnegative() }).passthrough(),
  data: z.object({ type: z.literal('FeatureCollection'),
    features: z.array(featureSchema) }).passthrough(),
}).passthrough();

type RoadFeature = z.infer<typeof featureSchema>;
type RoadPage = z.infer<typeof pageSchema>;

export function parseRoadPage(value: unknown): RoadPage {
  return pageSchema.parse(value);
}

function failure(input: ConnectorInput, code: 'rate_limited' | 'upstream_unavailable'
  | 'schema_changed' | 'auth_failed' | 'incomplete_window' | 'validation_failed',
retryAfterSeconds: number | null = null, message?: string): ConnectorResult {
  const defaultMessage = code === 'rate_limited'
    ? `Rate limit exceeded (20 calls per 60 seconds quota reached)${retryAfterSeconds ? `, retry after ${retryAfterSeconds}s` : ''}`
    : code === 'auth_failed'
    ? 'Transport Victoria API KeyID missing or unauthorized'
    : code === 'incomplete_window'
    ? 'Unplanned road snapshot pagination window incomplete or totals mismatched'
    : 'Unplanned road snapshot could not be validated';
  return { kind: 'failure', sourceId: SOURCE_ID, runId: input.runId,
    checkedAt: new Date().toISOString(), code,
    message: message ?? defaultMessage, retryAfterSeconds,
    completeness: { complete: false, expected_records: null, fetched_records: 0,
      expected_pages: null, fetched_pages: 0,
      evidence: 'Every v3 page and unique incident-impact pair are required' },
    sourceLatestUpdateAt: null };
}

function geometryFor(feature: RoadFeature): ValidGeometry | null {
  try {
    return parseGeometryGeojson(JSON.stringify(feature.geometry));
  } catch {
    return null;
  }
}

export function normalizeRoadSnapshot(features: readonly RoadFeature[], input: ConnectorInput,
  fetchedAt: string): { sourceRecords: SourceRecord[]; geoRecords: GeoRecord[];
    geoRecordSources: GeoRecordSource[]; latestUpdate: string | null; sourceRevision: string } {
  const sourceRecords: SourceRecord[] = [];
  const geoRecords: GeoRecord[] = [];
  const geoRecordSources: GeoRecordSource[] = [];
  const seenParentVersions = new Set<string>();
  const seenFeature = new Set<string>();
  let latestUpdate: string | null = null;
  for (const feature of features) {
    const p = feature.properties;
    const parentKey = p.id;
    const impactKey = p.impactId ?? null;
    const featureKey = `${parentKey}\u001f${impactKey ?? ''}`;
    if (seenFeature.has(featureKey)) throw new Error('Duplicate incident-impact pair');
    seenFeature.add(featureKey);
    const updatedAt = parseVictorianTimestamp(p.lastUpdated);
    const createdAt = parseVictorianTimestamp(p.created);
    const closedAt = parseVictorianTimestamp(p.lastClosed);
    if (updatedAt && (latestUpdate === null || updatedAt > latestUpdate)) latestUpdate = updatedAt;

    const status = p.eventLocationStatus ?? p.status;
    const isInactive = status === 'Inactive' || p.status === 'Inactive';
    const isPending = status === 'Pending' || p.status === 'Pending';
    const recordStatus = isInactive ? 'resolved' : isPending ? 'planned' : 'active';
    const timezoneUnverified = [p.created, p.lastUpdated, p.lastClosed, p.endTime, p.nextUpdateDue]
      .some(hasUnverifiedTimezone);
    const parentTimeMissing = timezoneUnverified
      ? 'Source timestamp timezone unverified; original wall clocks retained without absolute ordering'
      : createdAt === null
      ? (p.status === 'Inactive' && closedAt === null
        ? 'Incident created and clearance times absent upstream'
        : 'Incident created time absent upstream')
      : (p.status === 'Inactive' && closedAt === null ? 'Incident clearance time absent upstream' : null);
    const childTimeMissing = timezoneUnverified
      ? 'Source timestamp timezone unverified; original wall clocks retained without absolute ordering'
      : createdAt === null
      ? (isInactive && closedAt === null
        ? 'Incident created and clearance times absent upstream'
        : 'Incident created time absent upstream')
      : (isInactive && closedAt === null ? 'Incident clearance time absent upstream' : null);

    const parentId = sourceRecordId({ sourceId: SOURCE_ID, nativeId: `incident:${parentKey}`,
      originalUrl: LANDING_URL, sourceTime: createdAt });
    const parentContent = { id: p.id, status: p.status, eventType: p.eventType,
      eventSubType: p.eventSubType, description: p.description, created: p.created,
      lastUpdated: p.lastUpdated, lastClosed: p.lastClosed, endTime: p.endTime,
      nextUpdateDue: p.nextUpdateDue };
    const parentVersion = sourceVersionId(updatedAt, {
      normalizationPolicy: 'explicit-offset-v1', content: parentContent,
    });
    const parentVersionKey = `${parentId}\u001f${parentVersion}`;
    if (!seenParentVersions.has(parentVersionKey)) {
      seenParentVersions.add(parentVersionKey);
      sourceRecords.push({ batch_id: input.runId, source_id: SOURCE_ID, schema_version: 1,
        fetched_at: fetchedAt, source_record_id: parentId, version_id: parentVersion,
        original_url: LANDING_URL, raw_uri: null, published_at: null,
        observed_at: createdAt, first_accessible_at: null,
        time_missing_reason: parentTimeMissing,
        valid_from: createdAt, valid_to: p.status === 'Inactive' ? closedAt : null,
        source_updated_at: updatedAt, source_version_ordinal: null,
        record_status: 'active', assertion_kind: 'report', rights_status: 'review_required' });
    }

    const childId = impactKey === null ? parentId : sourceRecordId({ sourceId: SOURCE_ID,
      nativeId: `impact:${parentKey}:${impactKey}`, originalUrl: LANDING_URL,
      sourceTime: updatedAt });
    const childVersion = sourceVersionId(updatedAt, { parentVersion, geometry: feature.geometry,
      impactId: impactKey, eventLocationStatus: p.eventLocationStatus,
      impact: p.impact, reference: p.reference });
    if (impactKey !== null) {
      sourceRecords.push({ batch_id: input.runId, source_id: SOURCE_ID, schema_version: 1,
        fetched_at: fetchedAt, source_record_id: childId, version_id: childVersion,
        original_url: LANDING_URL, raw_uri: null, published_at: null,
        observed_at: createdAt, first_accessible_at: null,
        time_missing_reason: childTimeMissing,
        valid_from: createdAt,
        valid_to: isInactive ? closedAt : null,
        source_updated_at: updatedAt, source_version_ordinal: null,
        record_status: 'active', assertion_kind: 'report', rights_status: 'review_required' });
    }
    const geometry = geometryFor(feature);
    const point = geometry?.type === 'Point' ? geometry.coordinates : null;
    geoRecords.push({ batch_id: input.runId, source_id: SOURCE_ID, schema_version: 1,
      fetched_at: fetchedAt, geo_record_id: childId,
      version_id: childVersion, topic: 'road_disruption', assertion_kind: 'report',
      title: p.eventType ?? p.reference?.localRoadName ?? 'Road disruption',
      summary: timezoneUnverified ? JSON.stringify({ description: p.description ?? null,
        created: p.created ?? null, last_updated: p.lastUpdated ?? null,
        last_closed: p.lastClosed ?? null, end_time: p.endTime ?? null,
        next_update_due: p.nextUpdateDue ?? null, timezone_status: 'unverified' })
        : p.description ?? null,
      original_url: LANDING_URL,
      geometry_geojson: geometry === null ? null : JSON.stringify(geometry),
      centroid_lon: point?.[0] ?? null,
      centroid_lat: point?.[1] ?? null,
      location_role: geometry === null ? 'unknown' : 'event_site',
      location_confidence: geometry === null ? 'unverified' : 'source_coordinate',
      area_refs: [], published_at: null, observed_at: createdAt,
      valid_from: createdAt, valid_to: recordStatus === 'resolved' ? closedAt : null,
      source_updated_at: updatedAt, source_version_ordinal: null,
      freshness_state: 'unknown', record_status: recordStatus,
      rights_status: 'review_required', public_query_allowed: false });
    const linked = [{ source_record_id: parentId, source_version_id: parentVersion,
      evidence_role: 'parent_incident' },
    ...(impactKey === null ? [] : [{ source_record_id: childId,
      source_version_id: childVersion, evidence_role: 'child_impact' }])];
    for (const link of linked) geoRecordSources.push({ batch_id: input.runId,
      source_id: SOURCE_ID, schema_version: 1, fetched_at: fetchedAt,
      geo_record_id: childId, version_id: childVersion, ...link,
      original_url: LANDING_URL });
  }
  const canonical = [...features].sort((a, b) => a.properties.id.localeCompare(b.properties.id)
    || (a.properties.impactId ?? '').localeCompare(b.properties.impactId ?? ''));
  return { sourceRecords, geoRecords, geoRecordSources, latestUpdate,
    sourceRevision: sourceVersionId(null, { normalizationPolicy: 'explicit-offset-v1', features: canonical }) };
}

export class UnplannedRoadConnector implements Connector {
  readonly sourceId = SOURCE_ID;
  constructor(
    private readonly client = new HttpClient(),
    private readonly keyProvider: () => string | undefined = () => process.env.TRANSPORT_VICTORIA_KEY_ID,
    private readonly delayMs = PAGE_DELAY_MS,
  ) {}

  async collect(input: ConnectorInput): Promise<ConnectorResult> {
    if (input.sourceId !== SOURCE_ID) return failure(input, 'validation_failed');
    const key = this.keyProvider();
    if (!key) return failure(input, 'auth_failed');
    try {
      const features: RoadFeature[] = [];
      let fetchedAt = new Date().toISOString();
      let expectedRecords: number | null = null;
      let expectedPages: number | null = null;
      for (let page = 1; ; page += 1) {
        if (page > 1 && this.delayMs > 0) await delay(this.delayMs);
        const url = new URL(API_URL);
        url.searchParams.set('page', String(page));
        url.searchParams.set('limit', String(PAGE_SIZE));
        const response = await this.client.getJson({ url, headers: { KeyID: key },
          timeoutMs: 20000, maxAttempts: 3 });
        const body = parseRoadPage(response.body);
        fetchedAt = response.fetchedAt;
        if (body.meta.page !== page || body.meta.count !== body.data.features.length
          || (expectedRecords !== null && body.meta.total_records !== expectedRecords)
          || (expectedPages !== null && body.meta.total_pages !== expectedPages)) {
          return failure(input, 'incomplete_window');
        }
        expectedRecords = body.meta.total_records;
        expectedPages = body.meta.total_pages;
        features.push(...body.data.features);
        if (page >= Math.max(1, expectedPages)) break;
        if (page >= 1000) return failure(input, 'incomplete_window');
      }
      if (features.length !== expectedRecords) return failure(input, 'incomplete_window');
      const normalized = normalizeRoadSnapshot(features, input, fetchedAt);
      return { kind: 'success', sourceId: SOURCE_ID, runId: input.runId,
        fetchedAt, sourceRevision: normalized.sourceRevision,
        sourceLatestUpdateAt: normalized.latestUpdate,
        checkpointAfter: input.window.kind === 'time' ? input.window.to : input.window.revision,
        completeness: { complete: true, method: 'pagination',
          expected_records: expectedRecords, fetched_records: features.length,
          expected_pages: expectedPages, fetched_pages: Math.max(1, expectedPages ?? 1),
          evidence: 'All v3 pages agreed on totals and every incident-impact pair was unique' },
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
        ? Math.ceil(error.retryAfterMs / 1000)
        : (code === 'rate_limited' ? 60 : null);
      return failure(input, code, retryAfterSeconds);
    }
  }
}

export const connector: Connector = new UnplannedRoadConnector();
