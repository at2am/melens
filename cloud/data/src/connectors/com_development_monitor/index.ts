/**
 * Connector: City of Melbourne Development Activity Monitor (Source #23)
 *
 * Source ID: melbourne.development_monitor
 * Upstream Dataset: development-activity-monitor (City of Melbourne Explore API)
 * Contract: specs/001-melbourne-data-aggregation/contracts/connector.md
 *
 * Task T057 Requirements:
 *  1. 保留项目点位: Point coordinates in WGS84 (lon, lat) retained without swap or 0,0 default.
 *  2. 月度更新: Upstream monthly release cycle tracked (cadence_seconds: 2592000).
 *  3. 保留 mooted/approved/under_construction/completed 来源状态，不合并为统一“已获批”:
 *     - APPLIED / MOOTED / PLANNED -> 'mooted'
 *     - APPROVED -> 'approved'
 *     - UNDER CONSTRUCTION / CONSTRUCTION / UNDER_CONSTRUCTION -> 'under_construction'
 *     - COMPLETED -> 'completed'
 *     Under no circumstances collapse these distinct states into 'approved'.
 *  4. Use the official data_processed timestamp for snapshot and correction ordering.
 */

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
import { OdsIncompleteWindow, OpenDataSoftClient } from '../../core/opendatasoft.js';
import type {
  AssertionKind,
  GeoRecord,
  GeoRecordSource,
  GeoRecordStatus,
  LocationConfidence,
  LocationRole,
  SourceId,
  SourceRecord,
  UtcTimestamp,
} from '../../core/types.js';
import { sourceRecordId, sourceVersionId } from '../../validation/record.js';

export const SOURCE_ID: SourceId = 'melbourne.development_monitor';
export const DATASET_ID = 'development-activity-monitor';
export const TOPIC = 'planning';
export const PROVIDER = 'City of Melbourne';
export const DATASET_TITLE = 'Development Activity Monitor';
export const LANDING_URL = 'https://data.melbourne.vic.gov.au/explore/dataset/development-activity-monitor/';
export const DEFAULT_PORTAL_URL = 'https://data.melbourne.vic.gov.au';
export const CADENCE_SECONDS = 2592000;

/**
 * Four distinct development statuses required by T057.
 * Strictly preserved without merging into a generic 'approved'.
 */
export type DevelopmentStatus = 'mooted' | 'approved' | 'under_construction' | 'completed';

/**
 * Maps raw upstream status to one of the 4 distinct statuses.
 * NEVER collapses 'mooted' or 'under_construction' into 'approved'.
 */
export function normalizeDevelopmentStatus(rawStatus: string | null | undefined): DevelopmentStatus {
  if (!rawStatus) return 'mooted';
  const s = rawStatus.trim().toUpperCase();
  if (s === 'APPLIED' || s === 'MOOTED' || s === 'PLANNED') {
    return 'mooted';
  }
  if (s === 'APPROVED') {
    return 'approved';
  }
  if (s === 'UNDER CONSTRUCTION' || s === 'CONSTRUCTION' || s === 'UNDER_CONSTRUCTION') {
    return 'under_construction';
  }
  if (s === 'COMPLETED') {
    return 'completed';
  }
  // Fallback: retain as mooted/applied rather than falsely claiming approval
  return 'mooted';
}

/**
 * Normalize text to slug-friendly token for area references
 */
