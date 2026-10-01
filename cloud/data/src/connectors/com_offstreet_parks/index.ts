/**
 * Connector: City of Melbourne Off-street car parks with capacity and type (Source #20)
 *
 * Source ID: melbourne.offstreet_parks
 * Upstream Dataset: off-street-car-parks-with-capacity-and-type (City of Melbourne CLUE)
 * Contract: specs/001-melbourne-data-aggregation/contracts/connector.md
 * Invariants (T033):
 *  1. 仅将可公开设施标为候选:
 *     Only publicly accessible facilities (Commercial) are marked as public parking candidates
 *     (is_public_candidate: true, public_access: true).
 *     Residential and Private car parks are strictly non-public (is_public_candidate: false, public_access: false).
 *  2. 年度容量不写成实时剩余车位:
 *     Annual capacity is preserved as census capacity (annual_capacity) and MUST NOT be written
 *     as real-time available bays or sensor observations (is_realtime_occupancy: false, parkingObservations: []).
 *  3. 来源继续保持 review_required，待真实采集和许可复核后再计完成:
 *     Rights status remains 'review_required', public_query_allowed: false.
 *  4. 同物业同类型多行确定性聚合 (G23):
 *     Upstream rows are surveyed at establishment level without official establishment sub-keys.
 *     Multiple establishment rows sharing (census_year, property_id, parking_type) are deterministically deduplicated,
 *     sorted, and aggregated by summing annual capacity into property-level facilities.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { z } from 'zod';

import type {
  Connector,
  ConnectorErrorCode,
  ConnectorInput,
  ConnectorResult,
  ConnectorSuccess,
} from '../../core/connector.js';
import { HttpFailure } from '../../core/http.js';
import { OdsIncompleteWindow, OpenDataSoftClient, type OdsQuery, type OdsRecords } from '../../core/opendatasoft.js';
import type {
  GeoRecord,
  GeoRecordSource,
  ParkingBay,
  ParkingObservation,
  SourceRecord,
  UtcTimestamp,
} from '../../core/types.js';
import { sourceRecordId, sourceVersionId } from '../../validation/record.js';

export const SOURCE_ID = 'melbourne.offstreet_parks';
export const DATASET_ID = 'off-street-car-parks-with-capacity-and-type';
export const TOPIC = 'parking';
export const PROVIDER = 'City of Melbourne';
export const DATASET_TITLE = 'Off-street car parks with capacity and type';
export const LANDING_URL = 'https://data.melbourne.vic.gov.au/explore/dataset/off-street-car-parks-with-capacity-and-type/';
export const DEFAULT_PORTAL_URL = 'https://data.melbourne.vic.gov.au';
export const DEFAULT_BASE_URL = 'https://data.melbourne.vic.gov.au/api/explore/v2.1/catalog/datasets/off-street-car-parks-with-capacity-and-type';
export const DEFAULT_CENSUS_YEAR = '2024';

/**
 * Standard error codes defined by connector contract
 */
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
 * Raw upstream record schema from City of Melbourne Opendatasoft v2.1 Explore API
 */
export const rawRecordSchema = z.object({
  census_year: z.union([z.string(), z.number()]),
  block_id: z.number().int().nullable().optional(),
  property_id: z.union([z.string(), z.number()]),
  base_property_id: z.union([z.string(), z.number()]).nullable().optional(),
  building_address: z.string().nullable().optional(),
  clue_small_area: z.string().nullable().optional(),
  parking_type: z.string().trim().min(1),
  parking_spaces: z.number(),
  longitude: z.number().finite().min(-180).max(180).nullable().optional(),
  latitude: z.number().finite().min(-90).max(90).nullable().optional(),
  location: z.object({
    lon: z.number().finite().min(-180).max(180),
    lat: z.number().finite().min(-90).max(90),
  }).nullable().optional(),
}).passthrough();

export type ComOffstreetParkRawRecord = z.infer<typeof rawRecordSchema>;

/**
 * Domain-specific normalized facility representation
 */
