import { createHash } from 'node:crypto';
import { unzipSync } from 'fflate';
import { XMLParser } from 'fast-xml-parser';
import { z } from 'zod';

import type { Connector, ConnectorFailure, ConnectorInput, ConnectorSuccess } from '../../core/connector.js';
import { HttpClient, HttpFailure } from '../../core/http.js';
import type { SourceRecord } from '../../core/types.js';

export const SOURCE_ID = 'victoria.csa.recorded_offences';
const CATALOG_URL = 'https://discover.data.vic.gov.au/api/3/action/package_show?id=data-tables-recorded-offences';
const MAX_XLSX_BYTES = 40_000_000;
const MAX_XML_BYTES = 5_000_000;
const MAX_TABLE_ROWS = 10_000;

const catalogSchema = z.object({
  success: z.literal(true),
  result: z.object({
    resources: z.array(z.object({
      id: z.string().uuid(),
      name: z.string(),
      format: z.string(),
      url: z.url(),
      period_end: z.string().optional().nullable(),
      release_date: z.string().optional().nullable(),
    }).passthrough()),
  }).passthrough(),
});

export interface CsaResource {
  id: string;
  name: string;
  url: string;
  periodEnd: string;
  releaseDate: string | null;
}

export type CsaValue =
  | { status: 'observed'; count: number }
  | { status: 'suppressed' | 'missing'; count: null; sourceMarker: string | null };

export type CsaOffenceStat = CsaValue & {
  sourceRecordId: string;
  versionId: string;
  lgaName: string;
  /** The official workbook has no numeric LGA code; T058 must join a boundary vintage. */
  lgaCode: null;
  periodStart: string;
  periodEndExclusive: string;
  yearEnding: number;
  monthEnding: 'March' | 'June' | 'September' | 'December';
  ratePer100k: number | null;
  statisticalDefinition: 'rolling_12_month_offence_count';
  releaseDate: string | null;
};

export type CsaSuccess = ConnectorSuccess & {
  /** In-memory rows awaiting T058's authoritative LGA code/boundary join. */
  statistics: readonly CsaOffenceStat[];
};

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  parseTagValue: false,
  trimValues: false,
});

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function asList(value: unknown): unknown[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`CSA XLSX ${label} is missing or invalid`);
  }
  return value as Record<string, unknown>;
}

function string(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`CSA XLSX ${label} is missing or invalid`);
  return value;
}

function xmlEntry(entries: Record<string, Uint8Array>, name: string): Record<string, unknown> {
  const bytes = entries[name];
  if (!bytes) throw new Error(`CSA XLSX ${name} is missing`);
  return object(parser.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)), name);
}

function xlsxEntries(bytes: Uint8Array, names: readonly string[]): Record<string, Uint8Array> {
  if (bytes.byteLength > MAX_XLSX_BYTES) throw new Error('CSA XLSX exceeds compressed size limit');
  const allowed = new Set(names);
  try {
    return unzipSync(bytes, {
      filter: (entry) => allowed.has(entry.name) && entry.originalSize <= MAX_XML_BYTES,
    });
  } catch {
    throw new Error('CSA XLSX ZIP is invalid');
  }
}

export function selectCsaResource(catalog: unknown, requestedRevision = 'latest'): CsaResource {
  const data = catalogSchema.parse(catalog);
  const resources = data.result.resources.flatMap((candidate) => {
    if (!/recorded offences by lga/i.test(candidate.name)) return [];
    if (candidate.format.toLowerCase().replace('.', '') !== 'xlsx') return [];
    if (!candidate.period_end || !/^\d{4}-\d{2}-\d{2}$/.test(candidate.period_end)) return [];
    if (requestedRevision !== 'latest' && candidate.id !== requestedRevision) return [];
    const url = new URL(candidate.url);
    if (url.protocol !== 'https:' || !['files.crimestatistics.vic.gov.au', 'www.crimestatistics.vic.gov.au'].includes(url.hostname)) return [];
    return [{
      id: candidate.id,
      name: candidate.name,
      url: candidate.url,
      periodEnd: candidate.period_end,
      releaseDate: candidate.release_date ?? null,
    }];
  });
  resources.sort((left, right) => right.periodEnd.localeCompare(left.periodEnd)
    || right.id.localeCompare(left.id));
  const latest = resources[0];
  if (!latest) throw new Error('CSA catalog has no valid by-LGA XLSX resource for the requested revision');
  return latest;
}

function sharedString(value: unknown): string {
  const entry = object(value, 'shared string');
  if (typeof entry.t === 'string') return entry.t;
  if (entry.t !== undefined) {
    const text = object(entry.t, 'shared string text')['#text'];
    return string(text, 'shared string text');
  }
  const runs = asList(entry.r);
  if (runs.length > 0) return runs.map((run) => sharedString(run)).join('');
  throw new Error('CSA XLSX has unsupported shared string');
}

