import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { z } from 'zod';

import type {
  Connector,
  ConnectorFailure,
  ConnectorInput,
  ConnectorResult,
  ConnectorSuccess,
} from '../../core/connector.js';
import { HttpClient, HttpFailure } from '../../core/http.js';
import type {
  AreaIndicator,
  SourceRecord,
  UtcTimestamp,
} from '../../core/types.js';
import { sourceRecordId, sourceVersionId } from '../../validation/record.js';
import { fetchAbsArchiveTables, type AbsGeography } from './archive.js';

export const SOURCE_ID = 'abs.census';
export const PROVIDER = 'Australian Bureau of Statistics';
export const DATASET_TITLE = '2021 Census DataPacks for Victoria and Greater Melbourne (SA1/SA2/LGA)';
export const LANDING_URL = 'https://www.abs.gov.au/census/find-census-data/datapacks';

export const DEFAULT_CENSUS_YEAR = 2021;
export const DEFAULT_ASGS_VINTAGE = '2021';
export const DEFAULT_PERIOD_START: UtcTimestamp = '2021-08-10T00:00:00Z';
export const DEFAULT_PERIOD_END: UtcTimestamp = '2021-08-11T00:00:00Z';
export const DEFAULT_PUBLISHED_AT: UtcTimestamp = '2022-06-28T00:00:00Z';

export type CensusGeographicScheme = 'ASGS_SA1' | 'ASGS_SA2' | 'ASGS_LGA';
export type CensusIndicatorStatus = 'observed' | 'suppressed' | 'missing';

export interface CensusMetricMetadata {
  readonly definition: string;
  readonly unit: string;
}

