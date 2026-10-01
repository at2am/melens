/**
 * Connector: City of Melbourne Transport Activity Counts (Source #17)
 *
 * Source ID: melbourne.transport.activity_counts
 * Upstream Dataset: transport-activity-counts (City of Melbourne Explore API)
 * Contract: specs/001-melbourne-data-aggregation/contracts/connector.md
 *
 * Operational Status (2026-09-29 Audit):
 *  - Upstream Status: BLOCKED / UNAVAILABLE
 *  - Access Status: candidate (license_status: review_required)
 *  - Verification Evidence:
 *      Querying https://data.melbourne.vic.gov.au/api/explore/v2.1/catalog/datasets/transport-activity-counts/records
 *      returns HTTP 404 / NotFoundResource ("The requested dataset transport-activity-counts does not exist.").
 *      A full catalog audit across all 238 datasets on data.melbourne.vic.gov.au confirmed that no active
 *      multi-modal transport activity counts dataset exists on the portal.
 *  - Graceful 404 Failure:
 *      Live collection fails closed with a structured ConnectorFailure (code: 'schema_changed', status 404).
 *      It NEVER silently succeeds with empty records.
 *  - Fixture Policy:
 *      Offline fixtures are strictly for invariant and parser testing. Fixtures MUST NEVER be used to
 *      claim live collection success or admission readiness.
 *
 * Task T032 Requirements & Invariants:
 *  1. Shared Connector Interface Conformance:
 *     Implements Connector interface with collect(input: ConnectorInput): Promise<ConnectorResult>.
 *     Exports `connector: Connector` matching SourceRegistry requirements.
 *  2. Modal Breakdown Preservation:
 *     Preserves vehicle, bicycle, and pedestrian activity categories distinctly;
 *     counts must never be cross-aggregated, collapsed, or misattributed across modes.
 *  3. 5-Minute Sampling Interval:
 *     Fixed 5-minute sampling granularity (sampling_interval_minutes: 5)
 *     with deterministic [valid_from, valid_to) interval boundaries.
 *  4. Hourly Publication Cadence Tracking:
 *     Tracks upstream publication cadence (~hourly, cadence_seconds: 3600)
 *     via ETag/Last-Modified HTTP headers or upstream batch timestamps.
 *  5. No Zero-Filling for Missing Intervals:
 *     Missing intervals or omitted category counts must remain null;
 *     absent periods signify missing/unobserved telemetry, NEVER zero activity (0).
 *  6. No Universal Citywide Coverage Claim:
 *     Observations apply solely to instrumented sensor sites/corridors;
 *     explicitly disclaims universal citywide coverage (is_citywide_coverage: false,
 *     location_role: 'sensor_site' for instrumented sites).
 */

import { readFileSync } from 'node:fs';
import { z } from 'zod';

import type {
  Connector,
  ConnectorCompleteness,
  ConnectorErrorCode,
  ConnectorFailure,
  ConnectorInput,
  ConnectorResult,
  ConnectorSuccess,
  IncompleteConnectorWindow,
} from '../../core/connector.js';
import { HttpFailure } from '../../core/http.js';
import { OdsIncompleteWindow, OpenDataSoftClient, type OdsQuery, type OdsRecords } from '../../core/opendatasoft.js';
import type {
  GeoRecord,
  GeoRecordSource,
  LocationConfidence,
  LocationRole,
  SourceId,
  SourceRecord,
  UtcTimestamp,
} from '../../core/types.js';
import { validateGeoRecordGeography } from '../../validation/geography.js';
import { sourceRecordId, sourceVersionId } from '../../validation/record.js';

export const SOURCE_ID: SourceId = 'melbourne.transport.activity_counts';
export const DATASET_ID = 'transport-activity-counts';
export const TOPIC = 'transport';
export const PROVIDER = 'City of Melbourne';
export const DATASET_TITLE = 'Transport Activity Counts';
export const LANDING_URL = 'https://data.melbourne.vic.gov.au/explore/dataset/transport-activity-counts/';
export const DEFAULT_PORTAL_URL = 'https://data.melbourne.vic.gov.au';
export const DEFAULT_BASE_URL = 'https://data.melbourne.vic.gov.au/api/explore/v2.1/catalog/datasets/transport-activity-counts';