function monthEnding(value: string): CsaOffenceStat['monthEnding'] {
  const month = value.trim().toLowerCase();
  if (month === 'march' || month === 'mar') return 'March';
  if (month === 'june' || month === 'jun') return 'June';
  if (month === 'september' || month === 'sep') return 'September';
  if (month === 'december' || month === 'dec') return 'December';
  throw new Error('CSA XLSX contains an unsupported year-ending month');
}

function monthNumber(month: CsaOffenceStat['monthEnding']): number {
  switch (month) {
    case 'March': return 3;
    case 'June': return 6;
    case 'September': return 9;
    case 'December': return 12;
  }
}

function numericValue(raw: string | null): CsaValue {
  if (raw === null || raw.trim() === '') return { status: 'missing', count: null, sourceMarker: raw };
  const value = Number(raw.trim());
  if (Number.isSafeInteger(value) && value >= 0) return { status: 'observed', count: value };
  if (/^(\*|s|suppressed|np|n\.p\.)$/i.test(raw.trim())) {
    return { status: 'suppressed', count: null, sourceMarker: raw };
  }
  throw new Error('CSA XLSX offence count has an unknown nonnumeric marker');
}

function parseRate(raw: string | null): number | null {
  if (raw === null || raw.trim() === '' || /^(\*|s|suppressed|np|n\.p\.)$/i.test(raw.trim())) return null;
  const value = Number(raw.trim());
  if (!Number.isFinite(value) || value < 0) throw new Error('CSA XLSX rate is invalid');
  return value;
}

export function parseCsaWorkbook(bytes: Uint8Array, resource: CsaResource): CsaOffenceStat[] {
  const initial = xlsxEntries(bytes, ['xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/sharedStrings.xml']);
  const workbook = object(xmlEntry(initial, 'xl/workbook.xml').workbook, 'workbook');
  const sheets = object(workbook.sheets, 'sheets');
  const table = asList(sheets.sheet).map((item) => object(item, 'sheet'))
    .find((item) => item['@_name'] === 'Table 01');
  if (!table) throw new Error('CSA XLSX Table 01 is absent');
  const relationshipId = string(table['@_id'], 'Table 01 relation ID');
  const relationships = object(xmlEntry(initial, 'xl/_rels/workbook.xml.rels').Relationships, 'relationships');
  const relation = asList(relationships.Relationship).map((item) => object(item, 'relationship'))
    .find((item) => item['@_Id'] === relationshipId);
  if (!relation) throw new Error('CSA XLSX Table 01 relationship is absent');
  const target = string(relation['@_Target'], 'Table 01 target');
  if (!/^worksheets\/sheet\d+\.xml$/.test(target)) throw new Error('CSA XLSX Table 01 target is invalid');
  const sheetPath = `xl/${target}`;
  const sheetEntries = xlsxEntries(bytes, [sheetPath]);
  const worksheet = object(xmlEntry(sheetEntries, sheetPath).worksheet, 'worksheet');
  const sheetData = object(worksheet.sheetData, 'sheetData');
  const rows = asList(sheetData.row).map((item) => object(item, 'row'));
  if (rows.length < 2 || rows.length > MAX_TABLE_ROWS) throw new Error('CSA XLSX Table 01 row count is outside bounds');

  const stringsXml = object(xmlEntry(initial, 'xl/sharedStrings.xml').sst, 'shared strings');
  const strings = asList(stringsXml.si).map(sharedString);
  const cells = (row: Record<string, unknown>): Record<string, string | null> => {
    const result: Record<string, string | null> = {};
    for (const item of asList(row.c)) {
      const cell = object(item, 'cell');
      const address = string(cell['@_r'], 'cell address');
      const column = /^[A-Z]+/.exec(address)?.[0];
      if (!column) throw new Error('CSA XLSX cell address is invalid');
      const raw = cell.v;
      if (raw === undefined || raw === null || raw === '') {
        result[column] = null;
      } else if (cell['@_t'] === 's') {
        const index = Number(raw);
        const text = strings[index];
        if (!Number.isSafeInteger(index) || text === undefined) throw new Error('CSA XLSX shared string index is invalid');
        result[column] = text;
      } else {
        result[column] = string(raw, 'cell value');
      }
    }
    return result;
  };

  const headers = cells(rows[0] ?? {});
  const expectedHeaders = {
    A: 'Year', B: 'Year ending', C: 'Police Region', D: 'Local Government Area',
    E: 'Offence Count', F: 'Rate per 100,000 population',
  };
  for (const [column, name] of Object.entries(expectedHeaders)) {
    if (headers[column]?.trim() !== name) throw new Error(`CSA XLSX Table 01 header ${column} changed`);
  }

  const statistics: CsaOffenceStat[] = [];
  const seen = new Set<string>();
  for (const row of rows.slice(1)) {
    const values = cells(row);
    if (Object.values(values).every((value) => value === null)) continue;
    const year = Number(values.A);
    if (!Number.isSafeInteger(year) || year < 2000 || year > 2100) throw new Error('CSA XLSX year is invalid');
    const month = monthEnding(values.B ?? '');
    const lgaName = (values.D ?? '').trim();
    if (!lgaName) throw new Error('CSA XLSX LGA name is missing');
    // Table 01 also contains several Police Region subtotal rows named Total.
    if (lgaName === 'Total') continue;
    const monthNo = monthNumber(month);
    const periodStart = new Date(Date.UTC(year - 1, monthNo, 1)).toISOString();
    const periodEndExclusive = new Date(Date.UTC(year, monthNo, 1)).toISOString();
    const nativeId = `${year}-${String(monthNo).padStart(2, '0')}:${lgaName.toLowerCase()}`;
    if (seen.has(nativeId)) throw new Error('CSA XLSX Table 01 has a duplicate LGA/period row');
    seen.add(nativeId);
    const sourceRecordId = digest(`${SOURCE_ID}\0${nativeId}`);
    const measurement = numericValue(values.E ?? null);
    const ratePer100k = parseRate(values.F ?? null);
    const versionId = digest(`${resource.id}\0${nativeId}\0${values.E ?? ''}\0${values.F ?? ''}`);
    statistics.push({
      ...measurement, sourceRecordId, versionId, lgaName, lgaCode: null,
      periodStart, periodEndExclusive, yearEnding: year, monthEnding: month,
      ratePer100k, statisticalDefinition: 'rolling_12_month_offence_count',
      releaseDate: resource.releaseDate,
    });
  }
  if (statistics.length === 0) throw new Error('CSA XLSX Table 01 has no statistics');
  return statistics;
}

