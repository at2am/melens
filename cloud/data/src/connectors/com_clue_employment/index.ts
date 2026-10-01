import { createHash } from 'node:crypto';
import { z } from 'zod';

import type {
  Connector,
  ConnectorFailure,
  ConnectorInput,
  ConnectorResult,
  ConnectorSuccess,
} from '../../core/connector.js';
import { HttpFailure } from '../../core/http.js';
import { OdsIncompleteWindow, OpenDataSoftClient } from '../../core/opendatasoft.js';
import type { AreaIndicator, SourceRecord } from '../../core/types.js';
import { sourceRecordId, sourceVersionId } from '../../validation/record.js';

export const SOURCE_ID = 'melbourne.clue.employment';
export const DATASET_ID = 'employment-by-block-by-clue-industry';
export const LANDING_URL = `https://data.melbourne.vic.gov.au/explore/dataset/${DATASET_ID}/`;
export const DEFAULT_PORTAL_URL = 'https://data.melbourne.vic.gov.au';
export const DEFAULT_YEAR = '2024';

export const CLUE_INDUSTRIES = [
  { key: 'accommodation', label: 'Accommodation' },
  { key: 'admin_and_support_services', label: 'Administrative and Support Services' },
  { key: 'agriculture_and_mining', label: 'Agriculture, Forestry, Fishing and Mining' },
  { key: 'arts_and_recreation_services', label: 'Arts and Recreation Services' },
  { key: 'business_services', label: 'Business Services' },
  { key: 'construction', label: 'Construction' },
  { key: 'education_and_training', label: 'Education and Training' },
  { key: 'electricity_gas_water_and_waste_services', label: 'Electricity, Gas, Water and Waste Services' },
  { key: 'finance_and_insurance', label: 'Financial and Insurance Services' },
  { key: 'food_and_beverage_services', label: 'Food and Beverage Services' },
  { key: 'health_care_and_social_assistance', label: 'Health Care and Social Assistance' },
  { key: 'information_media_and_telecommunications', label: 'Information Media and Telecommunications' },
  { key: 'manufacturing', label: 'Manufacturing' },
  { key: 'other_services', label: 'Other Services' },
  { key: 'public_administration_and_safety', label: 'Public Administration and Safety' },
  { key: 'real_estate_services', label: 'Real Estate Services' },
  { key: 'rental_and_hiring_services', label: 'Rental and Hiring Services' },
  { key: 'retail_trade', label: 'Retail Trade' },
  { key: 'transport_postal_and_storage', label: 'Transport, Postal and Storage' },
  { key: 'wholesale_trade', label: 'Wholesale Trade' },
] as const;

export type ClueIndustryKey = (typeof CLUE_INDUSTRIES)[number]['key'];

export const clueEmploymentRowSchema = z.object({
  census_year: z.union([z.string(), z.number()])
    .transform(val => String(val).trim())
    .refine(val => /^\d{4}(?:-01-01(?:T00:00:00(?:\.000)?(?:Z|[+-]\d{2}:?\d{2})?)?)?$/.test(val), 'Invalid CLUE census year')
    .transform(val => val.slice(0, 4)),
  block_id: z.number().int(),
  clue_small_area: z.string().trim().min(1),
  accommodation: z.number().int().nonnegative().nullable().optional(),
  admin_and_support_services: z.number().int().nonnegative().nullable().optional(),
  agriculture_and_mining: z.number().int().nonnegative().nullable().optional(),
  arts_and_recreation_services: z.number().int().nonnegative().nullable().optional(),
  business_services: z.number().int().nonnegative().nullable().optional(),
  construction: z.number().int().nonnegative().nullable().optional(),
  education_and_training: z.number().int().nonnegative().nullable().optional(),
  electricity_gas_water_and_waste_services: z.number().int().nonnegative().nullable().optional(),
  finance_and_insurance: z.number().int().nonnegative().nullable().optional(),
  food_and_beverage_services: z.number().int().nonnegative().nullable().optional(),
  health_care_and_social_assistance: z.number().int().nonnegative().nullable().optional(),
  information_media_and_telecommunications: z.number().int().nonnegative().nullable().optional(),
  manufacturing: z.number().int().nonnegative().nullable().optional(),
  other_services: z.number().int().nonnegative().nullable().optional(),
  public_administration_and_safety: z.number().int().nonnegative().nullable().optional(),
  real_estate_services: z.number().int().nonnegative().nullable().optional(),
  rental_and_hiring_services: z.number().int().nonnegative().nullable().optional(),
  retail_trade: z.number().int().nonnegative().nullable().optional(),
  transport_postal_and_storage: z.number().int().nonnegative().nullable().optional(),
  wholesale_trade: z.number().int().nonnegative().nullable().optional(),
  total_jobs_in_block: z.number().int().nonnegative().nullable().optional(),
}).passthrough();

export type ClueEmploymentRawRow = z.infer<typeof clueEmploymentRowSchema>;

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function parseClueEmploymentRow(value: unknown): ClueEmploymentRawRow {
  return clueEmploymentRowSchema.parse(value);
}

