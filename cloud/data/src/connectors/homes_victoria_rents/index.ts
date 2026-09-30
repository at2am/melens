/**
 * Connector: Homes Victoria Quarterly Median Rents by LGA (Source #21)
 *
 * Source ID: homes_victoria.rents
 * Upstream Dataset: rental-report-quarterly-quarterly-median-rents-by-lga
 * Contract: specs/001-melbourne-data-aggregation/contracts/connector.md
 *
 * Invariants (T055):
 *  1. Preserves quarterly statistical periods, administrative/statistical geography (LGA & suburbs),
 *     and statistical specifications (property types, bond counts, median rents).
 *  2. NEVER treated as active market rental vacancy listings:
 *     - assertion_kind is strictly 'observation' (historical quarterly bond lodgements with RTBA).
 *     - is_current_listing is explicitly false.
 *  3. Preserves suppressed and missing values without zero-filling:
 *     - Confidentiality-suppressed records ('-', '<4', 's', 'suppressed') maintain status = 'suppressed' and null values.
 *     - Missing quarters/regions maintain status = 'missing' and null values.
 *     - Only status === 'observed' may contain numeric values.
 *  4. Preserves geographical level at LGA / suburb (location_role: 'area_only', location_confidence: 'official_join').
 *     Does NOT fabricate arbitrary street points or centroid coordinates (centroid_lat/lon remain null).
 *  5. Reuse follows the source and resource pages' CC BY 4.0 licence.
 *     File-level Last-Modified orders corrections to the same historical row.
 */

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';

import {
  CONNECTOR_ERROR_CODES,
  type Connector,
  type ConnectorErrorCode,
  type ConnectorFailure,
  type ConnectorInput,
  type ConnectorResult,
  type ConnectorSuccess,
} from '../../core/connector.js';
import { HttpClient, HttpFailure } from '../../core/http.js';
import type {
  AreaIndicator,
  GeoRecord,
  GeoRecordSource,
  SourceRecord,
  SourceRecordStatus,
  UtcTimestamp,
} from '../../core/types.js';
import { sourceRecordId, sourceVersionId } from '../../validation/record.js';
import { parseHomesVictoriaWorkbook } from './xlsx.js';

export const SOURCE_ID = 'homes_victoria.rents';
export const TOPIC = 'housing';
export const PROVIDER = 'Homes Victoria';
export const DATASET_TITLE = 'Rental Report - Quarterly: Quarterly Median Rents by LGA';
export const LANDING_URL = 'https://discover.data.vic.gov.au/dataset/rental-report-quarterly-quarterly-median-rents-by-lga';
export const DEFAULT_CKAN_PACKAGE_URL = 'https://discover.data.vic.gov.au/api/3/action/package_show?id=rental-report-quarterly-quarterly-median-rents-by-lga';

export type IndicatorStatus = 'observed' | 'suppressed' | 'missing';

export const homesVictoriaRentRawRecordSchema = z.object({
  quarter: z.string().trim().min(1),
  quarter_code: z.string().trim().min(1).nullable().optional(),
  period_start: z.string().trim().min(1).nullable().optional(),
  period_end: z.string().trim().min(1).nullable().optional(),
  lga_name: z.string().trim().min(1),
  region_group: z.string().trim().min(1).nullable().optional(),
  suburb: z.string().trim().min(1).nullable().optional(),
  property_type: z.string().trim().min(1),
  raw_count: z.union([z.string(), z.number()]).nullable().optional(),
  raw_median: z.union([z.string(), z.number()]).nullable().optional(),
  count: z.number().int().nonnegative().nullable().optional(),
  median_rent: z.number().nonnegative().nullable().optional(),
  measure: z.string().nullable().optional(),
  currency: z.string().nullable().optional(),
  status: z.enum(['observed', 'suppressed', 'missing']).nullable().optional(),
  source_updated_at: z.string().nullable().optional(),
  source_version_ordinal: z.number().int().nonnegative().nullable().optional(),
  record_status: z.enum(['active', 'corrected', 'cancelled', 'withdrawn']).optional(),
}).passthrough();