export interface NormalizedOffstreetFacility {
  facility_id: string;
  source_record_id: string;
  property_id: string;
  base_property_id: string | null;
  building_address: string;
  clue_small_area: string | null;
  block_id: number | null;
  census_year: number;
  parking_type: 'Commercial' | 'Residential' | 'Private' | string;
  /**
   * CRITICAL (T033): Only 'Commercial' is marked as a public parking candidate.
   * Residential and Private car parks are strictly non-public.
   */
  is_public_candidate: boolean;
  /**
   * CRITICAL (T033): Represents total annual survey capacity in spaces.
   * Must NEVER be interpreted as real-time available/vacant bays.
   */
  annual_capacity: number;
  /** Explicit indicator that this capacity is static census data, not real-time telemetry */
  is_realtime_occupancy: false;
  /** Coordinates in WGS84 */
  latitude: number | null;
  longitude: number | null;
}

/**
 * Helper to compute SHA-256 hash
 */
export function computeSha256(data: string | object): string {
  const content = typeof data === 'string' ? data : JSON.stringify(data);
  return createHash('sha256').update(content).digest('hex');
}

/**
 * Normalize text to slug-friendly token
 */
export function slugify(str: string): string {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

/**
 * Validate that a raw record has required fields
 */
export function validateRawRecord(record: unknown): record is ComOffstreetParkRawRecord {
  const parsed = rawRecordSchema.safeParse(record);
  return parsed.success;
}

/**
 * Check if the parking type qualifies as publicly accessible candidate.
 * In City of Melbourne CLUE:
 * - Commercial: Publicly accessible paid parking facility -> TRUE
 * - Residential: Residents only -> FALSE
 * - Private: Staff, customers or visitors only -> FALSE
 */
export function isPublicParkingCandidate(parkingType: string): boolean {
  return parkingType.trim().toLowerCase() === 'commercial';
}

export interface NormalizedOffstreetRecordBundle {
  sourceRecord: SourceRecord;
  geoRecord: GeoRecord;
  geoRecordSource: GeoRecordSource;
  parkingBay: ParkingBay;
  facility: NormalizedOffstreetFacility;
}

/**
 * Deterministic canonical signature for a record or value.
 * Recursively sorts keys so identical objects produce identical strings regardless of key order.
 */
export function canonicalRowSignature(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null';
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalRowSignature).join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map(k => `${JSON.stringify(k)}:${canonicalRowSignature(obj[k])}`).join(',')}}`;
}

/**
 * Deduplicate identical rows and deterministically sort them by canonical signature
 */
export function deduplicateAndSortRows(rows: readonly ComOffstreetParkRawRecord[]): ComOffstreetParkRawRecord[] {
  const seenSignatures = new Set<string>();
  const uniqueRows: ComOffstreetParkRawRecord[] = [];
  for (const r of rows) {
    const sig = canonicalRowSignature(r);
    if (!seenSignatures.has(sig)) {
      seenSignatures.add(sig);
      uniqueRows.push(r);
    }
  }
  uniqueRows.sort((a, b) => canonicalRowSignature(a).localeCompare(canonicalRowSignature(b)));
  return uniqueRows;
}

/**
 * Normalize single raw record or an array of raw records for the same property and parking type
 * into canonical models and domain facility. Deterministically aggregates multiple rows.
 */
export function normalizeOffstreetRecord(
  raw: ComOffstreetParkRawRecord | readonly ComOffstreetParkRawRecord[],
  batchId: string,
  fetchedAt: UtcTimestamp,
  sourceRevision: string | null = null,
): NormalizedOffstreetRecordBundle {
  const inputRows = Array.isArray(raw) ? raw : [raw];
  if (inputRows.length === 0) {
    throw new Error('normalizeOffstreetRecord requires at least one raw record');
  }

  // Deduplicate identical rows and sort deterministically
  const uniqueRows = deduplicateAndSortRows(inputRows);

  const primary = uniqueRows[0]!;
  const censusYearNum = parseInt(String(primary.census_year), 10);
  const propertyIdStr = String(primary.property_id).trim();
  const parkingTypeStr = primary.parking_type.trim();
  const parkingTypeSlug = slugify(parkingTypeStr);

  const nativeId = `${censusYearNum}:${propertyIdStr}:${parkingTypeSlug}`;
  const recordId = sourceRecordId({
    sourceId: SOURCE_ID,
    nativeId,
    originalUrl: LANDING_URL,
    sourceTime: null,
  });

  // When caller passed a single row or there is a single unique row without aggregation,
  // preserve single-row payload; when multiple distinct rows are aggregated, use the deterministic
  // sorted array of unique rows so that reordering upstream inputs produces identical versionId.
  const versionPayload = uniqueRows.length === 1 && !Array.isArray(raw)
    ? uniqueRows[0]
    : uniqueRows.length === 1
      ? uniqueRows[0]
      : uniqueRows;

  const versionId = sourceVersionId(sourceRevision, versionPayload);

  // Temporal attributes: CLUE census survey period
  const periodStart = `${censusYearNum}-01-01T00:00:00Z`;
  const periodEnd = `${censusYearNum + 1}-01-01T00:00:00Z`;

  // Coordinates extraction & validation (WGS84) across unique rows (deterministic first valid)
  let lon: number | null = null;
  let lat: number | null = null;

  for (const r of uniqueRows) {
    let rLon: number | null = null;
    let rLat: number | null = null;
    if (typeof r.longitude === 'number' && !isNaN(r.longitude) && typeof r.latitude === 'number' && !isNaN(r.latitude)) {
      rLon = r.longitude;
      rLat = r.latitude;
    } else if (r.location && typeof r.location.lon === 'number' && typeof r.location.lat === 'number') {
      rLon = r.location.lon;
      rLat = r.location.lat;
    }
    if (
      rLat !== null &&
      rLon !== null &&
      rLat >= -90 &&
      rLat <= 90 &&
      rLon >= -180 &&
      rLon <= 180 &&
      !(rLat === 0 && rLon === 0)
    ) {
      lon = rLon;
      lat = rLat;
      break;
    }
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

  // Invariant 1: Only Commercial is a public candidate
  const isCandidate = isPublicParkingCandidate(parkingTypeStr);

  // Invariant 2: Capacity is annual survey, not real-time vacancies.
  // Aggregate/sum capacity across all unique rows for this property and parking type.
  const capacity = uniqueRows.reduce((sum, r) => sum + Math.max(0, r.parking_spaces), 0);

  const address = (uniqueRows.find(r => r.building_address?.trim())?.building_address?.trim()) ??
    (primary.building_address ? primary.building_address.trim() : `Property ${propertyIdStr}`);

  const smallArea = (uniqueRows.find(r => r.clue_small_area?.trim())?.clue_small_area?.trim()) ??
    (primary.clue_small_area ? primary.clue_small_area.trim() : null);

  const blockId = uniqueRows.find(r => r.block_id !== undefined && r.block_id !== null)?.block_id ??
    (primary.block_id !== undefined && primary.block_id !== null ? primary.block_id : null);

  const basePropertyId = uniqueRows.find(r => r.base_property_id !== undefined && r.base_property_id !== null)?.base_property_id ??
    primary.base_property_id;

  const areaRefs: string[] = [];
  if (smallArea) {
    areaRefs.push(`clue_small_area:${slugify(smallArea)}`);
  }
  if (blockId !== null && blockId !== undefined) {
    areaRefs.push(`com_block:${blockId}`);
  }

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
    observed_at: null,
    first_accessible_at: null,
    time_missing_reason: 'Annual CLUE census survey, not a real-time observation timestamp',
    valid_from: periodStart,
    valid_to: periodEnd,
    source_updated_at: sourceRevision,
    source_version_ordinal: null,
    record_status: 'active',
    assertion_kind: 'observation',
    rights_status: 'review_required',
  };

  const geoRecord: GeoRecord = {
    batch_id: batchId,
    source_id: SOURCE_ID,
    schema_version: 1,
    fetched_at: fetchedAt,
    geo_record_id: recordId,
    version_id: versionId,
    topic: TOPIC,
    assertion_kind: 'observation',
    title: `${address} (${parkingTypeStr} Car Park)`,
    summary: `CLUE ${censusYearNum} off-street ${parkingTypeStr.toLowerCase()} car park: ${capacity} capacity spaces at ${address}.${isCandidate ? ' Public candidate facility.' : ' Private/Residential facility (not public).' } Note: Capacity is an annual census count, not real-time availability.`,
    original_url: LANDING_URL,
    geometry_geojson: geometryGeoJson,
    centroid_lat: hasValidCoordinates ? lat : null,
    centroid_lon: hasValidCoordinates ? lon : null,
    location_role: isCandidate ? 'event_site' : 'sensor_site',
    location_confidence: hasValidCoordinates ? 'source_coordinate' : 'unverified',
    area_refs: areaRefs,
    published_at: null,
    observed_at: null,
    valid_from: periodStart,
    valid_to: periodEnd,
    source_updated_at: sourceRevision,
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
    evidence_role: 'official_offstreet_car_park',
    original_url: LANDING_URL,
  };

  const parkingBay: ParkingBay = {
    batch_id: batchId,
    source_id: SOURCE_ID,
    schema_version: 1,
    fetched_at: fetchedAt,
    bay_id: `offstreet:${recordId}`,
    version_id: versionId,
    marker_id: `property:${propertyIdStr}`,
    geometry_geojson: geometryGeoJson,
    valid_from: periodStart,
    valid_to: periodEnd,
    public_access: isCandidate,
    source_record_id: recordId,
    source_updated_at: sourceRevision,
    source_version_ordinal: null,
  };

  const facility: NormalizedOffstreetFacility = {
    facility_id: recordId,
    source_record_id: recordId,
    property_id: propertyIdStr,
    base_property_id: basePropertyId !== undefined && basePropertyId !== null ? String(basePropertyId).trim() : null,
    building_address: address,
    clue_small_area: smallArea,
    block_id: blockId !== null && blockId !== undefined ? Number(blockId) : null,
    census_year: censusYearNum,
    parking_type: parkingTypeStr,
    is_public_candidate: isCandidate,
    annual_capacity: capacity,
    is_realtime_occupancy: false,
    latitude: hasValidCoordinates ? lat : null,
    longitude: hasValidCoordinates ? lon : null,
  };

  return { sourceRecord, geoRecord, geoRecordSource, parkingBay, facility };
}

function makeFailure(
  input: ConnectorInput,
  code: ConnectorErrorCode,
  message: string,
  evidence: string = 'Off-street car parks snapshot could not be retrieved',
): ConnectorResult {
  return {
    kind: 'failure',
    sourceId: SOURCE_ID,
    runId: input.runId,
    checkedAt: new Date().toISOString(),
    code,
    message,
    retryAfterSeconds: null,
    completeness: {
      complete: false,
      expected_records: null,
      fetched_records: 0,
      expected_pages: null,
      fetched_pages: 0,
      evidence,
    },
    sourceLatestUpdateAt: null,
  };
}

export type ComOffstreetParksSuccess = ConnectorSuccess;

export interface ComOffstreetParksConnectorOptions {
  client?: OpenDataSoftClient;
  portalUrl?: string;
  defaultYear?: string;
}

/**
 * Frozen Connector implementation for City of Melbourne Off-street car parks (Source #20)
 */
export class ComOffstreetParksConnector implements Connector {
  readonly sourceId = SOURCE_ID;
  private readonly client: OpenDataSoftClient;
  private readonly portalUrl: string;
  private readonly defaultYear: string;

  constructor(
    clientOrOptions: OpenDataSoftClient | ComOffstreetParksConnectorOptions = new OpenDataSoftClient(),
    portalUrl: string = DEFAULT_PORTAL_URL,
    defaultYear: string = DEFAULT_CENSUS_YEAR,
  ) {
    if (clientOrOptions instanceof OpenDataSoftClient) {
      this.client = clientOrOptions;
      this.portalUrl = portalUrl;
      this.defaultYear = defaultYear;
    } else {
      this.client = clientOrOptions.client ?? new OpenDataSoftClient();
      this.portalUrl = clientOrOptions.portalUrl ?? DEFAULT_PORTAL_URL;
      this.defaultYear = clientOrOptions.defaultYear ?? DEFAULT_CENSUS_YEAR;
    }
  }

  async collect(input: ConnectorInput): Promise<ConnectorResult> {
    if (input.sourceId !== SOURCE_ID) {
      return makeFailure(
        input,
        'validation_failed',
        `Expected sourceId ${SOURCE_ID}, got ${input.sourceId}`,
        'Invalid sourceId provided',
      );
    }

    let whereClause: string | undefined;
    if (input.window.kind === 'snapshot') {
      const rev = input.window.revision;
      if (rev === 'latest') {
        whereClause = `census_year = date'${this.defaultYear}'`;
      } else if (/^\d{4}$/.test(rev)) {
        whereClause = `census_year = date'${rev}'`;
      } else if (/^\d{4}-\d{2}-\d{2}$/.test(rev)) {
        whereClause = `census_year = date'${rev}'`;
      }
    } else {
      const fromDate = input.window.from.slice(0, 10);
      const toDate = input.window.to.slice(0, 10);
      whereClause = `census_year >= date'${fromDate}' and census_year < date'${toDate}'`;
    }

    try {
      const response = await this.client.fetchRecords({
        portalUrl: this.portalUrl,
        datasetId: DATASET_ID,
        ...(whereClause !== undefined ? { where: whereClause } : {}),
        orderBy: 'property_id ASC',
      });

      // Group upstream records by (census_year, property_id, parking_type)
      const groups = new Map<string, ComOffstreetParkRawRecord[]>();
      for (const unknownRow of response.records) {
        const row = rawRecordSchema.parse(unknownRow);
        const censusYearNum = parseInt(String(row.census_year), 10);
        const propertyIdStr = String(row.property_id).trim();
        const parkingTypeSlug = slugify(row.parking_type.trim());
        const groupKey = `${censusYearNum}:${propertyIdStr}:${parkingTypeSlug}`;

        const existing = groups.get(groupKey);
        if (existing) {
          existing.push(row);
        } else {
          groups.set(groupKey, [row]);
        }
      }

      // Sort group keys to ensure deterministic output order regardless of upstream page/fetch order
      const sortedKeys = Array.from(groups.keys()).sort();

      const sourceRecords: SourceRecord[] = [];
      const geoRecords: GeoRecord[] = [];
      const geoRecordSources: GeoRecordSource[] = [];
      const parkingBays: ParkingBay[] = [];

      for (const groupKey of sortedKeys) {
        const rows = groups.get(groupKey)!;
        const { sourceRecord, geoRecord, geoRecordSource, parkingBay } = normalizeOffstreetRecord(
          rows,
          input.runId,
          response.fetchedAt,
          response.lastModified,
        );

        sourceRecords.push(sourceRecord);
        geoRecords.push(geoRecord);
        geoRecordSources.push(geoRecordSource);
        parkingBays.push(parkingBay);
      }

      const checkpointAfter = input.window.kind === 'time'
        ? input.window.to
        : input.window.revision;

      const success: ConnectorSuccess = {
        kind: 'success',
        sourceId: SOURCE_ID,
        runId: input.runId,
        fetchedAt: response.fetchedAt,
        sourceRevision: response.lastModified,
        sourceLatestUpdateAt: response.lastModified,
        checkpointAfter,
        completeness: {
          complete: true,
          method: 'pagination',
          expected_records: response.totalCount,
          fetched_records: response.records.length,
          expected_pages: response.pageCount,
          fetched_pages: response.pageCount,
          evidence: `All ${response.totalCount} records retrieved across ${response.pageCount} page(s) and normalized strictly per T033 invariants`,
        },
        inputCount: response.records.length,
        outputCount: sourceRecords.length,
        rejectedCount: 0,
        sourceRecords,
        geoRecords,
        geoRecordSources,
        boundaries: [],
        areaIndicators: [],
        parkingBays,
        /**
         * CRITICAL (T033): Annual capacity must NEVER be written as real-time available bays or sensor observations.
         */
        parkingObservations: [] as ParkingObservation[],
        parkingRules: [],
        sensorLocations: [],
        pedestrianObservations: [],
        retainableRawRecords: null,
      };

      return success;
    } catch (error) {
      if (error instanceof OdsIncompleteWindow) {
        return makeFailure(input, 'incomplete_window', error.message, error.reason);
      }
      if (error instanceof HttpFailure) {
        return makeFailure(input, error.code, error.message, `HTTP failure status ${error.status ?? 'unknown'}`);
      }
      if (error instanceof z.ZodError) {
        return makeFailure(input, 'schema_changed', error.message, 'Schema validation failure on upstream record');
      }
      return makeFailure(
        input,
        'validation_failed',
        error instanceof Error ? error.message : String(error),
        'Unexpected error processing off-street car parks',
      );
    }
  }
}

export const connector: Connector = new ComOffstreetParksConnector();
export default connector;

/**
 * Optional legacy offline runner helper for direct testing and script execution
 */
export async function comOffstreetParksConnector(input: {
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
          lastModified: null,
        };
      }
    }

    const fixtureConnector = new ComOffstreetParksConnector(new FixtureClient());
    return fixtureConnector.collect({
      sourceId: SOURCE_ID,
      window: { kind: 'snapshot', revision: 'fixture' },
      checkpoint: input.checkpoint ?? null,
      runId,
    });
  }

  return connector.collect({
    sourceId: SOURCE_ID,
    window: input.window?.from && input.window?.to
      ? { kind: 'time', from: input.window.from, to: input.window.to }
      : { kind: 'snapshot', revision: 'latest' },
    checkpoint: input.checkpoint ?? null,
    runId,
  });
}