export interface ClueEmploymentNormalizedBlock {
  readonly sourceRecord: SourceRecord;
  readonly indicators: readonly AreaIndicator[];
}

export function normalizeClueEmploymentRow(
  row: ClueEmploymentRawRow,
  runId: string,
  fetchedAt: string,
  lastModified: string | null,
): ClueEmploymentNormalizedBlock {
  const censusYear = row.census_year;
  const periodStart = `${censusYear}-01-01T00:00:00Z`;
  const periodEnd = `${Number(censusYear) + 1}-01-01T00:00:00Z`;
  // The published CLUE block polygon layer was realigned in 2025. Historic
  // employment years cannot be attached to it without an official crosswalk.
  const boundaryId = `CLUE_BLOCK_UNRESOLVED:${row.block_id}:${censusYear}`;

  const nativeId = `${censusYear}:${row.block_id}`;
  const recordId = sourceRecordId({
    sourceId: SOURCE_ID,
    nativeId,
    originalUrl: LANDING_URL,
    sourceTime: null,
  });
  const versionId = sourceVersionId(lastModified, row);

  const sourceRecord: SourceRecord = {
    batch_id: runId,
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
    time_missing_reason: 'CLUE provides the census year, not a precise observation date',
    valid_from: periodStart,
    valid_to: periodEnd,
    source_updated_at: lastModified,
    source_version_ordinal: null,
    record_status: 'active',
    assertion_kind: 'observation',
    rights_status: 'review_required',
  };

  const indicators: AreaIndicator[] = [];

  for (const industry of CLUE_INDUSTRIES) {
    const rawVal = row[industry.key as keyof ClueEmploymentRawRow] as number | null | undefined;
    const isSuppressed = rawVal === null || rawVal === undefined;
    const status: AreaIndicator['status'] = isSuppressed ? 'suppressed' : 'observed';
    const value = isSuppressed ? null : (rawVal as number);

    const indicatorId = digest(`${SOURCE_ID}:${censusYear}:${row.block_id}:${industry.key}`);
    const indicatorVersionId = digest(`${versionId}\0${industry.key}\0${status}\0${value}`);

    const baseIndicator = {
      batch_id: runId,
      source_id: SOURCE_ID,
      schema_version: 1,
      fetched_at: fetchedAt,
      indicator_id: indicatorId,
      version_id: indicatorVersionId,
      boundary_id: boundaryId,
      period_start: periodStart,
      period_end: periodEnd,
      unit: 'jobs',
      assertion_kind: 'observation' as const,
      definition: `CLUE ${censusYear} employment in ${industry.label} for block ${row.block_id} (${row.clue_small_area})`,
      source_area_name: row.clue_small_area,
      source_area_code: String(row.block_id),
      source_area_vintage: null,
      source_record_id: recordId,
      source_updated_at: lastModified,
      source_version_ordinal: null,
    };

    if (status === 'observed') {
      indicators.push({
        ...baseIndicator,
        status: 'observed',
        value: value as number,
      });
    } else {
      indicators.push({
        ...baseIndicator,
        status: 'suppressed',
        value: null,
      });
    }
  }

  const rawTotal = row.total_jobs_in_block;
  const isTotalMissing = rawTotal === null || rawTotal === undefined;
  const totalStatus: AreaIndicator['status'] = isTotalMissing ? 'missing' : 'observed';
  const totalValue = isTotalMissing ? null : rawTotal;

  const totalIndicatorId = digest(`${SOURCE_ID}:${censusYear}:${row.block_id}:total_jobs_in_block`);
  const totalVersionId = digest(`${versionId}\0total_jobs_in_block\0${totalStatus}\0${totalValue}`);

  const baseTotalIndicator = {
    batch_id: runId,
    source_id: SOURCE_ID,
    schema_version: 1,
    fetched_at: fetchedAt,
    indicator_id: totalIndicatorId,
    version_id: totalVersionId,
    boundary_id: boundaryId,
    period_start: periodStart,
    period_end: periodEnd,
    unit: 'jobs',
    assertion_kind: 'observation' as const,
    definition: `CLUE ${censusYear} total employment for block ${row.block_id} (${row.clue_small_area})`,
    source_area_name: row.clue_small_area,
    source_area_code: String(row.block_id),
    source_area_vintage: null,
    source_record_id: recordId,
    source_updated_at: lastModified,
    source_version_ordinal: null,
  };

  if (totalStatus === 'observed') {
    indicators.push({
      ...baseTotalIndicator,
      status: 'observed',
      value: totalValue as number,
    });
  } else {
    indicators.push({
      ...baseTotalIndicator,
      status: 'missing',
      value: null,
    });
  }

  return { sourceRecord, indicators };
}

export interface ClueEmploymentConnectorOptions {
  client?: OpenDataSoftClient;
  portalUrl?: string;
  fetchMetadataRevision?: boolean;
}

export class ClueEmploymentConnector implements Connector {
  readonly sourceId = SOURCE_ID;
  private readonly client: OpenDataSoftClient;
  private readonly portalUrl: string;
  private readonly autoFetchMetadata: boolean;