export function slugify(str: string): string {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

/**
 * Raw upstream record schema from City of Melbourne OpenDataSoft v2.1 Explore API
 */
export const rawDevelopmentMonitorRowSchema = z.object({
  development_key: z.string().trim().min(1),
  status: z.string().trim().min(1),
  data_format: z.string().nullable().optional(),
  year_completed: z.union([z.string(), z.number()]).nullable().optional(),
  clue_small_area: z.string().nullable().optional(),
  clue_block: z.number().nullable().optional(),
  street_address: z.string().nullable().optional(),
  property_id: z.union([z.string(), z.number()]).nullable().optional(),
  property_id_2: z.union([z.string(), z.number()]).nullable().optional(),
  property_id_3: z.union([z.string(), z.number()]).nullable().optional(),
  property_id_4: z.union([z.string(), z.number()]).nullable().optional(),
  property_id_5: z.union([z.string(), z.number()]).nullable().optional(),
  floors_above: z.number().nullable().optional(),
  resi_dwellings: z.number().nullable().optional(),
  studio_dwe: z.number().nullable().optional(),
  one_bdrm_dwe: z.number().nullable().optional(),
  two_bdrm_dwe: z.number().nullable().optional(),
  three_bdrm_dwe: z.number().nullable().optional(),
  student_apartments: z.number().nullable().optional(),
  student_beds: z.number().nullable().optional(),
  student_accommodation_units: z.number().nullable().optional(),
  institutional_accom_beds: z.number().nullable().optional(),
  hotel_rooms: z.number().nullable().optional(),
  serviced_apartments: z.number().nullable().optional(),
  hotels_serviced_apartments: z.number().nullable().optional(),
  hostel_beds: z.number().nullable().optional(),
  childcare_places: z.number().nullable().optional(),
  office_flr: z.number().nullable().optional(),
  retail_flr: z.number().nullable().optional(),
  industrial_flr: z.number().nullable().optional(),
  storage_flr: z.number().nullable().optional(),
  education_flr: z.number().nullable().optional(),
  hospital_flr: z.number().nullable().optional(),
  recreation_flr: z.number().nullable().optional(),
  publicdispaly_flr: z.number().nullable().optional(),
  community_flr: z.number().nullable().optional(),
  car_spaces: z.number().nullable().optional(),
  bike_spaces: z.number().nullable().optional(),
  town_planning_application: z.string().nullable().optional(),
  longitude: z.number().nullable().optional(),
  latitude: z.number().nullable().optional(),
  geopoint: z.object({
    lon: z.number(),
    lat: z.number(),
  }).nullable().optional(),
}).passthrough();

export type ComDevelopmentMonitorRawRecord = z.infer<typeof rawDevelopmentMonitorRowSchema>;

/**
 * Preserves numeric count or measurement if explicitly provided.
 * Missing or null values MUST remain null (never zero-filled).
 * Explicit 0 from upstream remains 0.
 */
export function parseNullableCount(val: number | null | undefined): number | null {
  if (val === null || val === undefined) {
    return null;
  }
  if (typeof val === 'number' && Number.isFinite(val)) {
    return Math.max(0, val);
  }
  return null;
}

/**
 * Domain-specific normalized development project representation
 */
export interface NormalizedDevelopmentProject {
  project_id: string;
  source_record_id: string;
  development_key: string;
  raw_status: string;
  development_status: DevelopmentStatus;
  year_completed: number | null;
  street_address: string;
  clue_small_area: string | null;
  clue_block: number | null;
  property_ids: string[];
  town_planning_application: string | null;
  floors_above: number | null;
  resi_dwellings: number | null;
  dwellings_breakdown: {
    studio: number | null;
    one_bedroom: number | null;
    two_bedroom: number | null;
    three_or_more_bedroom: number | null;
    student_apartments: number | null;
    student_beds: number | null;
    student_accommodation_units: number | null;
    institutional_accom_beds: number | null;
    hotel_rooms: number | null;
    serviced_apartments: number | null;
    hotels_serviced_apartments: number | null;
    hostel_beds: number | null;
    childcare_places: number | null;
  };
  floor_space_sqm: {
    office: number | null;
    retail: number | null;
    industrial: number | null;
    storage: number | null;
    education: number | null;
    hospital: number | null;
    recreation: number | null;
    public_display: number | null;
    community: number | null;
  };
  parking_spaces: {
    car_spaces: number | null;
    bike_spaces: number | null;
  };
  latitude: number | null;
  longitude: number | null;
}

/**
 * Normalizes single raw record into SourceRecord, GeoRecord, GeoRecordSource, and NormalizedDevelopmentProject
 */
export function normalizeDevelopmentRecord(
  raw: ComDevelopmentMonitorRawRecord,
  batchId: string,
  fetchedAt: UtcTimestamp,
  sourceUpdatedAt: UtcTimestamp | null,
): {
  sourceRecord: SourceRecord;
  geoRecord: GeoRecord;
  geoRecordSource: GeoRecordSource;
  project: NormalizedDevelopmentProject;
} {
  const devKey = raw.development_key.trim();
  const rawStatus = raw.status.trim();
  const devStatus = normalizeDevelopmentStatus(rawStatus);

  const recordId = sourceRecordId({
    sourceId: SOURCE_ID,
    nativeId: devKey,
    originalUrl: LANDING_URL,
    sourceTime: null,
  });
  const versionId = sourceVersionId(sourceUpdatedAt, raw);

  // Temporal attributes: upstream provides year_completed only (at annual granularity)
  const yearCompletedNum = raw.year_completed !== null && raw.year_completed !== undefined
    ? parseInt(String(raw.year_completed), 10)
    : null;
  const validYear = yearCompletedNum !== null && !Number.isNaN(yearCompletedNum)
    && yearCompletedNum >= 1900 && yearCompletedNum <= 2100 ? yearCompletedNum : null;

  // When no exact observation timestamp exists, keep observed_at null with reason
  const observedAt: UtcTimestamp | null = null;

  const timeMissingReason = validYear !== null
    ? 'Annual completion year only, no per-row observation timestamp'
    : 'Monthly development monitor dataset does not carry per-row observation timestamps';

  // Lifecycle & assertion mapping per data model and SQL views
  let assertionKind: AssertionKind = 'plan';
  let geoRecordStatus: GeoRecordStatus = 'planned';

  switch (devStatus) {
    case 'mooted':
      assertionKind = 'plan';
      geoRecordStatus = 'planned';
      break;
    case 'approved':
      assertionKind = 'plan';
      geoRecordStatus = 'planned';
      break;
    case 'under_construction':
      assertionKind = 'plan';
      geoRecordStatus = 'active';
      break;
    case 'completed':
      assertionKind = 'observation';
      geoRecordStatus = 'resolved';
      break;
  }

  // WGS84 point coordinates validation
  let lon: number | null = null;
  let lat: number | null = null;

  if (typeof raw.longitude === 'number' && Number.isFinite(raw.longitude)
    && typeof raw.latitude === 'number' && Number.isFinite(raw.latitude)) {
    lon = raw.longitude;
    lat = raw.latitude;
  } else if (raw.geopoint && typeof raw.geopoint.lon === 'number' && Number.isFinite(raw.geopoint.lon)
    && typeof raw.geopoint.lat === 'number' && Number.isFinite(raw.geopoint.lat)) {
    lon = raw.geopoint.lon;
    lat = raw.geopoint.lat;
  }

  // Coordinate check: lon in [-180, 180], lat in [-90, 90], and never 0,0 default
  const hasValidCoordinates =
    lat !== null
    && lon !== null
    && !(lat === 0 && lon === 0)
    && lat >= -90
    && lat <= 90
    && lon >= -180
    && lon <= 180;

  const geometryGeoJson = hasValidCoordinates
    ? JSON.stringify({ type: 'Point', coordinates: [lon, lat] })
    : null;

  const locationRole: LocationRole = hasValidCoordinates ? 'event_site' : 'unknown';
  const locationConfidence: LocationConfidence = hasValidCoordinates ? 'source_coordinate' : 'unverified';

  // Address and area references
  const address = raw.street_address ? raw.street_address.trim() : `Project ${devKey}`;
  const smallArea = raw.clue_small_area ? raw.clue_small_area.trim() : null;
  const areaRefs: string[] = [];
  if (smallArea) {
    areaRefs.push(`clue_small_area:${slugify(smallArea)}`);
  }
  // The source does not identify a CLUE boundary vintage. Keep the raw block
  // value in the project payload, but never assert a join to current polygons.

  // Property IDs aggregation
  const propertyIds: string[] = [];
  for (const pid of [raw.property_id, raw.property_id_2, raw.property_id_3, raw.property_id_4, raw.property_id_5]) {
    if (pid !== undefined && pid !== null && String(pid).trim() !== '') {
      propertyIds.push(String(pid).trim());
    }
  }

  const resiDwellings = parseNullableCount(raw.resi_dwellings);
  const floorsAbove = raw.floors_above !== undefined && raw.floors_above !== null ? Number(raw.floors_above) : null;
  const townPlanningApp = raw.town_planning_application ? raw.town_planning_application.trim() : null;

  const title = `${address} (${rawStatus})`;
  const dwellingDesc = resiDwellings !== null ? resiDwellings : 'unspecified';
  const floorDesc = floorsAbove !== null ? floorsAbove : 'unspecified';
  const appDesc = townPlanningApp !== null ? townPlanningApp : 'N/A';
  const summary = `Development project ${devKey} at ${address}. Status: ${devStatus} (source: ${rawStatus}). Dwellings: ${dwellingDesc}, Floors: ${floorDesc}. Application: ${appDesc}.`;

  const sourceRecord: SourceRecord = {
    batch_id: batchId,
    source_id: SOURCE_ID,
    schema_version: 1,
    fetched_at: fetchedAt,
    source_record_id: recordId,
    version_id: versionId,
    original_url: LANDING_URL,
    raw_uri: null,
    published_at: null,
    observed_at: observedAt,
    first_accessible_at: null,
    time_missing_reason: timeMissingReason,
    valid_from: null,
    valid_to: null,
    source_updated_at: sourceUpdatedAt,
    source_version_ordinal: null,
    record_status: 'active',
    assertion_kind: assertionKind,
    rights_status: 'verified_open',
  };

  const geoRecord: GeoRecord = {
    batch_id: batchId,
    source_id: SOURCE_ID,
    schema_version: 1,
    fetched_at: fetchedAt,
    geo_record_id: recordId,
    version_id: versionId,
    topic: TOPIC,
    assertion_kind: assertionKind,
    title,
    summary,
    original_url: LANDING_URL,
    geometry_geojson: geometryGeoJson,
    centroid_lat: hasValidCoordinates ? lat : null,
    centroid_lon: hasValidCoordinates ? lon : null,
    location_role: locationRole,
    location_confidence: locationConfidence,
    area_refs: areaRefs,
    published_at: null,
    observed_at: observedAt,
    valid_from: null,
    valid_to: null,
    source_updated_at: sourceUpdatedAt,
    source_version_ordinal: null,
    freshness_state: 'unknown',
    record_status: geoRecordStatus,
    rights_status: 'verified_open',
    public_query_allowed: true,
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
    evidence_role: 'official_development_monitor_project',
    original_url: LANDING_URL,
  };

  const project: NormalizedDevelopmentProject = {
    project_id: recordId,
    source_record_id: recordId,
    development_key: devKey,
    raw_status: rawStatus,
    development_status: devStatus,
    year_completed: validYear,
    street_address: address,
    clue_small_area: smallArea,
    clue_block: raw.clue_block !== undefined && raw.clue_block !== null ? Number(raw.clue_block) : null,
    property_ids: propertyIds,
    town_planning_application: townPlanningApp,
    floors_above: floorsAbove,
    resi_dwellings: resiDwellings,
    dwellings_breakdown: {
      studio: parseNullableCount(raw.studio_dwe),
      one_bedroom: parseNullableCount(raw.one_bdrm_dwe),
      two_bedroom: parseNullableCount(raw.two_bdrm_dwe),
      three_or_more_bedroom: parseNullableCount(raw.three_bdrm_dwe),
      student_apartments: parseNullableCount(raw.student_apartments),
      student_beds: parseNullableCount(raw.student_beds),
      student_accommodation_units: parseNullableCount(raw.student_accommodation_units),
      institutional_accom_beds: parseNullableCount(raw.institutional_accom_beds),
      hotel_rooms: parseNullableCount(raw.hotel_rooms),
      serviced_apartments: parseNullableCount(raw.serviced_apartments),
      hotels_serviced_apartments: parseNullableCount(raw.hotels_serviced_apartments),
      hostel_beds: parseNullableCount(raw.hostel_beds),
      childcare_places: parseNullableCount(raw.childcare_places),
    },
    floor_space_sqm: {
      office: parseNullableCount(raw.office_flr),
      retail: parseNullableCount(raw.retail_flr),
      industrial: parseNullableCount(raw.industrial_flr),
      storage: parseNullableCount(raw.storage_flr),
      education: parseNullableCount(raw.education_flr),
      hospital: parseNullableCount(raw.hospital_flr),
      recreation: parseNullableCount(raw.recreation_flr),
      public_display: parseNullableCount(raw.publicdispaly_flr),
      community: parseNullableCount(raw.community_flr),
    },
    parking_spaces: {
      car_spaces: parseNullableCount(raw.car_spaces),
      bike_spaces: parseNullableCount(raw.bike_spaces),
    },
    latitude: hasValidCoordinates ? lat : null,
    longitude: hasValidCoordinates ? lon : null,
  };

  return { sourceRecord, geoRecord, geoRecordSource, project };
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
 * Connector implementation for City of Melbourne Development Activity Monitor (Source #23)
 */
export class DevelopmentMonitorConnector implements Connector {
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

    try {
      const metadataQuery = { portalUrl: this.portalUrl, datasetId: DATASET_ID };
      const revisionBefore = await this.client.fetchDatasetDataProcessed(metadataQuery);
      const response = await this.client.fetchRecords({
        portalUrl: this.portalUrl,
        datasetId: DATASET_ID,
        orderBy: 'development_key ASC',
      });
      const revisionAfter = await this.client.fetchDatasetDataProcessed(metadataQuery);
      if (revisionBefore !== revisionAfter) {
        return makeFailure(input, 'incomplete_window',
          'Development dataset changed during pagination',
          'Official data_processed metadata must be stable across the fetched snapshot', revisionAfter);
      }
      const sourceUpdatedAt: UtcTimestamp = revisionAfter;

      const sourceRecords: SourceRecord[] = [];
      const geoRecords: GeoRecord[] = [];
      const geoRecordSources: GeoRecordSource[] = [];
      const seenKeys = new Set<string>();

      for (const unknownRow of response.records) {
        const parseResult = rawDevelopmentMonitorRowSchema.safeParse(unknownRow);
        if (!parseResult.success) {
          return makeFailure(
            input,
            'schema_changed',
            `Failed to parse upstream development monitor row: ${parseResult.error.message}`,
            'All records must match the development activity monitor schema',
            sourceUpdatedAt,
          );
        }
        const row = parseResult.data;
        const devKey = row.development_key.trim();
        if (seenKeys.has(devKey)) {
          return makeFailure(
            input,
            'validation_failed',
            `Duplicate development_key "${devKey}" detected in batch`,
            'Development keys must be unique within a snapshot batch',
            sourceUpdatedAt,
          );
        }
        seenKeys.add(devKey);

        const { sourceRecord, geoRecord, geoRecordSource } = normalizeDevelopmentRecord(
          row,
          input.runId,
          response.fetchedAt,
          sourceUpdatedAt,
        );

        sourceRecords.push(sourceRecord);
        geoRecords.push(geoRecord);
        geoRecordSources.push(geoRecordSource);
      }

      const completeness: ConnectorCompleteness = {
        complete: true,
        method: 'pagination',
        expected_records: response.totalCount,
        fetched_records: response.records.length,
        expected_pages: response.pageCount,
        fetched_pages: response.pageCount,
        evidence: 'All OpenDataSoft pages match total_count',
      };

      const checkpointAfter = input.window.kind === 'time'
        ? input.window.to
        : input.window.revision;

      return {
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
      };
    } catch (error) {
      const code = error instanceof OdsIncompleteWindow
        ? 'incomplete_window'
        : error instanceof HttpFailure
          ? error.code
          : error instanceof z.ZodError
            ? 'schema_changed'
            : 'validation_failed';
      const message = error instanceof Error ? error.message : String(error);
      return makeFailure(input, code, message, 'Connector execution caught an unhandled error');
    }
  }
}

export const connector: Connector = new DevelopmentMonitorConnector();
export default connector;