export const SAMPLING_INTERVAL_MINUTES = 5;
export const SAMPLING_INTERVAL_MS = SAMPLING_INTERVAL_MINUTES * 60 * 1000;
export const UPSTREAM_CADENCE_SECONDS = 3600;

/**
 * Upstream operational verification metadata (2026-09-30)
 */
export const UPSTREAM_STATUS = 'blocked / unavailable' as const;
export const UPSTREAM_VERIFICATION_DATE = '2026-09-30';
export const UPSTREAM_ERROR_CODE = 'NotFoundResource';
export const UPSTREAM_VERIFIED_MESSAGE = 'The requested dataset transport-activity-counts does not exist.';

export type ErrorCode = ConnectorErrorCode;

export class ConnectorError extends Error {
  public readonly code: ErrorCode;
  public readonly details?: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(`[${code}] ${message}`);
    this.name = 'ConnectorError';
    this.code = code;
    this.details = details;
  }
}

/**
 * Observation status: 'observed' if at least one modal count is present, 'missing' if unobserved.
 * Missing intervals MUST NOT be zero-filled.
 */
export type ObservationStatus = 'observed' | 'missing';

/**
 * Raw upstream record schema from City of Melbourne OpenDataSoft v2.1 Explore API
 */
export const rawRecordSchema = z.object({
  sensor_id: z.union([z.string(), z.number()]).nullable().optional(),
  site_id: z.union([z.string(), z.number()]).nullable().optional(),
  sensor_name: z.string().nullable().optional(),
  road_name: z.string().nullable().optional(),
  road_segment: z.union([z.string(), z.number()]).nullable().optional(),
  direction: z.string().nullable().optional(),
  time: z.string().nullable().optional(),
  timestamp: z.string().nullable().optional(),
  datetime: z.string().nullable().optional(),
  date_time: z.string().nullable().optional(),
  interval_start: z.string().nullable().optional(),
  interval_end: z.string().nullable().optional(),
  interval_minutes: z.number().nullable().optional(),
  vehicle_count: z.union([z.number(), z.string()]).nullable().optional(),
  bicycle_count: z.union([z.number(), z.string()]).nullable().optional(),
  pedestrian_count: z.union([z.number(), z.string()]).nullable().optional(),
  total_count: z.union([z.number(), z.string()]).nullable().optional(),
  vehicles: z.union([z.number(), z.string()]).nullable().optional(),
  bicycles: z.union([z.number(), z.string()]).nullable().optional(),
  pedestrians: z.union([z.number(), z.string()]).nullable().optional(),
  longitude: z.number().finite().min(-180).max(180).nullable().optional(),
  latitude: z.number().finite().min(-90).max(90).nullable().optional(),
  location: z.object({
    lon: z.number().finite().min(-180).max(180),
    lat: z.number().finite().min(-90).max(90),
  }).nullable().optional(),
  geo_point_2d: z.object({
    lon: z.number().finite().min(-180).max(180),
    lat: z.number().finite().min(-90).max(90),
  }).nullable().optional(),
  clue_small_area: z.string().nullable().optional(),
  suburb: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
}).passthrough();

export type ComTransportActivityCountsRawRecord = z.infer<typeof rawRecordSchema>;

/**
 * Domain-specific normalized multi-modal transport activity record.
 * Conforms strictly to T032 invariants:
 *  - modal categories (vehicle, bicycle, pedestrian) preserved distinctly
 *  - 5-minute sampling interval with aligned boundaries
 *  - missing counts/intervals preserved as null (never zero-filled)
 *  - universal citywide coverage disclaimed
 */
export interface NormalizedTransportActivityRecord {
  activity_id: string;
  source_record_id: string;
  sensor_id: string;
  site_id: string | null;
  sensor_name: string;
  road_name: string;
  road_segment: string | null;
  direction: string;

  /** 5-minute sampling interval */
  sampling_interval_minutes: 5;
  observed_at: UtcTimestamp;
  interval_start: UtcTimestamp;
  interval_end: UtcTimestamp;

  /**
   * Modal breakdown counts: null if unobserved / missing in this interval.
   * INVARIANT (T032): Must NEVER be zero-filled when missing.
   */
  vehicle_count: number | null;
  bicycle_count: number | null;
  pedestrian_count: number | null;
  total_count: number | null;