function failure(input: ConnectorInput, code: ConnectorFailure['code'], message: string, checkedAt: string): ConnectorFailure {
  return {
    kind: 'failure', sourceId: SOURCE_ID, runId: input.runId, checkedAt,
    code, message, retryAfterSeconds: null, sourceLatestUpdateAt: null,
    completeness: {
      complete: false, expected_records: null, fetched_records: 0,
      expected_pages: 1, fetched_pages: 0, evidence: message,
    },
  };
}

export class CsaRecordedOffencesConnector implements Connector {
  readonly sourceId = SOURCE_ID;

  constructor(private readonly http = new HttpClient(), private readonly catalogUrl = CATALOG_URL) {}

  async collect(input: ConnectorInput): Promise<CsaSuccess | ConnectorFailure> {
    const checkedAt = new Date().toISOString();
    if (input.sourceId !== SOURCE_ID || input.window.kind !== 'snapshot') {
      return failure(input, 'validation_failed', 'CSA requires its canonical source ID and a snapshot revision', checkedAt);
    }
    let resource: CsaResource;
    let bytes: Uint8Array;
    try {
      const catalog = await this.http.getJson({ url: this.catalogUrl, timeoutMs: 30_000 });
      resource = selectCsaResource(catalog.body, input.window.revision);
      const workbook = await this.http.getBytes({ url: resource.url, timeoutMs: 120_000 });
      bytes = workbook.body;
    } catch (error) {
      const code = error instanceof HttpFailure ? error.code : 'schema_changed';
      return failure(input, code, 'CSA catalog or selected LGA workbook could not be fetched', checkedAt);
    }
    let statistics: CsaOffenceStat[];
    try {
      statistics = parseCsaWorkbook(bytes, resource);
    } catch {
      return failure(input, 'schema_changed', 'CSA LGA workbook format or values changed', checkedAt);
    }
    const sourceRecords: SourceRecord[] = statistics.map((stat) => ({
      batch_id: input.runId, source_id: SOURCE_ID, schema_version: 1,
      fetched_at: checkedAt, source_record_id: stat.sourceRecordId,
      version_id: stat.versionId, original_url: resource.url, raw_uri: null,
      published_at: null, observed_at: null, first_accessible_at: null,
      time_missing_reason: 'CSA provides a release date and rolling-year period, not an exact publication or incident timestamp',
      valid_from: stat.periodStart, valid_to: stat.periodEndExclusive,
      // The selected resource period orders successive quarterly releases;
      // it is not an exact article or incident publication timestamp.
      source_updated_at: new Date(`${resource.periodEnd}T00:00:00Z`).toISOString(),
      source_version_ordinal: null,
      record_status: 'active', assertion_kind: 'observation', rights_status: 'review_required',
    }));
    return {
      kind: 'success', sourceId: SOURCE_ID, runId: input.runId, fetchedAt: checkedAt,
      sourceRevision: resource.id, sourceLatestUpdateAt: null,
      checkpointAfter: resource.id,
      completeness: {
        complete: true, method: 'export_count', expected_records: statistics.length,
        fetched_records: statistics.length, expected_pages: 1, fetched_pages: 1,
        evidence: 'Official DataVic by-LGA XLSX Table 01 and all populated rows parsed',
      },
      inputCount: statistics.length, outputCount: statistics.length, rejectedCount: 0,
      sourceRecords, geoRecords: [], geoRecordSources: [], boundaries: [],
      areaIndicators: [], parkingBays: [], parkingObservations: [], parkingRules: [],
      sensorLocations: [], pedestrianObservations: [], retainableRawRecords: null,
      statistics,
    };
  }
}

export const connector = new CsaRecordedOffencesConnector();