export const CENSUS_DATA_DICTIONARY: Readonly<Record<string, CensusMetricMetadata>> = {
  Tot_P_M: { definition: '2021 Census Total Males (Persons)', unit: 'persons' },
  Tot_P_F: { definition: '2021 Census Total Females (Persons)', unit: 'persons' },
  Tot_P_P: { definition: '2021 Census Total Persons (Persons)', unit: 'persons' },
  Age_0_4_yr_M: { definition: '2021 Census Males Aged 0-4 Years', unit: 'persons' },
  Age_0_4_yr_F: { definition: '2021 Census Females Aged 0-4 Years', unit: 'persons' },
  Age_0_4_yr_P: { definition: '2021 Census Persons Aged 0-4 Years', unit: 'persons' },
  Age_5_14_yr_M: { definition: '2021 Census Males Aged 5-14 Years', unit: 'persons' },
  Age_5_14_yr_F: { definition: '2021 Census Females Aged 5-14 Years', unit: 'persons' },
  Age_5_14_yr_P: { definition: '2021 Census Persons Aged 5-14 Years', unit: 'persons' },
  Age_15_19_yr_M: { definition: '2021 Census Males Aged 15-19 Years', unit: 'persons' },
  Age_15_19_yr_F: { definition: '2021 Census Females Aged 15-19 Years', unit: 'persons' },
  Age_15_19_yr_P: { definition: '2021 Census Persons Aged 15-19 Years', unit: 'persons' },
  Age_20_24_yr_M: { definition: '2021 Census Males Aged 20-24 Years', unit: 'persons' },
  Age_20_24_yr_F: { definition: '2021 Census Females Aged 20-24 Years', unit: 'persons' },
  Age_20_24_yr_P: { definition: '2021 Census Persons Aged 20-24 Years', unit: 'persons' },
  Age_25_34_yr_M: { definition: '2021 Census Males Aged 25-34 Years', unit: 'persons' },
  Age_25_34_yr_F: { definition: '2021 Census Females Aged 25-34 Years', unit: 'persons' },
  Age_25_34_yr_P: { definition: '2021 Census Persons Aged 25-34 Years', unit: 'persons' },
  Age_35_44_yr_M: { definition: '2021 Census Males Aged 35-44 Years', unit: 'persons' },
  Age_35_44_yr_F: { definition: '2021 Census Females Aged 35-44 Years', unit: 'persons' },
  Age_35_44_yr_P: { definition: '2021 Census Persons Aged 35-44 Years', unit: 'persons' },
  Age_45_54_yr_M: { definition: '2021 Census Males Aged 45-54 Years', unit: 'persons' },
  Age_45_54_yr_F: { definition: '2021 Census Females Aged 45-54 Years', unit: 'persons' },
  Age_45_54_yr_P: { definition: '2021 Census Persons Aged 45-54 Years', unit: 'persons' },
  Age_55_64_yr_M: { definition: '2021 Census Males Aged 55-64 Years', unit: 'persons' },
  Age_55_64_yr_F: { definition: '2021 Census Females Aged 55-64 Years', unit: 'persons' },
  Age_55_64_yr_P: { definition: '2021 Census Persons Aged 55-64 Years', unit: 'persons' },
  Age_65_74_yr_M: { definition: '2021 Census Males Aged 65-74 Years', unit: 'persons' },
  Age_65_74_yr_F: { definition: '2021 Census Females Aged 65-74 Years', unit: 'persons' },
  Age_65_74_yr_P: { definition: '2021 Census Persons Aged 65-74 Years', unit: 'persons' },
  Age_75_84_yr_M: { definition: '2021 Census Males Aged 75-84 Years', unit: 'persons' },
  Age_75_84_yr_F: { definition: '2021 Census Females Aged 75-84 Years', unit: 'persons' },
  Age_75_84_yr_P: { definition: '2021 Census Persons Aged 75-84 Years', unit: 'persons' },
  Age_85ov_M: { definition: '2021 Census Males Aged 85 Years and Over', unit: 'persons' },
  Age_85ov_F: { definition: '2021 Census Females Aged 85 Years and Over', unit: 'persons' },
  Age_85ov_P: { definition: '2021 Census Persons Aged 85 Years and Over', unit: 'persons' },
  Median_age_persons: { definition: '2021 Census Median Age of Persons', unit: 'years' },
  Median_mortgage_repay_monthly: { definition: '2021 Census Median Monthly Mortgage Repayment', unit: 'aud_monthly' },
  Median_tot_prsnl_inc_weekly: { definition: '2021 Census Median Weekly Total Personal Income', unit: 'aud_weekly' },
  Median_rent_weekly: { definition: '2021 Census Median Weekly Rent', unit: 'aud_weekly' },
  Median_tot_fam_inc_weekly: { definition: '2021 Census Median Weekly Total Family Income', unit: 'aud_weekly' },
  Average_num_psns_per_bed: { definition: '2021 Census Average Number of Persons per Bedroom', unit: 'persons_per_bedroom' },
  Median_tot_hhd_inc_weekly: { definition: '2021 Census Median Weekly Total Household Income', unit: 'aud_weekly' },
  Average_household_size: { definition: '2021 Census Average Household Size', unit: 'persons_per_household' },
};

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function detectGeographicScheme(headerName: string, sampleCode?: string): CensusGeographicScheme {
  const upper = headerName.toUpperCase();
  if (upper.includes('SA1')) return 'ASGS_SA1';
  if (upper.includes('SA2')) return 'ASGS_SA2';
  if (upper.includes('LGA')) return 'ASGS_LGA';

  if (sampleCode) {
    const clean = sampleCode.replace(/^[A-Za-z]+/, '');
    if (clean.length === 5) return 'ASGS_LGA';
    if (clean.length === 9) return 'ASGS_SA2';
    if (clean.length === 7 || clean.length === 11) return 'ASGS_SA1';
  }
  return 'ASGS_SA2';
}

export function normalizeAreaCode(code: string): string {
  return code.trim().replace(/^LGA/i, '');
}

export function boundaryIdFor(scheme: CensusGeographicScheme, code: string, vintage: string): string {
  return `${scheme}:${normalizeAreaCode(code)}:${vintage}`;
}

export type ParsedCensusValue =
  | { readonly status: 'observed'; readonly value: number; readonly raw: string | number }
  | { readonly status: 'suppressed' | 'missing'; readonly value: null; readonly raw: string | number | null };