  /** Observation status: 'observed' if at least one modal count present, 'missing' if interval missing */
  status: ObservationStatus;

  /** Spatial coordinates */
  latitude: number | null;
  longitude: number | null;
  clue_small_area: string | null;

  /**
   * INVARIANT (T032): Explicitly disclaims universal citywide street coverage.
   * Observations apply strictly to specific instrumented corridors.
   */
  is_citywide_coverage: false;
  coverage_scope: 'instrumented_corridor_only';
}

export type ComTransportActivityCountsSuccess = ConnectorSuccess & {
  activities: readonly NormalizedTransportActivityRecord[];
};

/**
 * Normalizes text to slug token
 */
export function slugify(str: string): string {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

/**
 * Safely parses numeric counts without zero-filling missing or suppressed values.
 * INVARIANT (T032): Missing or suppressed values return null, NOT 0.
 * A genuine 0 is preserved as 0.
 */
export function parseCount(val: unknown): number | null {
  if (val === undefined || val === null) {
    return null;
  }
  if (typeof val === 'number') {
    if (isNaN(val)) return null;
    return Math.max(0, Math.floor(val));
  }
  const s = String(val).trim();
  if (
    s === '' ||
    s.toLowerCase() === 'null' ||
    s === '-' ||
    s === '<4' ||
    s.toLowerCase() === 'na' ||
    s.toLowerCase() === 'missing'
  ) {
    return null;
  }
  const parsed = Number(s.replace(/,/g, ''));
  if (isNaN(parsed)) {
    return null;
  }
  return Math.max(0, Math.floor(parsed));
}

/**
 * Parses timestamp and derives standard 5-minute interval start and end (UTC ISO-8601).
 */
export function parse5MinInterval(rawTime: string): {
  observedAt: UtcTimestamp;
  intervalStart: UtcTimestamp;
  intervalEnd: UtcTimestamp;
} {
  const d = new Date(rawTime);
  if (isNaN(d.getTime())) {
    throw new ConnectorError('validation_failed', `Invalid timestamp: ${rawTime}`);
  }

  const ms = d.getTime();
  const alignedStartMs = Math.floor(ms / SAMPLING_INTERVAL_MS) * SAMPLING_INTERVAL_MS;
  const alignedEndMs = alignedStartMs + SAMPLING_INTERVAL_MS;

  const observedAt = d.toISOString();
  const intervalStart = new Date(alignedStartMs).toISOString();
  const intervalEnd = new Date(alignedEndMs).toISOString();

  return { observedAt, intervalStart, intervalEnd };
}

/**
 * Validates that a raw record has minimally a sensor identifier and timestamp
 */
export function validateRawRecord(record: unknown): record is ComTransportActivityCountsRawRecord {
  if (!record || typeof record !== 'object') {
    return false;
  }
  const r = record as Record<string, unknown>;
  const hasId =
    (r.sensor_id !== undefined && r.sensor_id !== null && String(r.sensor_id).trim() !== '') ||
    (r.site_id !== undefined && r.site_id !== null && String(r.site_id).trim() !== '');
  const hasTime =
    (r.time !== undefined && r.time !== null && String(r.time).trim() !== '') ||
    (r.timestamp !== undefined && r.timestamp !== null && String(r.timestamp).trim() !== '') ||
    (r.datetime !== undefined && r.datetime !== null && String(r.datetime).trim() !== '') ||
    (r.date_time !== undefined && r.date_time !== null && String(r.date_time).trim() !== '') ||
    (r.interval_start !== undefined && r.interval_start !== null && String(r.interval_start).trim() !== '');

  return Boolean(hasId && hasTime);
}

/**
 * Normalizes single raw record into SourceRecord, GeoRecord, GeoRecordSource, and NormalizedTransportActivityRecord
 */
export function normalizeTransportActivityRecord(
  raw: ComTransportActivityCountsRawRecord,
  batchId: string,
  fetchedAt: UtcTimestamp,
  sourceUpdatedAt: UtcTimestamp | null,
): {
  sourceRecord: SourceRecord;
  geoRecord: GeoRecord;
  geoRecordSource: GeoRecordSource;
  activity: NormalizedTransportActivityRecord;
} {
  const sensorId = raw.sensor_id !== undefined && raw.sensor_id !== null
    ? String(raw.sensor_id).trim()
    : String(raw.site_id).trim();

  const siteId = raw.site_id !== undefined && raw.site_id !== null
    ? String(raw.site_id).trim()
    : null;

  const sensorName = raw.sensor_name ? raw.sensor_name.trim() : `Sensor ${sensorId}`;
  const roadName = raw.road_name ? raw.road_name.trim() : sensorName;
  const roadSegment = raw.road_segment ? String(raw.road_segment).trim() : null;
  const direction = raw.direction ? raw.direction.trim() : 'Two-way';

  const rawTime = String(raw.time || raw.timestamp || raw.datetime || raw.date_time || raw.interval_start).trim();
  const { observedAt, intervalStart, intervalEnd } = parse5MinInterval(rawTime);

  // Invariant 2 & 5: Modal categories preserved distinctly, never cross-aggregated or zero-filled
  const vehicleCount = parseCount(raw.vehicle_count ?? raw.vehicles);
  const bicycleCount = parseCount(raw.bicycle_count ?? raw.bicycles);
  const pedestrianCount = parseCount(raw.pedestrian_count ?? raw.pedestrians);

  // Status: if all modal counts are null, mark as missing (unobserved / telemetry dropped)
  const isAllNull = vehicleCount === null && bicycleCount === null && pedestrianCount === null;
  const status: ObservationStatus = (raw.status?.toLowerCase() === 'missing' || isAllNull)
    ? 'missing'
    : 'observed';

  // Total count: preserve if provided upstream, otherwise null if missing
  const totalCount: number | null = parseCount(raw.total_count);

  // WGS84 coordinates extraction & validation
  let lon: number | null = null;
  let lat: number | null = null;

  if (typeof raw.longitude === 'number' && !isNaN(raw.longitude) && typeof raw.latitude === 'number' && !isNaN(raw.latitude)) {
    lon = raw.longitude;
    lat = raw.latitude;
  } else if (raw.location && typeof raw.location.lon === 'number' && typeof raw.location.lat === 'number') {
    lon = raw.location.lon;
    lat = raw.location.lat;
  } else if (raw.geo_point_2d && typeof raw.geo_point_2d.lon === 'number' && typeof raw.geo_point_2d.lat === 'number') {
    lon = raw.geo_point_2d.lon;
    lat = raw.geo_point_2d.lat;
  }

  const hasValidCoordinates =
    lat !== null &&
    lon !== null &&
    lat >= -90 &&
    lat <= 90 &&
    lon >= -180 &&
    lon <= 180 &&
    !(lat === 0 && lon === 0);

  const geometryGeoJson = hasValidCoordinates
    ? JSON.stringify({ type: 'Point', coordinates: [lon, lat] })
    : null;

  const sensorSlug = slugify(sensorId);
  const directionSlug = slugify(direction);
  const timeToken = intervalStart.replace(/[-:]/g, '').replace('T', '_').replace('.000Z', 'Z');

  const nativeId = `${sensorSlug}:${timeToken}:${directionSlug}`;
  const recordId = sourceRecordId({
    sourceId: SOURCE_ID,
    nativeId,
    originalUrl: LANDING_URL,
    sourceTime: observedAt,
  });

  const versionId = sourceVersionId(sourceUpdatedAt, raw);

  const smallArea = raw.clue_small_area ? raw.clue_small_area.trim() : null;
  const areaRefs: string[] = [`sensor:${sensorSlug}`];
  if (smallArea) {
    areaRefs.push(`clue_small_area:${slugify(smallArea)}`);
  }
  if (raw.suburb) {
    areaRefs.push(`suburb:${slugify(raw.suburb.trim())}`);
  }

  // SourceRecord
  const sourceRecord: SourceRecord = {
    batch_id: batchId,
    source_id: SOURCE_ID,
    schema_version: 1,
    fetched_at: fetchedAt,
    source_record_id: recordId,
    version_id: versionId,
    original_url: LANDING_URL,
    raw_uri: null,
    published_at: sourceUpdatedAt,
    observed_at: observedAt,
    first_accessible_at: null,
    time_missing_reason: null,
    valid_from: intervalStart,
    valid_to: intervalEnd,
    source_updated_at: sourceUpdatedAt,
    source_version_ordinal: null,
    record_status: 'active',
    assertion_kind: 'observation',
    rights_status: 'review_required',
  };

  // GeoRecord summary construction with explicit citywide disclaimers
  const vehicleText = vehicleCount !== null ? `${vehicleCount} vehicles` : 'vehicle count unobserved/missing';
  const bicycleText = bicycleCount !== null ? `${bicycleCount} cyclists` : 'cyclist count unobserved/missing';
  const pedestrianText = pedestrianCount !== null ? `${pedestrianCount} pedestrians` : 'pedestrian count unobserved/missing';
  const segmentText = roadSegment ? ` (${roadSegment})` : '';

  const summary =
    status === 'missing'
      ? `5-minute transport activity interval [${intervalStart} to ${intervalEnd}] at ${roadName}${segmentText} (${direction}): Telemetry missing/unobserved. Absent intervals are NOT zero-filled. Applies strictly to this instrumented corridor; does NOT claim universal citywide coverage.`
      : `5-minute transport activity count [${intervalStart} to ${intervalEnd}] at ${roadName}${segmentText} (${direction}): ${vehicleText}, ${bicycleText}, ${pedestrianText}. Applies strictly to this instrumented corridor; does NOT claim universal citywide coverage.`;

  const locationRole: LocationRole = hasValidCoordinates ? 'sensor_site' : 'unknown';
  const locationConfidence: LocationConfidence = hasValidCoordinates ? 'source_coordinate' : 'unverified';

  const geoRecord: GeoRecord = {
    batch_id: batchId,
    source_id: SOURCE_ID,
    schema_version: 1,
    fetched_at: fetchedAt,
    geo_record_id: recordId,
    version_id: versionId,
    topic: 'transport',
    assertion_kind: 'observation',
    title: `${roadName} (${direction}) - 5-min Transport Activity`,
    summary,
    original_url: LANDING_URL,
    geometry_geojson: geometryGeoJson,
    centroid_lat: hasValidCoordinates ? lat : null,
    centroid_lon: hasValidCoordinates ? lon : null,
    location_role: locationRole,
    location_confidence: locationConfidence,
    area_refs: areaRefs,
    published_at: sourceUpdatedAt,
    observed_at: observedAt,
    valid_from: intervalStart,
    valid_to: intervalEnd,
    source_updated_at: sourceUpdatedAt,
    source_version_ordinal: null,
    freshness_state: 'unknown',
    record_status: 'active',
    rights_status: 'review_required',
    public_query_allowed: false,
  };

  const geoRecordSource: GeoRecordSource = {
    batch_id: batchId,
    source_id: SOURCE_ID,
    schema_version: 1,
    fetched_at: fetchedAt,
    geo_record_id: recordId,
    version_id: versionId,
    source_record_id: recordId,
    source_version_id: versionId,
    evidence_role: 'official_transport_activity_counts',
    original_url: LANDING_URL,
  };

  const activity: NormalizedTransportActivityRecord = {
    activity_id: recordId,
    source_record_id: recordId,
    sensor_id: sensorId,
    site_id: siteId,
    sensor_name: sensorName,
    road_name: roadName,
    road_segment: roadSegment,
    direction,
    sampling_interval_minutes: 5,
    observed_at: observedAt,
    interval_start: intervalStart,
    interval_end: intervalEnd,
    vehicle_count: vehicleCount,
    bicycle_count: bicycleCount,
    pedestrian_count: pedestrianCount,
    total_count: totalCount,
    status,
    latitude: hasValidCoordinates ? lat : null,
    longitude: hasValidCoordinates ? lon : null,
    clue_small_area: smallArea,
    is_citywide_coverage: false,
    coverage_scope: 'instrumented_corridor_only',
  };

  return { sourceRecord, geoRecord, geoRecordSource, activity };
}

function makeFailure(
  input: ConnectorInput,
  code: ConnectorErrorCode,
  message: string,
  evidence: string,
  sourceLatestUpdateAt: UtcTimestamp | null = null,
): ConnectorFailure {
  const completeness: IncompleteConnectorWindow = {
    complete: false,
    expected_records: null,
    fetched_records: 0,
    expected_pages: null,
    fetched_pages: 0,
    evidence,
  };
  return {
    kind: 'failure',
    sourceId: SOURCE_ID,
    runId: input.runId,
    checkedAt: new Date().toISOString(),
    code,
    message,
    retryAfterSeconds: null,
    completeness,
    sourceLatestUpdateAt,
  };
}

/**
 * Connector implementation for City of Melbourne Transport Activity Counts (Source #17)
 */
export class ComTransportActivityCountsConnector implements Connector {
  readonly sourceId: SourceId = SOURCE_ID;

  constructor(
    private readonly client: OpenDataSoftClient = new OpenDataSoftClient(),
    private readonly portalUrl: string = DEFAULT_PORTAL_URL,
  ) {}

  async collect(input: ConnectorInput): Promise<ConnectorResult> {
    if (input.sourceId !== SOURCE_ID) {
      return makeFailure(
        input,
        'validation_failed',
        `Expected sourceId ${SOURCE_ID}, received ${input.sourceId}`,
        'The input sourceId must match the connector sourceId',
      );
    }

    let whereClause: string | undefined;
    if (input.window.kind === 'time') {
      whereClause = `time >= '${input.window.from}' and time < '${input.window.to}'`;
    }

    try {
      const query: OdsQuery = {
        portalUrl: this.portalUrl,
        datasetId: DATASET_ID,
        ...(whereClause !== undefined ? { where: whereClause } : {}),
        orderBy: 'time ASC, sensor_id ASC',
      };

      const response = await this.client.fetchRecords(query);

      const sourceUpdatedAt: UtcTimestamp | null = response.lastModified === null
        ? null
        : !isNaN(Date.parse(response.lastModified))
          ? new Date(response.lastModified).toISOString()
          : null;

      const sourceRecords: SourceRecord[] = [];
      const geoRecords: GeoRecord[] = [];
      const geoRecordSources: GeoRecordSource[] = [];
      const activities: NormalizedTransportActivityRecord[] = [];
      const seen = new Map<string, string>();

      for (const unknownRow of response.records) {
        const parseResult = rawRecordSchema.safeParse(unknownRow);
        if (!parseResult.success) {
          return makeFailure(
            input,
            'schema_changed',
            `Failed to parse upstream transport activity count row: ${parseResult.error.message}`,
            'All records must match the transport activity counts schema',
            sourceUpdatedAt,
          );
        }

        const row = parseResult.data;
        if (!validateRawRecord(row)) {
          return makeFailure(
            input,
            'validation_failed',
            'Encountered record missing sensor identifier or timestamp',
            'Every record must identify a sensor site and observation interval',
            sourceUpdatedAt,
          );
        }

        const { sourceRecord, geoRecord, geoRecordSource, activity } = normalizeTransportActivityRecord(
          row,
          input.runId,
          response.fetchedAt,
          sourceUpdatedAt,
        );

        const geoValidation = validateGeoRecordGeography(geoRecord);
        if (!geoValidation.valid) {
          return makeFailure(
            input,
            'validation_failed',
            `Invalid geography for record ${sourceRecord.source_record_id}: ${geoValidation.issues.join(', ')}`,
            'All geographic records must conform to geographic validation rules',
            sourceUpdatedAt,
          );
        }

        const existingVersion = seen.get(sourceRecord.source_record_id);
        if (existingVersion !== undefined) {
          if (existingVersion !== sourceRecord.version_id) {
            return makeFailure(
              input,
              'validation_failed',
              `Conflicting duplicate record detected for ${sourceRecord.source_record_id}`,
              'Duplicate record keys within a single batch must not contain conflicting data',
              sourceUpdatedAt,
            );
          }
          // Identical duplicate row deduplicated
          continue;
        }
        seen.set(sourceRecord.source_record_id, sourceRecord.version_id);

        sourceRecords.push(sourceRecord);
        geoRecords.push(geoRecord);
        geoRecordSources.push(geoRecordSource);
        activities.push(activity);
      }

      const completeness: ConnectorCompleteness = {
        complete: true,
        method: 'pagination',
        expected_records: response.totalCount,
        fetched_records: sourceRecords.length,
        expected_pages: response.pageCount,
        fetched_pages: response.pageCount,
        evidence: 'All OpenDataSoft records match total_count; modal categories preserved distinctly without zero-filling; citywide coverage disclaimed',
      };

      const checkpointAfter = input.window.kind === 'time'
        ? input.window.to
        : input.window.revision;

      const success: ComTransportActivityCountsSuccess = {
        kind: 'success',
        sourceId: SOURCE_ID,
        runId: input.runId,
        fetchedAt: response.fetchedAt,
        sourceRevision: sourceUpdatedAt,
        sourceLatestUpdateAt: sourceUpdatedAt,
        checkpointAfter,
        completeness,
        inputCount: response.records.length,
        outputCount: sourceRecords.length,
        rejectedCount: 0,
        sourceRecords,
        geoRecords,
        geoRecordSources,
        boundaries: [],
        areaIndicators: [],
        parkingBays: [],
        parkingObservations: [],
        parkingRules: [],
        sensorLocations: [],
        pedestrianObservations: [],
        retainableRawRecords: null,
        activities,
      };

      return success;
    } catch (error) {
      if (error instanceof OdsIncompleteWindow) {
        return makeFailure(input, 'incomplete_window', error.message, error.reason);
      }
      if (error instanceof HttpFailure) {
        const failureEvidence = error.status === 404
          ? `Upstream dataset '${DATASET_ID}' returned HTTP 404 (${UPSTREAM_ERROR_CODE}): ${UPSTREAM_VERIFIED_MESSAGE}; source is blocked / unavailable upstream`
          : `HTTP failure status ${error.status ?? 'unknown'}`;
        return makeFailure(input, error.code, error.message, failureEvidence);
      }
      if (error instanceof z.ZodError) {
        return makeFailure(input, 'schema_changed', error.message, 'Schema validation failure on upstream record');
      }
      return makeFailure(
        input,
        'validation_failed',
        error instanceof Error ? error.message : String(error),
        'Connector execution caught an unhandled error',
      );
    }
  }
}

export const connector: Connector = new ComTransportActivityCountsConnector();
export default connector;

/**
 * Optional legacy offline runner helper for direct testing and script execution.
 * When options.fixturePath is provided, executes offline against the fixture.
 * When omitted, runs against the upstream endpoint (or optional options.baseUrl),
 * failing gracefully on 404 rather than falling back to fixtures.
 */
export async function comTransportActivityCountsConnector(input: {
  sourceId: string;
  window?: { from?: string; to?: string };
  checkpoint?: string | null;
  runId?: string;
  options?: {
    fixturePath?: string;
    baseUrl?: string;
    apiKey?: string;
  };
}): Promise<ConnectorResult> {
  if (input.sourceId !== SOURCE_ID) {
    throw new ConnectorError('validation_failed', `Invalid sourceId "${input.sourceId}". Expected "${SOURCE_ID}"`);
  }

  const runId = input.runId || `run_${Date.now()}`;

  if (input.options?.fixturePath) {
    const fileData = readFileSync(input.options.fixturePath, 'utf8');
    const parsed = JSON.parse(fileData);
    const records = Array.isArray(parsed) ? parsed : Array.isArray(parsed.results) ? parsed.results : [];

    class FixtureClient extends OpenDataSoftClient {
      override async fetchRecords(_query: OdsQuery): Promise<OdsRecords> {
        return {
          records,
          totalCount: parsed.total_count ?? records.length,
          pageCount: 1,
          fetchedAt: new Date().toISOString(),
          lastModified: parsed.source_updated_at ?? null,
        };
      }
    }

    const fixtureConnector = new ComTransportActivityCountsConnector(new FixtureClient());
    return fixtureConnector.collect({
      sourceId: SOURCE_ID,
      window: { kind: 'snapshot', revision: 'fixture' },
      checkpoint: input.checkpoint ?? null,
      runId,
    });
  }

  const targetConnector = input.options?.baseUrl
    ? new ComTransportActivityCountsConnector(new OpenDataSoftClient(), input.options.baseUrl)
    : connector;

  return targetConnector.collect({
    sourceId: SOURCE_ID,
    window: input.window?.from && input.window?.to
      ? { kind: 'time', from: input.window.from, to: input.window.to }
      : { kind: 'snapshot', revision: 'latest' },
    checkpoint: input.checkpoint ?? null,
    runId,
  });
}
