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
const MAX_SOURCE_CLOCK_SKEW_MS = 300_000;
const NORMALIZATION_POLICY = 'explicit-offset-closure-unverified-road-v3';

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

const roadStatusSchema = z.enum(['Active', 'Inactive', 'Pending', 'Reopened']);

function disruptionStatus(properties: RoadFeature['properties']): GeoRecord['record_status'] {
  const incident = roadStatusSchema.parse(properties.status);
  const impact = properties.eventLocationStatus == null
    ? incident : roadStatusSchema.parse(properties.eventLocationStatus);
  if (incident === 'Inactive' || impact === 'Inactive') return 'resolved';
  if (incident === 'Pending' || impact === 'Pending') return 'planned';
  return 'active';
}

export function normalizeRoadSnapshot(features: readonly RoadFeature[], input: ConnectorInput,
  fetchedAt: string): { sourceRecords: SourceRecord[]; geoRecords: GeoRecord[];
    geoRecordSources: GeoRecordSource[]; latestUpdate: string | null; sourceRevision: string } {
  const sourceRecords: SourceRecord[] = [];
  const geoRecords: GeoRecord[] = [];
  const geoRecordSources: GeoRecordSource[] = [];
  const parentVersions = new Map<string, string>();
  const seenFeature = new Set<string>();
  const latestReportTime = Date.parse(z.iso.datetime({ offset: true }).parse(fetchedAt))
    + MAX_SOURCE_CLOCK_SKEW_MS;
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
    if ([createdAt, updatedAt, closedAt].some(timestamp =>
      timestamp !== null && Date.parse(timestamp) > latestReportTime)) {
      throw new Error('Unplanned road report timestamp is more than five minutes after fetch time');
    }
    if (updatedAt && (latestUpdate === null || updatedAt > latestUpdate)) latestUpdate = updatedAt;

    const recordStatus = disruptionStatus(p);
    const isInactive = recordStatus === 'resolved';
    const timezoneUnverified = [p.created, p.lastUpdated, p.lastClosed, p.endTime, p.nextUpdateDue]
      .some(hasUnverifiedTimezone);
    const hasClosureField = p.lastClosed != null && p.lastClosed.trim() !== '';
    const clearanceReason = hasClosureField
      ? 'Incident clearance time unverified; provider lastClosed and lastActive definitions conflict'
      : 'Incident clearance time absent upstream';
    const missingTimeReason = (inactive: boolean): string | null => {
      const reasons: string[] = [];
      if (timezoneUnverified) reasons.push(
        'Source timestamp timezone unverified; original wall clocks retained without absolute ordering');
      else if (createdAt === null) reasons.push('Incident created time absent upstream');
      if (inactive) reasons.push(clearanceReason);
      return reasons.length === 0 ? null : reasons.join('; ');
    };
    const parentTimeMissing = missingTimeReason(p.status === 'Inactive');
    const childTimeMissing = missingTimeReason(isInactive);

    const parentId = sourceRecordId({ sourceId: SOURCE_ID, nativeId: `incident:${parentKey}`,
      originalUrl: LANDING_URL, sourceTime: createdAt });
    const parentContent = { id: p.id, status: p.status, eventType: p.eventType,
      eventSubType: p.eventSubType, description: p.description, created: p.created,
      lastUpdated: p.lastUpdated, lastClosed: p.lastClosed, endTime: p.endTime,
      nextUpdateDue: p.nextUpdateDue,
      ...(impactKey === null ? { feature } : {}) };
    const parentVersion = sourceVersionId(updatedAt, {
      normalizationPolicy: NORMALIZATION_POLICY, content: parentContent,
    });
    const existingParentVersion = parentVersions.get(parentId);
    if (existingParentVersion !== undefined && existingParentVersion !== parentVersion) {
      throw new Error('Conflicting parent incident versions in one snapshot');
    }
    if (existingParentVersion === undefined) {
      parentVersions.set(parentId, parentVersion);
      sourceRecords.push({ batch_id: input.runId, source_id: SOURCE_ID, schema_version: 1,
        fetched_at: fetchedAt, source_record_id: parentId, version_id: parentVersion,
        original_url: LANDING_URL, raw_uri: null, published_at: null,
        observed_at: createdAt, first_accessible_at: null,
        time_missing_reason: parentTimeMissing,
        valid_from: createdAt, valid_to: null,
        source_updated_at: updatedAt, source_version_ordinal: null,
        record_status: 'active', assertion_kind: 'report', rights_status: 'review_required' });
    }

    const childId = impactKey === null ? parentId : sourceRecordId({ sourceId: SOURCE_ID,
      nativeId: `impact:${parentKey}:${impactKey}`, originalUrl: LANDING_URL,
      sourceTime: updatedAt });
    const childVersion = impactKey === null ? parentVersion
      : sourceVersionId(updatedAt, { normalizationPolicy: NORMALIZATION_POLICY,
        parentVersion, feature });
    if (impactKey !== null) {
      sourceRecords.push({ batch_id: input.runId, source_id: SOURCE_ID, schema_version: 1,
        fetched_at: fetchedAt, source_record_id: childId, version_id: childVersion,
        original_url: LANDING_URL, raw_uri: null, published_at: null,
        observed_at: createdAt, first_accessible_at: null,
        time_missing_reason: childTimeMissing,
        valid_from: createdAt,
        valid_to: null,
        source_updated_at: updatedAt, source_version_ordinal: null,
        record_status: 'active', assertion_kind: 'report', rights_status: 'review_required' });
    }
    const geometry = geometryFor(feature);
    const point = geometry?.type === 'Point' ? geometry.coordinates : null;
    geoRecords.push({ batch_id: input.runId, source_id: SOURCE_ID, schema_version: 1,
      fetched_at: fetchedAt, geo_record_id: childId,
      version_id: childVersion, topic: 'road_disruption', assertion_kind: 'report',
      title: p.eventType ?? p.reference?.localRoadName ?? 'Road disruption',
      summary: JSON.stringify({ description: p.description ?? null,
        incident_id: parentKey, impact_id: impactKey,
        incident_status: p.status ?? null, impact_status: p.eventLocationStatus ?? null,
        reference: p.reference ?? null, impact: p.impact ?? null,
        source_properties: p,
        created: p.created ?? null, last_updated: p.lastUpdated ?? null,
        last_closed: p.lastClosed ?? null, end_time: p.endTime ?? null,
        next_update_due: p.nextUpdateDue ?? null,
        timezone_status: timezoneUnverified ? 'unverified' : 'explicit_or_absent' }),
      original_url: LANDING_URL,
      geometry_geojson: geometry === null ? null : JSON.stringify(geometry),
      centroid_lon: point?.[0] ?? null,
      centroid_lat: point?.[1] ?? null,
      location_role: geometry === null ? 'unknown' : 'event_site',
      location_confidence: geometry === null ? 'unverified' : 'source_coordinate',
      area_refs: [], published_at: null, observed_at: createdAt,
      valid_from: createdAt, valid_to: null,
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
    time_missing_reason: 'Complete fetched snapshot; fetch time is not an incident source timestamp',
    valid_from: null, valid_to: null, source_updated_at: null, source_version_ordinal: null,
    record_status: 'active', assertion_kind: 'report', rights_status: 'review_required' });
  for (const row of geoRecords) {
    geoRecordSources.push({ batch_id: input.runId, source_id: SOURCE_ID, schema_version: 1,
      fetched_at: fetchedAt, geo_record_id: row.geo_record_id, version_id: row.version_id,
      source_record_id: snapshotId, source_version_id: snapshotVersion,
      evidence_role: 'road_snapshot_membership', original_url: LANDING_URL });
  }
  return { sourceRecords, geoRecords, geoRecordSources, latestUpdate,
    sourceRevision: sourceVersionId(null, { normalizationPolicy: NORMALIZATION_POLICY,
      snapshot: [snapshotId, snapshotVersion], features: canonical }) };
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
          redirect: 'error', timeoutMs: 20000, maxAttempts: 1 });
        const body = parseRoadPage(response.body);
        fetchedAt = response.fetchedAt;
        if (body.meta.page !== page || body.meta.count !== body.data.features.length
          || (body.meta.total_records > 0 && body.meta.total_pages === 0)
          || (body.meta.total_records === 0 && (body.meta.total_pages > 1 || body.meta.count > 0))
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
          expected_pages: Math.max(1, expectedPages ?? 1), fetched_pages: Math.max(1, expectedPages ?? 1),
          evidence: 'All v3 pages agreed on totals and every incident-impact pair was unique; an empty zero-page dataset requires one header response' },
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