export type HomesVictoriaRentRawRecord = z.infer<typeof homesVictoriaRentRawRecordSchema>;

export const homesVictoriaPayloadSchema = z.object({
  total_count: z.number().int().nonnegative().nullable().optional(),
  source_url: z.string().nullable().optional(),
  publication_title: z.string().nullable().optional(),
  source_latest_update_at: z.iso.datetime({ offset: false }).nullable().optional(),
  results: z.array(homesVictoriaRentRawRecordSchema).min(1),
}).passthrough();

export const ckanResourceSchema = z.object({
  id: z.string(),
  name: z.string().optional().nullable(),
  format: z.string().optional().nullable(),
  url: z.string(),
  period_end: z.string().optional().nullable(),
  state: z.string().optional().nullable(),
}).passthrough();

export const ckanPackageSchema = z.object({
  success: z.boolean(),
  result: z.object({
    id: z.string().optional().nullable(),
    name: z.string().optional().nullable(),
    resources: z.array(ckanResourceSchema),
  }).passthrough(),
}).passthrough();

export interface HomesVictoriaPayload {
  total_count?: number | null | undefined;
  source_url?: string | null | undefined;
  publication_title?: string | null | undefined;
  source_latest_update_at?: UtcTimestamp | null | undefined;
  results: HomesVictoriaRentRawRecord[];
}

export interface NormalizedRentalRecord {
  source_record_id: string;
  lga_name: string;
  suburb: string | null;
  region_group: string | null;
  quarter: string;
  quarter_code: string;
  period_start: string;
  period_end: string;
  property_type: string;
  status: IndicatorStatus;
  count: number | null;
  median_weekly_rent: number | null;
  currency: 'AUD';
  unit: 'AUD/week';
  is_current_listing: false;
  is_prediction: false;
  definition: string;
}

export function computeSha256(data: string | object): string {
  const content = typeof data === 'string' ? data : JSON.stringify(data);
  return createHash('sha256').update(content).digest('hex');
}