  constructor(
    clientOrOptions?: OpenDataSoftClient | ClueEmploymentConnectorOptions,
    portalUrl: string = DEFAULT_PORTAL_URL,
  ) {
    if (clientOrOptions instanceof OpenDataSoftClient) {
      this.client = clientOrOptions;
      this.portalUrl = portalUrl;
      this.autoFetchMetadata = false;
    } else if (clientOrOptions && typeof clientOrOptions === 'object') {
      this.client = clientOrOptions.client ?? new OpenDataSoftClient();
      this.portalUrl = clientOrOptions.portalUrl ?? DEFAULT_PORTAL_URL;
      this.autoFetchMetadata = clientOrOptions.fetchMetadataRevision ?? false;
    } else {
      this.client = new OpenDataSoftClient();
      this.portalUrl = portalUrl;
      this.autoFetchMetadata = false;
    }
  }

  async fetchMetadataRevision(): Promise<string> {
    return this.client.fetchDatasetDataProcessed({
      portalUrl: this.portalUrl,
      datasetId: DATASET_ID,
    });
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
        message: `Expected sourceId ${SOURCE_ID}, got ${input.sourceId}`,
        retryAfterSeconds: null,
        completeness: {
          complete: false,
          expected_records: null,
          fetched_records: 0,
          expected_pages: null,
          fetched_pages: 0,
          evidence: 'Invalid sourceId provided',
        },
        sourceLatestUpdateAt: null,
      };
    }

    let year = DEFAULT_YEAR;
    if (input.window.kind === 'snapshot') {
      if (input.window.revision !== 'latest' && /^\d{4}$/.test(input.window.revision)) {
        year = input.window.revision;
      }
    } else {
      year = String(new Date(input.window.from).getUTCFullYear());
    }

    try {
      const response = await this.client.fetchRecords({
        portalUrl: this.portalUrl,
        datasetId: DATASET_ID,
        where: `census_year = date'${year}-01-01'`,
        orderBy: 'block_id ASC',
      });

      if (response.records.length === 0) {
        throw new Error(`No CLUE employment records found for census year ${year}`);
      }

      let sourceUpdatedAt = response.lastModified;
      if (sourceUpdatedAt === null && this.autoFetchMetadata) {
        try {
          sourceUpdatedAt = await this.fetchMetadataRevision();
        } catch {
          // If metadata endpoint is unavailable, retain null
        }
      }

      const sourceRecords: SourceRecord[] = [];
      const areaIndicators: AreaIndicator[] = [];
      const seenNativeIds = new Set<string>();

      for (const raw of response.records) {
        const row = parseClueEmploymentRow(raw);
        if (row.census_year !== year) {
          throw new Error(`CLUE response year ${row.census_year} differs from requested ${year}`);
        }
        const nativeId = `${row.census_year}:${row.block_id}`;
        if (seenNativeIds.has(nativeId)) {
          throw new Error(`Duplicate (census_year, block_id) detected: ${nativeId}`);
        }
        seenNativeIds.add(nativeId);

        const normalized = normalizeClueEmploymentRow(
          row,
          input.runId,
          response.fetchedAt,
          sourceUpdatedAt,
        );
        sourceRecords.push(normalized.sourceRecord);
        areaIndicators.push(...normalized.indicators);
      }

      const sourceRevision = digest(sourceRecords.map(r => r.version_id).sort().join('\n'));
      const checkpointAfter = input.window.kind === 'time' ? input.window.to : year;

      const success: ConnectorSuccess = {
        kind: 'success',
        sourceId: SOURCE_ID,
        runId: input.runId,
        fetchedAt: response.fetchedAt,
        sourceRevision,
        sourceLatestUpdateAt: sourceUpdatedAt,
        checkpointAfter,
        completeness: {
          complete: true,
          method: 'pagination',
          expected_records: response.totalCount,
          fetched_records: sourceRecords.length,
          expected_pages: response.pageCount,
          fetched_pages: response.pageCount,
          evidence: `All ${response.totalCount} CLUE employment records for census year ${year} retrieved and normalized without zero-filling suppressed counts`,
        },
        inputCount: response.records.length,
        outputCount: areaIndicators.length,
        rejectedCount: 0,
        sourceRecords,
        geoRecords: [],
        geoRecordSources: [],
        boundaries: [],
        areaIndicators,
        parkingBays: [],
        parkingObservations: [],
        parkingRules: [],
        sensorLocations: [],
        pedestrianObservations: [],
        retainableRawRecords: null,
      };
      return success;
    } catch (error) {
      const code = error instanceof HttpFailure
        ? error.code
        : error instanceof OdsIncompleteWindow
        ? error.code
        : error instanceof z.ZodError
        ? 'schema_changed'
        : 'validation_failed';

      const message = error instanceof Error ? error.message : 'CLUE employment validation failed';

      const failure: ConnectorFailure = {
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
          expected_pages: null,
          fetched_pages: 0,
          evidence: `CLUE employment collection failed: ${message}`,
        },
        sourceLatestUpdateAt: null,
      };
      return failure;
    }
  }
}

export const connector = new ClueEmploymentConnector();
export default connector;