/**
 * Confidentiality-suppressed values ('..', '-', 'np', 'suppressed', '*') and missing values maintain
 * status = 'suppressed' | 'missing' and null values; they must NEVER be zero-filled.
 */
export function parseCensusValue(raw: unknown): ParsedCensusValue {
  if (raw === null || raw === undefined) {
    return { status: 'missing', value: null, raw: null };
  }
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) return { status: 'missing', value: null, raw };
    return { status: 'observed', value: raw, raw };
  }
  const str = String(raw).trim();
  if (str === '' || str.toLowerCase() === 'null') {
    return { status: 'missing', value: null, raw: str };
  }
  const lower = str.toLowerCase();
  if (str === '..' || str === '-' || lower === 'suppressed' || lower === 'np' || str === '*') {
    return { status: 'suppressed', value: null, raw: str };
  }
  const num = Number(str);
  if (!Number.isFinite(num)) {
    return { status: 'missing', value: null, raw: str };
  }
  return { status: 'observed', value: num, raw: num };
}

export function resolveMetricMetadata(metricKey: string, censusYear: number): CensusMetricMetadata {
  const direct = CENSUS_DATA_DICTIONARY[metricKey];
  if (direct) return direct;
  const humanName = metricKey.replace(/_/g, ' ');
  return {
    definition: `${censusYear} Census: ${humanName}`,
    unit: 'count',
  };
}