export function slugify(str: string): string {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

export function parseQuarter(quarterStr: string): {
  quarterCode: string;
  periodStart: UtcTimestamp;
  periodEnd: UtcTimestamp;
  observedAt: UtcTimestamp;
} {
  const cleaned = quarterStr.trim();

  // Pattern: "YYYY-Q[1-4]"
  const isoQMatch = cleaned.match(/^(\d{4})[-_]?Q([1-4])$/i);
  if (isoQMatch && isoQMatch[1] !== undefined && isoQMatch[2] !== undefined) {
    const year = parseInt(isoQMatch[1], 10);
    const qNum = parseInt(isoQMatch[2], 10);
    return getQuarterBounds(year, qNum);
  }

  // Pattern: "Q[1-4] YYYY"
  const qIsoMatch = cleaned.match(/^Q([1-4])\s+(\d{4})$/i);
  if (qIsoMatch && qIsoMatch[1] !== undefined && qIsoMatch[2] !== undefined) {
    const qNum = parseInt(qIsoMatch[1], 10);
    const year = parseInt(qIsoMatch[2], 10);
    return getQuarterBounds(year, qNum);
  }

  // Pattern: "Month YYYY" (e.g. "Sep 2025", "March 2024")
  const monthMatch = cleaned.match(/^([a-zA-Z]+)\s+(\d{4})$/);
  if (monthMatch && monthMatch[1] !== undefined && monthMatch[2] !== undefined) {
    const month = monthMatch[1].toLowerCase();
    const year = parseInt(monthMatch[2], 10);
    let qNum = 1;
    if (month.startsWith('mar')) qNum = 1;
    else if (month.startsWith('jun')) qNum = 2;
    else if (month.startsWith('sep')) qNum = 3;
    else if (month.startsWith('dec')) qNum = 4;
    else {
      throw new Error(`Unrecognized quarterly reference month "${monthMatch[1]}". Expected Mar, Jun, Sep, or Dec.`);
    }
    return getQuarterBounds(year, qNum);
  }

  throw new Error(`Unrecognized quarter format: "${quarterStr}". Expected formats like "Sep 2025" or "2025-Q3".`);
}

function getQuarterBounds(year: number, qNum: number): {
  quarterCode: string;
  periodStart: UtcTimestamp;
  periodEnd: UtcTimestamp;
  observedAt: UtcTimestamp;
} {
  const quarterCode = `${year}-Q${qNum}`;
  switch (qNum) {
    case 1:
      return {
        quarterCode,
        periodStart: `${year}-01-01T00:00:00Z`,
        periodEnd: `${year}-04-01T00:00:00Z`,
        observedAt: `${year}-03-31T23:59:59Z`,
      };
    case 2:
      return {
        quarterCode,
        periodStart: `${year}-04-01T00:00:00Z`,
        periodEnd: `${year}-07-01T00:00:00Z`,
        observedAt: `${year}-06-30T23:59:59Z`,
      };
    case 3:
      return {
        quarterCode,
        periodStart: `${year}-07-01T00:00:00Z`,
        periodEnd: `${year}-10-01T00:00:00Z`,
        observedAt: `${year}-09-30T23:59:59Z`,
      };
    case 4:
      return {
        quarterCode,
        periodStart: `${year}-10-01T00:00:00Z`,
        periodEnd: `${year + 1}-01-01T00:00:00Z`,
        observedAt: `${year}-12-31T23:59:59Z`,
      };
    default:
      throw new Error(`Invalid quarter number: ${qNum}`);
  }
}

export function parseRentalValue(val: unknown): {
  numericValue: number | null;
  status: IndicatorStatus;
} {
  if (val === undefined || val === null) {
    return { numericValue: null, status: 'missing' };
  }

  if (typeof val === 'number') {
    if (isNaN(val)) return { numericValue: null, status: 'missing' };
    return { numericValue: val, status: 'observed' };
  }

  const str = String(val).trim();
  if (str === '' || str.toLowerCase() === 'null' || str.toLowerCase() === 'missing') {
    return { numericValue: null, status: 'missing' };
  }

  // Suppression markers in Victorian reports: "-", "<4", "< 4", "s", "n/a", etc.
  if (
    str === '-' ||
    str === '<4' ||
    str.replace(/\s+/g, '') === '<4' ||
    str.toLowerCase() === 's' ||
    str.toLowerCase() === 'suppressed' ||
    str.toLowerCase() === 'np' ||
    str === '..' ||
    str.toLowerCase() === 'n/a'
  ) {
    return { numericValue: null, status: 'suppressed' };
  }

  const sanitized = str.replace(/[$,\s]/g, '');
  const parsed = Number(sanitized);
  if (isNaN(parsed)) {
    return { numericValue: null, status: 'suppressed' };
  }

  return { numericValue: parsed, status: 'observed' };
}

export function normalizeHomesVictoriaRecord(
  raw: HomesVictoriaRentRawRecord,
  runId: string,
  fetchedAt: UtcTimestamp,
): {
  sourceRecord: SourceRecord;
  geoRecord: GeoRecord;
  geoRecordSource: GeoRecordSource;
  rentalRecord: NormalizedRentalRecord;
  areaIndicator: AreaIndicator;
} {
  const lgaName = raw.lga_name.trim();
  const suburb = raw.suburb && raw.suburb.trim() ? raw.suburb.trim() : null;
  const regionGroup = raw.region_group && raw.region_group.trim() ? raw.region_group.trim() : null;
  const propertyType = raw.property_type.trim();

  const quarterInfo = parseQuarter(raw.quarter);
  const quarterCode = raw.quarter_code || quarterInfo.quarterCode;
  const periodStart = (raw.period_start && !isNaN(Date.parse(raw.period_start)))
    ? new Date(raw.period_start).toISOString().replace('.000Z', 'Z')
    : quarterInfo.periodStart;
  const periodEnd = (raw.period_end && !isNaN(Date.parse(raw.period_end)))
    ? new Date(raw.period_end).toISOString().replace('.000Z', 'Z')
    : quarterInfo.periodEnd;
  const observedAt = quarterInfo.observedAt;

  const parsedCount = parseRentalValue(raw.count !== undefined ? raw.count : raw.raw_count);
  const parsedMedian = parseRentalValue(raw.median_rent !== undefined ? raw.median_rent : raw.raw_median);

  let recordStatus: IndicatorStatus = 'observed';
  if (raw.status) {
    recordStatus = raw.status;
  } else if (parsedMedian.status === 'suppressed' || parsedCount.status === 'suppressed') {
    recordStatus = 'suppressed';
  } else if (parsedMedian.status === 'missing' || parsedCount.status === 'missing') {
    recordStatus = parsedMedian.status;
  }

  // Safety invariant: 'observed' status strictly requires a non-null numeric value; missing/suppressed must be null
  if (recordStatus === 'observed' && parsedMedian.numericValue === null) {
    recordStatus = parsedMedian.status === 'suppressed' ? 'suppressed' : 'missing';
  }

  const finalCount = recordStatus === 'observed' ? parsedCount.numericValue : null;
  const finalMedian = recordStatus === 'observed' ? parsedMedian.numericValue : null;

  const lgaSlug = slugify(lgaName);
  const suburbSlug = suburb ? slugify(suburb) : null;
  const propTypeSlug = slugify(propertyType);
  const quarterSlug = slugify(quarterCode);
  const geoScopeToken = suburbSlug ? `${lgaSlug}_${suburbSlug}` : lgaSlug;

  const sourceRecId = sourceRecordId({
    sourceId: SOURCE_ID,
    nativeId: `${quarterSlug}:${geoScopeToken}:${propTypeSlug}`,
    originalUrl: LANDING_URL,
    sourceTime: periodStart,
  });

  const sourceUpdatedAt = (raw.source_updated_at && !isNaN(Date.parse(raw.source_updated_at)))
    ? new Date(raw.source_updated_at).toISOString().replace('.000Z', 'Z')
    : null;
  const sourceVersionOrdinal = typeof raw.source_version_ordinal === 'number'
    ? raw.source_version_ordinal
    : null;
  const recordStatusForSource: SourceRecordStatus = raw.record_status ?? 'active';

  const recVersionId = sourceVersionId(sourceUpdatedAt, {
    quarter: quarterCode,
    lga: lgaName,
    suburb,
    property_type: propertyType,
    status: recordStatus,
    median: finalMedian,
    count: finalCount,
    source_version_ordinal: sourceVersionOrdinal,
  });

  const boundaryId = suburbSlug
    ? `VIC_SUBURB_NAME:${suburbSlug}:unresolved`
    : `VIC_LGA_NAME:${lgaSlug}:unresolved`;
  const indicatorId = `${SOURCE_ID}:median_rent:${propTypeSlug}:${boundaryId.replace(/[: ]/g, '_')}:${quarterSlug}`;
  const indVersionId = computeSha256(`${indicatorId}\0${boundaryId}\0${recordStatus}\0${finalMedian}\0${finalCount}\0${periodStart}\0${periodEnd}\0${sourceUpdatedAt ?? ''}`);

  const definition = `Quarterly median weekly rent for ${propertyType} in ${suburb ? suburb + ', ' : ''}${lgaName} (${raw.quarter}) based on RTBA bond lodgements. Historical quarterly observation, strictly not active market rental vacancy listing.`;

  const sourceRecord: SourceRecord = {
    batch_id: runId,
    source_id: SOURCE_ID,
    schema_version: 1,
    fetched_at: fetchedAt,
    source_record_id: sourceRecId,
    version_id: recVersionId,
    original_url: LANDING_URL,
    raw_uri: null,
    published_at: null,
    observed_at: observedAt,
    first_accessible_at: null,
    time_missing_reason: null,
    valid_from: periodStart,
    valid_to: periodEnd,
    source_updated_at: sourceUpdatedAt,
    source_version_ordinal: sourceVersionOrdinal,
    record_status: recordStatusForSource,
    assertion_kind: 'observation',
    rights_status: 'verified_open',
  };

  const areaIndicatorBase = {
    batch_id: runId,
    source_id: SOURCE_ID,
    schema_version: 1,
    fetched_at: fetchedAt,
    indicator_id: indicatorId,
    version_id: indVersionId,
    boundary_id: boundaryId,
    period_start: periodStart,
    period_end: periodEnd,
    unit: 'AUD/week',
    assertion_kind: 'observation' as const,
    source_record_id: sourceRecId,
    definition,
    source_area_name: suburb ? `${lgaName} - ${suburb}` : lgaName,
    source_area_code: null,
    source_area_vintage: null,
    source_updated_at: sourceUpdatedAt,
    source_version_ordinal: sourceVersionOrdinal,
  };

  const areaIndicator: AreaIndicator = recordStatus === 'observed'
    ? { ...areaIndicatorBase, status: 'observed', value: finalMedian as number }
    : { ...areaIndicatorBase, status: recordStatus, value: null };

  const areaRefs: string[] = [`lga:${lgaSlug}`];
  if (suburbSlug) {
    areaRefs.push(`suburb:${suburbSlug}`);
  }
  if (regionGroup) {
    areaRefs.push(`vic_region:${slugify(regionGroup)}`);
  }

  const geoRecordId = `geo:${sourceRecId}`;
  const geoVersionId = computeSha256(`${recVersionId}\0geo`);
  const statusSummary =
    recordStatus === 'observed'
      ? `$${finalMedian}/week with ${finalCount ?? 'unspecified'} rental bonds lodged`
      : recordStatus === 'suppressed'
      ? 'Suppressed for statistical privacy (<4 rental bonds lodged)'
      : 'Missing / No records for statistical period';

  const geoRecordSummary = `Homes Victoria quarterly rental report for ${lgaName}${suburb ? ' (' + suburb + ')' : ''} [${raw.quarter}]: ${propertyType} - ${statusSummary}. Historical quarterly bond lodgement statistic, NOT current active rental vacancy listing.`;

  const geoRecord: GeoRecord = {
    batch_id: runId,
    source_id: SOURCE_ID,
    schema_version: 1,
    fetched_at: fetchedAt,
    geo_record_id: geoRecordId,
    version_id: geoVersionId,
    topic: 'housing',
    assertion_kind: 'observation',
    title: `${lgaName}${suburb ? ' (' + suburb + ')' : ''} ${propertyType} Median Rent (${raw.quarter})`,
    summary: geoRecordSummary,
    original_url: LANDING_URL,
    geometry_geojson: null,
    centroid_lat: null,
    centroid_lon: null,
    location_role: 'area_only',
    location_confidence: 'official_join',
    area_refs: areaRefs,
    published_at: null,
    observed_at: observedAt,
    valid_from: periodStart,
    valid_to: periodEnd,
    source_updated_at: sourceUpdatedAt,
    source_version_ordinal: sourceVersionOrdinal,
    freshness_state: 'current',
    record_status: 'active',
    rights_status: 'verified_open',
    public_query_allowed: true,
  };

  const geoRecordSource: GeoRecordSource = {
    batch_id: runId,
    source_id: SOURCE_ID,
    schema_version: 1,
    fetched_at: fetchedAt,
    geo_record_id: geoRecordId,
    version_id: geoVersionId,
    source_record_id: sourceRecId,
    source_version_id: recVersionId,
    evidence_role: 'rtba_quarterly_rental_report',
    original_url: LANDING_URL,
  };

  const rentalRecord: NormalizedRentalRecord = {
    source_record_id: sourceRecId,
    lga_name: lgaName,
    suburb,
    region_group: regionGroup,
    quarter: raw.quarter,
    quarter_code: quarterCode,
    period_start: periodStart,
    period_end: periodEnd,
    property_type: propertyType,
    status: recordStatus,
    count: finalCount,
    median_weekly_rent: finalMedian,
    currency: 'AUD',
    unit: 'AUD/week',
    is_current_listing: false,
    is_prediction: false,
    definition,
  };

  return {
    sourceRecord,
    geoRecord,
    geoRecordSource,
    rentalRecord,
    areaIndicator,
  };
}

export function normalizeRentalPayload(
  payload: HomesVictoriaPayload,
  runId: string,
  fetchedAt: UtcTimestamp,
): {
  sourceRecords: SourceRecord[];
  geoRecords: GeoRecord[];
  geoRecordSources: GeoRecordSource[];
  rentalRecords: NormalizedRentalRecord[];
  areaIndicators: AreaIndicator[];
} {
  const sourceRecords: SourceRecord[] = [];
  const geoRecords: GeoRecord[] = [];
  const geoRecordSources: GeoRecordSource[] = [];
  const rentalRecords: NormalizedRentalRecord[] = [];
  const areaIndicators: AreaIndicator[] = [];

  for (const raw of payload.results) {
    const validated = homesVictoriaRentRawRecordSchema.parse(raw);
    const normalized = normalizeHomesVictoriaRecord(validated, runId, fetchedAt);
    sourceRecords.push(normalized.sourceRecord);
    geoRecords.push(normalized.geoRecord);
    geoRecordSources.push(normalized.geoRecordSource);
    rentalRecords.push(normalized.rentalRecord);
    areaIndicators.push(normalized.areaIndicator);
  }

  return {
    sourceRecords,
    geoRecords,
    geoRecordSources,
    rentalRecords,
    areaIndicators,
  };
}

export interface HomesVictoriaRentsConnectorOptions {
  readonly http?: HttpClient;
  readonly catalogUrl?: string | null;
  readonly fixturePath?: string | null;
  readonly rawData?: unknown | null;
}

class ResourceSchemaError extends Error {}

export function workbookModifiedAt(lastModified: string | null, fetchedAt: UtcTimestamp): UtcTimestamp {
  const modifiedMs = lastModified === null ? NaN : Date.parse(lastModified);
  if (!Number.isFinite(modifiedMs) || modifiedMs > Date.parse(fetchedAt)) {
    throw new ResourceSchemaError('Homes Victoria workbook has no valid Last-Modified revision time');
  }
  return new Date(modifiedMs).toISOString().replace('.000Z', 'Z');
}

function latestWorkbookResource(catalog: z.infer<typeof ckanPackageSchema>) {
  if (!catalog.success) throw new ResourceSchemaError('Homes Victoria catalog reported failure');
  const resources = catalog.result.resources.filter(resource =>
    resource.format?.toUpperCase() === 'XLSX'
    && resource.state !== 'deleted'
    && typeof resource.period_end === 'string'
    && /^\d{4}-\d{2}-\d{2}$/.test(resource.period_end));
  resources.sort((a, b) => (b.period_end ?? '').localeCompare(a.period_end ?? ''));
  const latest = resources[0];
  if (!latest?.period_end) throw new ResourceSchemaError('No dated Homes Victoria XLSX resource');
  const url = new URL(latest.url);
  if (url.protocol !== 'https:' || !['www.dffh.vic.gov.au', 'www.dhhs.vic.gov.au'].includes(url.hostname)) {
    throw new ResourceSchemaError('Homes Victoria XLSX URL is outside the official provider domains');
  }
  return latest;
}

export class HomesVictoriaRentsConnector implements Connector {
  readonly sourceId = SOURCE_ID;
  private readonly http: HttpClient;
  private readonly catalogUrl: string | null;
  private readonly fixturePath: string | null;
  private readonly rawData: unknown | null;

  constructor(options: HomesVictoriaRentsConnectorOptions = {}) {
    this.http = options.http ?? new HttpClient();
    this.catalogUrl = options.catalogUrl === undefined ? DEFAULT_CKAN_PACKAGE_URL : options.catalogUrl;
    this.fixturePath = options.fixturePath ?? null;
    this.rawData = options.rawData ?? null;
  }

  private async loadPayload(): Promise<HomesVictoriaPayload> {
    if (this.rawData) {
      if (Array.isArray(this.rawData)) {
        const parsedArray = z.array(homesVictoriaRentRawRecordSchema).safeParse(this.rawData);
        if (!parsedArray.success) {
          throw new ResourceSchemaError(`Malformed Homes Victoria record array: ${parsedArray.error.message}`);
        }
        return { results: parsedArray.data };
      }
      const parsed = homesVictoriaPayloadSchema.safeParse(this.rawData);
      if (!parsed.success) {
        throw new ResourceSchemaError(`Malformed Homes Victoria payload envelope: ${parsed.error.message}`);
      }
      return parsed.data;
    }

    if (this.fixturePath) {
      let text: string;
      try {
        text = await readFile(this.fixturePath, 'utf8');
      } catch (error) {
        throw new Error(`Failed to read Homes Victoria fixture file: ${error instanceof Error ? error.message : String(error)}`);
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch (error) {
        throw new ResourceSchemaError(`Invalid JSON in Homes Victoria fixture file: ${error instanceof Error ? error.message : String(error)}`);
      }
      if (Array.isArray(parsed)) {
        const parsedArray = z.array(homesVictoriaRentRawRecordSchema).safeParse(parsed);
        if (!parsedArray.success) {
          throw new ResourceSchemaError(`Malformed Homes Victoria fixture record array: ${parsedArray.error.message}`);
        }
        return { results: parsedArray.data };
      }
      const parsedPayload = homesVictoriaPayloadSchema.safeParse(parsed);
      if (!parsedPayload.success) {
        throw new ResourceSchemaError(`Malformed Homes Victoria fixture envelope: ${parsedPayload.error.message}`);
      }
      return parsedPayload.data;
    }

    if (!this.catalogUrl) throw new Error('Homes Victoria rental report resource is not configured');
    const catalogResponse = await this.http.getJson({ url: this.catalogUrl, timeoutMs: 30_000 });
    const catalog = ckanPackageSchema.safeParse(catalogResponse.body);
    if (!catalog.success) {
      const payloadCandidate = homesVictoriaPayloadSchema.safeParse(catalogResponse.body);
      if (payloadCandidate.success) return payloadCandidate.data;
      throw new ResourceSchemaError('Changed Homes Victoria catalog response');
    }
    const resource = latestWorkbookResource(catalog.data);
    const workbook = await this.http.getBytes({ url: resource.url, timeoutMs: 60_000 });
    const sourceUpdatedAt = workbookModifiedAt(workbook.lastModified, workbook.fetchedAt);
    let records: HomesVictoriaRentRawRecord[];
    try {
      records = await parseHomesVictoriaWorkbook(workbook.body, resource.period_end!);
    } catch (error) {
      throw new ResourceSchemaError(error instanceof Error ? error.message : 'Invalid rental workbook');
    }
    return { results: records.map(record => ({ ...record, source_updated_at: sourceUpdatedAt })),
      total_count: records.length, source_latest_update_at: sourceUpdatedAt,
      source_url: resource.url, publication_title: resource.name ?? null };
  }

  async collect(input: ConnectorInput): Promise<ConnectorResult> {
    const checkedAt = new Date().toISOString();

    if (input.sourceId !== SOURCE_ID) {
      return {
        kind: 'failure',
        sourceId: SOURCE_ID,
        runId: input.runId,
        checkedAt,
        code: 'validation_failed',
        message: `Invalid sourceId: ${input.sourceId}. Expected ${SOURCE_ID}`,
        retryAfterSeconds: null,
        sourceLatestUpdateAt: null,
        completeness: {
          complete: false,
          expected_records: null,
          fetched_records: 0,
          expected_pages: 1,
          fetched_pages: 0,
          evidence: 'Mismatched sourceId',
        },
      };
    }

    let payload: HomesVictoriaPayload;
    try {
      payload = await this.loadPayload();
    } catch (error) {
      const code = error instanceof HttpFailure ? error.code
        : error instanceof ResourceSchemaError ? 'schema_changed' : 'upstream_unavailable';
      const message = error instanceof Error ? error.message : 'Failed to load Homes Victoria rental report';
      return {
        kind: 'failure',
        sourceId: SOURCE_ID,
        runId: input.runId,
        checkedAt,
        code,
        message,
        retryAfterSeconds: error instanceof HttpFailure && error.status === 429 ? 60 : null,
        completeness: {
          complete: false,
          expected_records: null,
          fetched_records: 0,
          expected_pages: 1,
          fetched_pages: 0,
          evidence: message,
        },
        sourceLatestUpdateAt: null,
      };
    }

    const parsedPayload = homesVictoriaPayloadSchema.safeParse(payload);
    if (!parsedPayload.success || parsedPayload.data.results.length === 0) {
      return {
        kind: 'failure', sourceId: SOURCE_ID, runId: input.runId, checkedAt,
        code: 'schema_changed',
        message: 'Homes Victoria response must contain nonempty rental rows',
        retryAfterSeconds: null, sourceLatestUpdateAt: null,
        completeness: { complete: false, expected_records: null, fetched_records: 0,
          expected_pages: 1, fetched_pages: 0,
          evidence: 'Rental rows missing or not in the expected resource format' },
      };
    }
    payload = { ...payload, results: parsedPayload.data.results };
    const rawRecords = payload.results;

    // Optional filtering if window specifies time
    let filteredRecords = rawRecords;
    if (input.window.kind === 'time') {
      const fromMs = Date.parse(input.window.from);
      const toMs = Date.parse(input.window.to);
      filteredRecords = rawRecords.filter(r => {
        try {
          const qInfo = parseQuarter(r.quarter);
          const startMs = Date.parse(r.period_start || qInfo.periodStart);
          return startMs >= fromMs && startMs < toMs;
        } catch {
          return true;
        }
      });
    }

    let normalized: ReturnType<typeof normalizeRentalPayload>;
    try {
      normalized = normalizeRentalPayload(
        { ...payload, results: filteredRecords },
        input.runId,
        checkedAt,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Homes Victoria record normalization failed';
      return {
        kind: 'failure',
        sourceId: SOURCE_ID,
        runId: input.runId,
        checkedAt,
        code: error instanceof z.ZodError ? 'schema_changed' : 'validation_failed',
        message,
        retryAfterSeconds: null,
        completeness: {
          complete: false,
          expected_records: null,
          fetched_records: 0,
          expected_pages: 1,
          fetched_pages: 0,
          evidence: message,
        },
        sourceLatestUpdateAt: null,
      };
    }

    const recordSignatures = normalized.sourceRecords.map(r => `${r.source_record_id}:${r.version_id}`).sort();
    const sourceRevision = computeSha256(recordSignatures.join('\n'));

    const checkpointAfter = input.window.kind === 'time'
      ? input.window.to
      : (input.window.revision === 'latest' ? sourceRevision : input.window.revision);

    const success: ConnectorSuccess = {
      kind: 'success',
      sourceId: SOURCE_ID,
      runId: input.runId,
      fetchedAt: checkedAt,
      sourceRevision,
      sourceLatestUpdateAt: payload.source_latest_update_at ?? null,
      checkpointAfter,
      completeness: {
        complete: true,
        method: 'export_count',
        expected_records: filteredRecords.length,
        fetched_records: filteredRecords.length,
        expected_pages: 1,
        fetched_pages: 1,
        evidence: `All ${filteredRecords.length} Homes Victoria quarterly median rent records parsed and validated without zero-filling suppressed counts`,
      },
      inputCount: filteredRecords.length,
      outputCount: normalized.areaIndicators.length,
      rejectedCount: 0,
      sourceRecords: normalized.sourceRecords,
      geoRecords: normalized.geoRecords,
      geoRecordSources: normalized.geoRecordSources,
      boundaries: [],
      areaIndicators: normalized.areaIndicators,
      parkingBays: [],
      parkingObservations: [],
      parkingRules: [],
      sensorLocations: [],
      pedestrianObservations: [],
      retainableRawRecords: null,
    };

    return success;
  }
}

export const connector: Connector = new HomesVictoriaRentsConnector();
export default connector;