export function parseCsvRows(csvText: string): Array<Record<string, string>> {
  const lines = csvText.split(/\r?\n/).map(line => line.trim()).filter(line => line.length > 0);
  if (lines.length < 2) return [];
  const headerLine = lines[0]!;
  const headers = headerLine.split(',').map(h => h.trim().replace(/^["']|["']$/g, ''));
  const results: Array<Record<string, string>> = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!;
    const cells = line.split(',').map(c => c.trim().replace(/^["']|["']$/g, ''));
    const row: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      const key = headers[j];
      if (key) {
        row[key] = cells[j] ?? '';
      }
    }
    results.push(row);
  }
  return results;
}

export interface CensusTableInput {
  table_id: string;
  name?: string;
  scheme?: CensusGeographicScheme;
  headers: readonly string[];
  rows: readonly (readonly unknown[])[];
}

export interface CensusPayload {
  census_year?: number;
  asgs_vintage?: string;
  landing_url?: string;
  published_at?: string;
  observed_at?: string;
  tables?: readonly CensusTableInput[];
  csv_files?: Record<string, string>;
  source_revision?: string;
  official_csv_files?: number;
}

const OFFICIAL_METRICS = {
  G01: ['Tot_P_P', 'Age_0_4_yr_P', 'Age_25_34_yr_P', 'Age_65_74_yr_P', 'Age_85ov_P'],
  G02: ['Median_age_persons', 'Median_tot_prsnl_inc_weekly', 'Median_rent_weekly',
    'Average_household_size'],
} as const;

function selectedOfficialTable(geography: AbsGeography, tableId: 'G01' | 'G02',
  csvText: string): CensusTableInput {
  const lines = csvText.trimEnd().split(/\r?\n/);
  const allHeaders = lines.shift()?.replace(/^\uFEFF/, '').split(',') ?? [];
  const expectedCode = `${geography}_CODE_2021`;
  if (allHeaders[0] !== expectedCode || lines.length === 0) {
    throw new Error(`Invalid ABS DataPack ${geography}/${tableId} header or rows`);
  }
  const selected = [expectedCode, ...OFFICIAL_METRICS[tableId]];
  const indexes = selected.map(metric => allHeaders.indexOf(metric));
  if (indexes.some(index => index < 0)) {
    throw new Error(`Missing ABS DataPack ${geography}/${tableId} selected metric`);
  }
  const rows = lines.map(line => {
    const cells = line.split(',');
    if (cells.length !== allHeaders.length) {
      throw new Error(`Changed ABS DataPack ${geography}/${tableId} CSV columns`);
    }
    return indexes.map(index => cells[index]?.trim() ?? '');
  });
  const scheme: CensusGeographicScheme = geography === 'LGA' ? 'ASGS_LGA'
    : geography === 'SA1' ? 'ASGS_SA1' : 'ASGS_SA2';
  return { table_id: tableId, scheme, headers: selected, rows };
}

export interface NormalizedCensusResult {
  readonly sourceRecords: readonly SourceRecord[];
  readonly areaIndicators: readonly AreaIndicator[];
}

export function normalizeCensusPayload(
  payload: CensusPayload,
  runId: string,
  fetchedAt: UtcTimestamp,
): NormalizedCensusResult {
  const censusYear = payload.census_year ?? DEFAULT_CENSUS_YEAR;
  const asgsVintage = payload.asgs_vintage ?? DEFAULT_ASGS_VINTAGE;
  const publishedAt = payload.published_at ?? DEFAULT_PUBLISHED_AT;
  const periodStart = payload.observed_at ?? DEFAULT_PERIOD_START;
  const periodEnd = new Date(Date.parse(periodStart) + 86_400_000).toISOString();

  const sourceRecords: SourceRecord[] = [];
  const areaIndicators: AreaIndicator[] = [];

  const tablesToProcess: CensusTableInput[] = [];

  if (payload.tables) {
    tablesToProcess.push(...payload.tables);
  }

  if (payload.csv_files) {
    for (const [filename, content] of Object.entries(payload.csv_files)) {
      const parsedRows = parseCsvRows(content);
      if (parsedRows.length === 0) continue;
      const headers = Object.keys(parsedRows[0] ?? {});
      const rows = parsedRows.map(r => headers.map(h => r[h] ?? ''));
      let tableId = 'G01';
      const match = /G\d{2}/i.exec(filename);
      if (match) tableId = match[0].toUpperCase();
      tablesToProcess.push({
        table_id: tableId,
        headers,
        rows,
      });
    }
  }

  for (const table of tablesToProcess) {
    if (!table.headers || table.headers.length < 2) continue;
    const regionColHeader = table.headers[0]!;
    const metricHeaders = table.headers.slice(1);

    for (const row of table.rows) {
      if (!row || row.length < 2) continue;
      const rawCode = String(row[0] ?? '').trim();
      if (!rawCode) continue;

      const scheme = table.scheme ?? detectGeographicScheme(regionColHeader, rawCode);
      const cleanCode = normalizeAreaCode(rawCode);
      const boundaryId = boundaryIdFor(scheme, cleanCode, asgsVintage);

      const metricsForRecord: Record<string, unknown> = {};

      for (let i = 0; i < metricHeaders.length; i++) {
        const metricKey = metricHeaders[i]!;
        const rawValue = row[i + 1];
        const parsed = parseCensusValue(rawValue);
        metricsForRecord[metricKey] = parsed.value;

        const meta = resolveMetricMetadata(metricKey, censusYear);
        const indicatorId = digest(`${SOURCE_ID}:${censusYear}:${table.table_id}:${metricKey}:${scheme}:${cleanCode}`);
        const versionId = digest(`${indicatorId}\0${boundaryId}\0${parsed.status}\0${parsed.value}\0${periodStart}\0${periodEnd}`);
        const sourceRecId = sourceRecordId({
          sourceId: SOURCE_ID,
          nativeId: `${censusYear}:${table.table_id}:${scheme}:${cleanCode}`,
          originalUrl: LANDING_URL,
          sourceTime: periodStart,
        });

        const baseIndicator = {
          batch_id: runId,
          source_id: SOURCE_ID,
          schema_version: 1,
          fetched_at: fetchedAt,
          indicator_id: indicatorId,
          version_id: versionId,
          boundary_id: boundaryId,
          period_start: periodStart,
          period_end: periodEnd,
          unit: meta.unit,
          assertion_kind: 'observation' as const,
          source_record_id: sourceRecId,
          definition: meta.definition,
          source_area_name: null,
          source_area_code: cleanCode,
          source_area_vintage: asgsVintage,
          source_updated_at: publishedAt,
          source_version_ordinal: 1,
        };

        const indicator: AreaIndicator = parsed.status === 'observed'
          ? { ...baseIndicator, status: 'observed', value: parsed.value }
          : { ...baseIndicator, status: parsed.status, value: null };

        areaIndicators.push(indicator);
      }

      const recNativeId = `${censusYear}:${table.table_id}:${scheme}:${cleanCode}`;
      const recId = sourceRecordId({
        sourceId: SOURCE_ID,
        nativeId: recNativeId,
        originalUrl: LANDING_URL,
        sourceTime: periodStart,
      });

      const recVersionId = sourceVersionId(publishedAt, {
        censusYear,
        tableId: table.table_id,
        scheme,
        code: cleanCode,
        metrics: metricsForRecord,
      });

      sourceRecords.push({
        batch_id: runId,
        source_id: SOURCE_ID,
        schema_version: 1,
        fetched_at: fetchedAt,
        source_record_id: recId,
        version_id: recVersionId,
        original_url: LANDING_URL,
        raw_uri: null,
        published_at: publishedAt,
        observed_at: periodStart,
        first_accessible_at: publishedAt,
        time_missing_reason: null,
        valid_from: periodStart,
        valid_to: periodEnd,
        source_updated_at: publishedAt,
        source_version_ordinal: 1,
        record_status: 'active',
        assertion_kind: 'observation',
        rights_status: 'verified_open',
      });
    }
  }

  return { sourceRecords, areaIndicators };
}

export interface AbsCensusConnectorOptions {
  readonly http?: HttpClient;
  readonly dataUrl?: string | null;
  readonly fixturePath?: string | null;
  readonly rawData?: CensusPayload | null;
  readonly officialArchives?: boolean;
}

export class AbsCensusConnector implements Connector {
  readonly sourceId = SOURCE_ID;
  private readonly http: HttpClient;
  private readonly dataUrl: string | null;
  private readonly fixturePath: string | null;
  private readonly rawData: CensusPayload | null;
  private readonly officialArchives: boolean;

  constructor(options: AbsCensusConnectorOptions = {}) {
    this.http = options.http ?? new HttpClient();
    this.dataUrl = options.dataUrl ?? null;
    this.fixturePath = options.fixturePath ?? null;
    this.rawData = options.rawData ?? null;
    this.officialArchives = options.officialArchives ?? true;
  }

  private async loadPayload(): Promise<CensusPayload> {
    if (this.rawData) {
      return this.rawData;
    }

    if (this.dataUrl) {
      const resp = await this.http.getJson({ url: this.dataUrl, timeoutMs: 30_000 });
      return resp.body as CensusPayload;
    }

    if (this.fixturePath) {
      const text = await readFile(this.fixturePath, 'utf8');
      return JSON.parse(text) as CensusPayload;
    }
    if (!this.officialArchives) throw new Error('ABS Census DataPacks resource is not configured');
    const tables: CensusTableInput[] = [];
    const revision = createHash('sha256');
    for (const geography of ['SA1', 'SA2', 'LGA'] as const) {
      const archive = await fetchAbsArchiveTables(geography, this.http);
      for (const tableId of ['G01', 'G02'] as const) {
        const csv = archive.files.get(tableId);
        if (!csv) throw new Error(`Missing ABS DataPack ${geography}/${tableId}`);
        revision.update(`${geography}/${tableId}\0`).update(csv);
        tables.push(selectedOfficialTable(geography, tableId, csv));
      }
    }
    return { census_year: DEFAULT_CENSUS_YEAR, asgs_vintage: DEFAULT_ASGS_VINTAGE,
      published_at: DEFAULT_PUBLISHED_AT, observed_at: DEFAULT_PERIOD_START,
      landing_url: LANDING_URL, tables, source_revision: revision.digest('hex'),
      official_csv_files: 6 };
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

    if (input.window.kind === 'snapshot' && !['2021', 'latest'].includes(input.window.revision)) {
      return {
        kind: 'failure',
        sourceId: SOURCE_ID,
        runId: input.runId,
        checkedAt,
        code: 'validation_failed',
        message: `This connector currently supports 2021 Census DataPacks (requested: ${input.window.revision})`,
        retryAfterSeconds: null,
        sourceLatestUpdateAt: null,
        completeness: {
          complete: false,
          expected_records: null,
          fetched_records: 0,
          expected_pages: 1,
          fetched_pages: 0,
          evidence: 'Unsupported Census snapshot vintage',
        },
      };
    }

    let payload: CensusPayload;
    try {
      payload = await this.loadPayload();
    } catch (error) {
      const code = error instanceof HttpFailure ? error.code
        : error instanceof Error && (error.message.startsWith('Invalid ABS DataPack')
          || error.message.startsWith('Missing ABS DataPack')
          || error.message.startsWith('Changed ABS DataPack')) ? 'schema_changed'
          : 'upstream_unavailable';
      return {
        kind: 'failure',
        sourceId: SOURCE_ID,
        runId: input.runId,
        checkedAt,
        code,
        message: error instanceof Error ? error.message : 'Failed to load ABS Census DataPacks payload',
        retryAfterSeconds: null,
        sourceLatestUpdateAt: null,
        completeness: {
          complete: false,
          expected_records: null,
          fetched_records: 0,
          expected_pages: 1,
          fetched_pages: 0,
          evidence: 'ABS Census DataPacks upstream or fixture unavailable',
        },
      };
    }

    try {
      const { sourceRecords, areaIndicators } = normalizeCensusPayload(payload, input.runId, checkedAt);

      if (sourceRecords.length === 0 || areaIndicators.length === 0) {
        return {
          kind: 'failure',
          sourceId: SOURCE_ID,
          runId: input.runId,
          checkedAt,
          code: 'schema_changed',
          message: 'ABS Census DataPacks payload produced 0 records or indicators',
          retryAfterSeconds: null,
          sourceLatestUpdateAt: null,
          completeness: {
            complete: false,
            expected_records: null,
            fetched_records: 0,
            expected_pages: 1,
            fetched_pages: 0,
            evidence: 'Census table headers or rows missing expected structure',
          },
        };
      }

      const censusYear = payload.census_year ?? DEFAULT_CENSUS_YEAR;
      const asgsVintage = payload.asgs_vintage ?? DEFAULT_ASGS_VINTAGE;
      const publishedAt = payload.published_at ?? DEFAULT_PUBLISHED_AT;
      const sourceRevision = payload.source_revision ?? `${censusYear}_v${asgsVintage}`;

      const success: ConnectorSuccess = {
        kind: 'success',
        sourceId: SOURCE_ID,
        runId: input.runId,
        fetchedAt: checkedAt,
        sourceRevision,
        sourceLatestUpdateAt: publishedAt,
        checkpointAfter: input.window.kind === 'time' ? input.window.to : sourceRevision,
        completeness: {
          complete: true,
          method: 'feed_snapshot',
          expected_records: sourceRecords.length,
          fetched_records: sourceRecords.length,
          expected_pages: payload.official_csv_files ?? 1,
          fetched_pages: payload.official_csv_files ?? 1,
          evidence: `ABS Census ${censusYear} DataPacks verified with ${areaIndicators.length} indicators; missing/suppressed preserved without zero-filling`,
        },
        inputCount: sourceRecords.length,
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
      return {
        kind: 'failure',
        sourceId: SOURCE_ID,
        runId: input.runId,
        checkedAt,
        code: error instanceof z.ZodError ? 'schema_changed' : 'validation_failed',
        message: error instanceof Error ? error.message : 'Validation failed processing Census DataPacks',
        retryAfterSeconds: null,
        sourceLatestUpdateAt: null,
        completeness: {
          complete: false,
          expected_records: null,
          fetched_records: 0,
          expected_pages: 1,
          fetched_pages: 0,
          evidence: 'Census record normalization error',
        },
      };
    }
  }
}

export const connector: Connector = new AbsCensusConnector();
export default connector;
