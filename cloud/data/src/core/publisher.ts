import { createHash } from 'node:crypto';

import { BigQuery } from '@google-cloud/bigquery';
import { z } from 'zod';

import type { ConnectorFailure, ConnectorSuccess } from './connector.js';
import type { DataConfig } from './config.js';
import { GcsStore } from './gcs.js';
import { SNAPSHOT_GEO_SOURCES } from './geo-records-current.js';
import { loadNdjson } from './bigquery-load.js';
import { writeHighFrequencyRows } from './bigquery-write.js';
import type { DataSource, GeoRecord, SourceRecord, SyncBatch } from './types.js';
import { validateGeoRecordGeography } from '../validation/geography.js';
import { parseSourceRecord } from '../validation/record.js';

type FactTable =
  | 'source_records' | 'geo_records' | 'geo_record_sources' | 'boundaries'
  | 'area_indicators' | 'parking_bays' | 'parking_observations'
  | 'parking_rules' | 'parking_sensor_memberships' | 'sensor_locations' | 'pedestrian_observations';

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function after(timestamp: string): string {
  return new Date(Math.max(Date.now(), Date.parse(timestamp) + 1)).toISOString();
}

export function stableBatchId(sourceId: string, windowFrom: string | null, windowTo: string | null,
  sourceRevision: string | null): string {
  return `batch_${digest(JSON.stringify([sourceId, windowFrom === null ? null : new Date(utc.parse(windowFrom)).toISOString(),
    windowTo === null ? null : new Date(utc.parse(windowTo)).toISOString(), sourceRevision])).slice(0, 40)}`;
}

const TABLE_KEYS: Record<FactTable, readonly string[]> = {
  source_records: ['source_record_id', 'version_id'],
  geo_records: ['geo_record_id', 'version_id'],
  geo_record_sources: ['geo_record_id', 'version_id', 'source_record_id', 'source_version_id'],
  boundaries: ['boundary_id', 'version_id'],
  area_indicators: ['indicator_id', 'version_id'],
  parking_bays: ['bay_id', 'version_id'],
  parking_observations: ['sensor_id', 'observed_at', 'version_id'],
  parking_rules: ['rule_id', 'version_id'],
  parking_sensor_memberships: ['sensor_id', 'version_id'],
  sensor_locations: ['sensor_id', 'version_id'],
  pedestrian_observations: ['sensor_id', 'observed_at', 'version_id'],
};
/** Connector facts written and validated by this publisher; derived writers own other tables. */
export const PUBLISHER_FACT_TABLES: readonly string[] = Object.freeze(Object.keys(TABLE_KEYS));
const utc = z.iso.datetime({ offset: false });
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const auditFields = new Set(['batch_id', 'fetched_at', 'raw_uri', 'first_accessible_at', 'freshness_state']);
/** Each batch is the whole current state; version checks apply within the batch only. */
const COMPLETE_SNAPSHOT_SOURCES: ReadonlySet<string> = new Set([
  'ticketmaster.events', 'victoria.council.engagement',
  // Every road read is all pages of the provider's current set, and every GTFS-R read is both
  // FULL_DATASET feeds. Unplanned roads often have no verified update time, so a record whose
  // content changed would look ambiguous against its history, and that history grows every run.
  'victoria.transport.road_planned', 'victoria.transport.road_unplanned', 'victoria.transport.gtfs_realtime',
]);

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function contentOf(row: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(row).filter(([key]) => !auditFields.has(key)));
}

function rowKey(table: FactTable, row: Record<string, unknown>): string {
  return JSON.stringify(TABLE_KEYS[table].map(key => z.string().trim().min(1).parse(row[key])));
}

function sourceLease(source: DataSource): string {
  return `source_${digest(source.source_id)}`;
}

function validationChunks(table: PlannedTable): readonly (readonly Record<string, unknown>[])[] {
  const logicalId = TABLE_KEYS[table.name].find(key => key !== 'version_id');
  if (logicalId === undefined) throw new Error(`Missing logical key in ${table.name}`);
  const unique = new Map(table.rows.map(row => [rowKey(table.name, row), row]));
  const chunks: Record<string, unknown>[][] = [[]];
  let chunk = chunks[0];
  let bytes = 0;
  for (const row of unique.values()) {
    // Both string parameters repeat the logical ID. Include their outer JSON
    // escaping together, leaving room below BigQuery's request-size limit.
    const size = Buffer.byteLength(JSON.stringify(JSON.stringify(row)))
      + Buffer.byteLength(JSON.stringify(JSON.stringify(row[logicalId])));
    if (size > 7_000_000) throw new Error(`Validation row exceeds request budget in ${table.name}`);
    if (!chunk || (chunk.length > 0 && bytes + size > 7_000_000)) {
      chunk = [];
      chunks.push(chunk);
      bytes = 0;
    }
    chunk.push(row);
    bytes += size;
  }
  return chunks;
}

const batchSchema: z.ZodType<SyncBatch> = z.object({
  batch_id: z.string(), source_id: z.string(), schema_version: count,
  window_from: utc.nullable(), window_to: utc.nullable(), source_revision: z.string().nullable(),
  started_at: utc, finished_at: utc.nullable(), state: z.enum(['running', 'validated', 'published', 'failed']),
  state_updated_at: utc, raw_uri: z.string().nullable(), staging_uris: z.array(z.string()),
  published_at: utc.nullable(), input_count: count, output_count: count, rejected_count: count,
  checkpoint_before: z.string().nullable(), checkpoint_after: z.string().nullable(),
  error_code: z.enum(['rate_limited', 'upstream_unavailable', 'schema_changed', 'auth_failed',
    'incomplete_window', 'validation_failed']).nullable(),
});

interface PlannedTable {
  name: FactTable;
  rows: readonly Record<string, unknown>[];
  expectedDistinct: number;
}

/**
 * Sources whose batch facts reference only rows of the same batch, so validation can read the batch's
 * fetch range instead of the source's history. Transport snapshots carry every row each read. A parking
 * run writes only changed sensors' facts, all in the batch; its memberships also point at older business
 * batches, but the run's published-state recovery (parking-runtime.ts) proves those exact references
 * just before publishing, so only references to this batch are checked here.
 */
const PARKING_SENSOR_SOURCE = 'melbourne.parking.sensors';
const WINDOWED_HISTORY_SOURCES: ReadonlySet<string> = new Set([...SNAPSHOT_GEO_SOURCES, PARKING_SENSOR_SOURCE]);

/** A published batch's rows were fetched from at most a day before it started until its last state. */
function batchSpan(batch: SyncBatch): { from: string; to: string } | null {
  const started = Date.parse(batch.started_at);
  const ended = Date.parse(batch.state_updated_at);
  if (!Number.isFinite(started) || !Number.isFinite(ended)) return null;
  return { from: new Date(started - 24 * 3_600_000).toISOString(), to: new Date(ended + 60_000).toISOString() };
}

/** The earliest and latest fetch time across a batch's rows; null for a batch without rows. */
function fetchedRange(tables: readonly PlannedTable[]): { from: string; to: string } | null {
  let from = Infinity;
  let to = -Infinity;
  for (const table of tables) for (const row of table.rows) {
    const time = typeof row.fetched_at === 'string' ? Date.parse(row.fetched_at) : NaN;
    if (!Number.isFinite(time)) throw new Error(`Planned ${table.name} row has no fetch time`);
    from = Math.min(from, time);
    to = Math.max(to, time);
  }
  return Number.isFinite(from) ? { from: new Date(from).toISOString(), to: new Date(to).toISOString() } : null;
}

function planRows(result: ConnectorSuccess, source: DataSource, batchId: string): {
  tables: readonly PlannedTable[];
  rejectedGeography: number;
} {
  if (result.sourceId !== source.source_id) {
    throw new Error('Connector source does not match publication source');
  }
  utc.parse(result.fetchedAt);
  if (result.sourceLatestUpdateAt !== null) utc.parse(result.sourceLatestUpdateAt);
  const completeness = z.object({
    complete: z.literal(true), method: z.enum(['pagination', 'export_count', 'feed_snapshot', 'not_applicable']),
    expected_records: count.nullable(), fetched_records: count,
    expected_pages: count.nullable(), fetched_pages: count, evidence: z.string().trim().min(1),
  }).parse(result.completeness);
  for (const value of [result.inputCount, result.outputCount, result.rejectedCount]) count.parse(value);
  if (completeness.fetched_records !== result.inputCount
    || (completeness.expected_records !== null && completeness.expected_records !== completeness.fetched_records)
    || (completeness.expected_pages !== null && completeness.expected_pages !== completeness.fetched_pages)) {
    throw new Error('Connector window is incomplete');
  }
  const sourceRecords: SourceRecord[] = result.sourceRecords.map(row =>
    parseSourceRecord({ ...row, batch_id: batchId }));
  const acceptedGeo: GeoRecord[] = [];
  for (const row of result.geoRecords) {
    const geography = validateGeoRecordGeography(row);
    if (geography.geographicRecord) acceptedGeo.push({ ...geography.geographicRecord, batch_id: batchId });
  }
  const acceptedGeoIds = new Set(acceptedGeo.map(row => JSON.stringify([row.geo_record_id, row.version_id])));
  const rejectedGeoIds = new Set(result.geoRecords
    .filter(row => !acceptedGeoIds.has(JSON.stringify([row.geo_record_id, row.version_id])))
    .map(row => JSON.stringify([row.geo_record_id, row.version_id])));
  const rawTables: readonly [FactTable, readonly object[]][] = [
    ['source_records', sourceRecords],
    ['geo_records', acceptedGeo],
    ['geo_record_sources', result.geoRecordSources.filter(row => !rejectedGeoIds.has(JSON.stringify([row.geo_record_id, row.version_id])))],
    ['boundaries', result.boundaries],
    ['area_indicators', result.areaIndicators],
    ['parking_bays', result.parkingBays],
    ['parking_observations', result.parkingObservations],
    ['parking_rules', result.parkingRules],
    ['parking_sensor_memberships', result.parkingSensorMemberships ?? []],
    ['sensor_locations', result.sensorLocations],
    ['pedestrian_observations', result.pedestrianObservations],
  ];
  const tables = rawTables.map(([name, records]) => {
    const rows: Record<string, unknown>[] = records.map(row => ({ ...row, batch_id: batchId,
      ...(name === 'parking_sensor_memberships' && 'business_batch_id' in row
        && row.business_batch_id === result.runId ? { business_batch_id: batchId } : {}),
    }));
    const seen = new Map<string, string>();
    for (const row of rows) {
      if (row.batch_id !== batchId || row.source_id !== source.source_id
        || row.schema_version !== 1 || !utc.safeParse(row.fetched_at).success) {
        throw new Error(`Invalid provenance in ${name}`);
      }
      if (name === 'parking_sensor_memberships' && source.source_id !== 'melbourne.parking.sensors') {
        throw new Error('Parking snapshot membership has the wrong source');
      }
      const key = rowKey(name, row);
      for (const [field, value] of Object.entries(row)) {
        if (value !== null && /(_at|^valid_from$|^valid_to$|^period_start$|^period_end$)/.test(field)) {
          utc.parse(value);
        }
      }
      if (row.rights_status === 'verified_open' && source.license_status !== 'verified_open') {
        throw new Error('Record rights cannot expand source permission');
      }
      if (name === 'geo_records' && source.license_status === 'restricted') {
        for (const field of ['title', 'summary']) {
          if (row[field] !== null && !source.admission_evidence.allowed_fields?.includes(field)) {
            throw new Error(`Restricted field is not approved: ${field}`);
          }
        }
      }
      const content = canonical(contentOf(row));
      const previous = seen.get(key);
      if (previous !== undefined && previous !== content) {
        throw new Error(`Conflicting rows share a version in ${name}`);
      }
      seen.set(key, content);
    }
    return { name, rows, expectedDistinct: seen.size };
  });
  if (acceptedGeo.some(row => row.public_query_allowed && row.rights_status === 'review_required')) {
    throw new Error('Unreviewed record cannot enter public query');
  }
  return { tables, rejectedGeography: result.geoRecords.length - acceptedGeo.length };
}

export class BigQueryPublisher {
  constructor(private readonly config: DataConfig, private readonly bigquery: BigQuery,
    private readonly gcs: GcsStore,
    private readonly writeRows: typeof writeHighFrequencyRows = writeHighFrequencyRows) {}

  private async query(sql: string, params: Record<string, string>): Promise<readonly Record<string, unknown>[]> {
    const [rows] = await this.bigquery.query({ query: sql, params, location: this.config.region,
      ...(this.config.maxBytesBilled ? { maximumBytesBilled: this.config.maxBytesBilled } : {}) });
    return z.array(z.record(z.string(), z.unknown())).parse(rows);
  }

  private async latestBatch(batchId: string, sourceId: string): Promise<SyncBatch | null> {
    const rows = await this.query(`SELECT TO_JSON_STRING(t) AS batch
      FROM \`${this.config.projectId}.${this.config.ingestDataset}.sync_batches\` t
      WHERE source_id = @sourceId AND batch_id = @batchId
      ORDER BY state_updated_at DESC LIMIT 1`, { batchId, sourceId });
    if (!rows.length) return null;
    return batchSchema.parse(JSON.parse(z.string().parse(rows[0]?.batch)));
  }

  private async appendState(batch: SyncBatch): Promise<void> {
    const sql = `INSERT INTO \`${this.config.projectId}.${this.config.ingestDataset}.sync_batches\`
      (batch_id, source_id, schema_version, window_from, window_to, source_revision,
       started_at, finished_at, state, state_updated_at, raw_uri, staging_uris,
       published_at, input_count, output_count, rejected_count, checkpoint_before,
       checkpoint_after, error_code)
      WITH payload AS (SELECT PARSE_JSON(@payload) AS j)
      SELECT JSON_VALUE(j, '$.batch_id'), JSON_VALUE(j, '$.source_id'),
        CAST(JSON_VALUE(j, '$.schema_version') AS INT64),
        SAFE_CAST(JSON_VALUE(j, '$.window_from') AS TIMESTAMP),
        SAFE_CAST(JSON_VALUE(j, '$.window_to') AS TIMESTAMP),
        JSON_VALUE(j, '$.source_revision'),
        CAST(JSON_VALUE(j, '$.started_at') AS TIMESTAMP),
        SAFE_CAST(JSON_VALUE(j, '$.finished_at') AS TIMESTAMP),
        JSON_VALUE(j, '$.state'), CAST(JSON_VALUE(j, '$.state_updated_at') AS TIMESTAMP),
        JSON_VALUE(j, '$.raw_uri'),
        ARRAY(SELECT JSON_VALUE(value) FROM UNNEST(JSON_QUERY_ARRAY(j, '$.staging_uris')) value),
        SAFE_CAST(JSON_VALUE(j, '$.published_at') AS TIMESTAMP),
        CAST(JSON_VALUE(j, '$.input_count') AS INT64),
        CAST(JSON_VALUE(j, '$.output_count') AS INT64),
        CAST(JSON_VALUE(j, '$.rejected_count') AS INT64),
        JSON_VALUE(j, '$.checkpoint_before'), JSON_VALUE(j, '$.checkpoint_after'),
        JSON_VALUE(j, '$.error_code') FROM payload`;
    await this.query(sql, { payload: JSON.stringify(batch) });
  }

  private async latestSourceTimes(sourceId: string): Promise<{
    lastSuccessAt: string | null;
    lastSourceUpdateAt: string | null;
    updatedAt: string | null;
    lastCheckedAt: string | null;
    accessStatus: string | null;
    licenseStatus: string | null;
  }> {
    const rows = await this.query(`SELECT CAST(last_success_at AS STRING) AS last_success_at,
      CAST(last_source_update_at AS STRING) AS last_source_update_at,
      CAST(updated_at AS STRING) AS updated_at,
      CAST(last_checked_at AS STRING) AS last_checked_at, access_status, license_status
      FROM \`${this.config.projectId}.${this.config.ingestDataset}.data_sources\`
      WHERE source_id = @sourceId ORDER BY updated_at DESC LIMIT 1`, { sourceId });
    return {
      lastSuccessAt: typeof rows[0]?.last_success_at === 'string' ? rows[0].last_success_at : null,
      lastSourceUpdateAt: typeof rows[0]?.last_source_update_at === 'string'
        ? rows[0].last_source_update_at : null,
      lastCheckedAt: typeof rows[0]?.last_checked_at === 'string' ? rows[0].last_checked_at : null,
      accessStatus: typeof rows[0]?.access_status === 'string' ? rows[0].access_status : null,
      licenseStatus: typeof rows[0]?.license_status === 'string' ? rows[0].license_status : null,
      updatedAt: typeof rows[0]?.updated_at === 'string' ? rows[0].updated_at : null,
    };
  }

  private async appendSourceCheck(source: DataSource, batchId: string, checkedAt: string,
    successAt: string | null, sourceUpdateAt: string | null): Promise<void> {
    const previous = await this.latestSourceTimes(source.source_id);
    const mostRecent = (a: string | null, b: string | null): string | null =>
      a === null ? b : b === null ? a : Date.parse(a) >= Date.parse(b) ? a : b;
    const row = { ...source,
      last_checked_at: mostRecent(previous.lastCheckedAt, checkedAt),
      ...(previous.accessStatus === 'paused' ? { access_status: 'paused', license_status: 'review_required' } : {}),
      last_success_at: mostRecent(previous.lastSuccessAt, successAt),
      last_source_update_at: mostRecent(previous.lastSourceUpdateAt, sourceUpdateAt),
      updated_at: previous.updatedAt === null ? new Date().toISOString() : after(previous.updatedAt),
    };
    if ((source.cadence_seconds ?? Number.POSITIVE_INFINITY) <= 300) {
      // Two registry load jobs per 120-second snapshot exceed BigQuery's daily
      // per-table load quota when the other sources also publish. Small control
      // rows use INSERT, just like batch state; source/updated_at deduplicate retries.
      const fields: readonly [string, string][] = [
        ...['source_id', 'provider', 'dataset_title', 'landing_url', 'topic', 'scope',
          'record_granularity', 'connector_owner', 'license_status', 'access_status']
          .map(name => [name, `JSON_VALUE(j, '$.${name}')`] as [string, string]),
        ...['legacy_ids', 'coverage_area_refs'].map(name => [name,
          `ARRAY(SELECT JSON_VALUE(v) FROM UNNEST(JSON_QUERY_ARRAY(j, '$.${name}')) v)`] as [string, string]),
        ...['coverage_from', 'coverage_to', 'last_checked_at', 'last_success_at',
          'last_source_update_at', 'updated_at'].map(name => [name,
          `CAST(JSON_VALUE(j, '$.${name}') AS TIMESTAMP)`] as [string, string]),
        ...['cadence_seconds', 'check_interval_seconds'].map(name => [name,
          `CAST(JSON_VALUE(j, '$.${name}') AS INT64)`] as [string, string]),
        ['admission_evidence', "JSON_QUERY(j, '$.admission_evidence')"],
      ];
      await this.query(`INSERT INTO \`${this.config.projectId}.${this.config.ingestDataset}.data_sources\`
        (${fields.map(([name]) => name).join(', ')})
        WITH payload AS (SELECT PARSE_JSON(@payload) AS j)
        SELECT ${fields.map(([, expression]) => expression).join(', ')} FROM payload`,
        { payload: JSON.stringify(row) });
      return;
    }
    const staged = await this.gcs.saveNdjson({ kind: 'staging', sourceId: source.source_id,
      batchId: `${batchId}.source.${successAt === null ? 'checked' : 'success'}`,
      rows: [row], allowedFields: null,
      retentionDays: source.admission_evidence.staging_retention_days ?? 1 });
    await loadNdjson({ bigquery: this.bigquery, dataset: this.config.ingestDataset,
      table: 'data_sources', batchId, uri: staged.uri, location: this.config.region });
    await this.gcs.deleteObject(staged);
  }

  async recordConnectorFailure(source: DataSource, failure: ConnectorFailure,
    windowFrom: string | null, windowTo: string | null): Promise<void> {
    if (failure.sourceId !== source.source_id) throw new Error('Connector source does not match failure source');
    const batchId = stableBatchId(source.source_id, windowFrom, windowTo,
      `failed:${failure.checkedAt}:${failure.runId}`);
    await this.gcs.withBatchLease(sourceLease(source), async () => {
      const now = new Date().toISOString();
      await this.appendState({
        batch_id: batchId, source_id: source.source_id, schema_version: 1,
        window_from: windowFrom, window_to: windowTo, source_revision: null,
        started_at: now, finished_at: now, state: 'failed', state_updated_at: now,
        raw_uri: null, staging_uris: [], published_at: null,
        input_count: failure.completeness.fetched_records, output_count: 0,
        rejected_count: 0, checkpoint_before: null, checkpoint_after: null,
        error_code: failure.code,
      });
      await this.appendSourceCheck(source, batchId, failure.checkedAt, null,
        failure.sourceLatestUpdateAt);
    });
  }

  /**
   * A fresh load's rows carry the plan's fetch times. A replay (`replayOf`) compares the stored rows
   * of that published batch with the plan, within the batch's own time span: from a day before it
   * started, which covers a fetch before the batch row was written, to its last state.
   */
  private async validateLoadedRows(batchId: string, tables: readonly PlannedTable[], source: DataSource,
    replayOf?: SyncBatch): Promise<void> {
    const path = (name: string) => `\`${this.config.projectId}.${this.config.ingestDataset}.${name}\``;
    const range = replayOf === undefined ? fetchedRange(tables) : batchSpan(replayOf);
    // History reads stay unbounded except for sources whose batch facts reference only the batch itself.
    const fetched = replayOf === undefined && range !== null && WINDOWED_HISTORY_SOURCES.has(source.source_id) ? range : null;
    const fetchedParams: Record<string, string> = range === null ? {}
      : { fetchedFrom: range.from, fetchedTo: range.to };
    // The batch's own rows were all fetched within the plan's range, for every source.
    const batchWindow = (alias: string) => range === null ? ''
      : ` AND ${alias}.fetched_at BETWEEN TIMESTAMP(@fetchedFrom) AND TIMESTAMP(@fetchedTo)`;
    for (const table of tables) {
      // Warehouse types keep timestamp/numeric/array comparisons identical on both sides.
      const [metadata] = await this.bigquery.dataset(this.config.ingestDataset).table(table.name).getMetadata();
      const fields = z.array(z.object({
        name: z.string().regex(/^[a-z_][a-z0-9_]*$/),
        type: z.enum(['STRING', 'TIMESTAMP', 'INTEGER', 'INT64', 'FLOAT', 'FLOAT64', 'NUMERIC', 'BOOLEAN', 'BOOL']),
        mode: z.enum(['NULLABLE', 'REQUIRED', 'REPEATED']).optional(),
      })).nonempty().parse(metadata.schema?.fields);
      const names = new Set(fields.map(field => field.name));
      const keys = TABLE_KEYS[table.name];
      if (keys.some(key => !names.has(key))) throw new Error(`Missing warehouse key in ${table.name}`);
      const expectedValue = (name: string): string => {
        const field = fields.find(candidate => candidate.name === name);
        if (!field) throw new Error(`Unknown warehouse field ${name}`);
        // BigQuery table metadata uses legacy aliases that GoogleSQL CAST does
        // not accept (notably FLOAT). Normalize them before building SQL.
        const sqlType = field.type === 'INTEGER' ? 'INT64'
          : field.type === 'FLOAT' ? 'FLOAT64'
            : field.type === 'BOOLEAN' ? 'BOOL' : field.type;
        return field.mode === 'REPEATED'
          ? `ARRAY(SELECT CAST(JSON_VALUE(v) AS ${sqlType}) FROM UNNEST(JSON_QUERY_ARRAY(e, '$.${name}')) v)`
          : `CAST(JSON_VALUE(e, '$.${name}') AS ${sqlType})`;
      };
      const tuple = (columns: readonly string[], expected = false) => `TO_JSON_STRING(STRUCT(${columns
        .map(name => `${expected ? expectedValue(name) : `t.${name}`} AS ${name}`).join(', ')}))`;
      const contentFields = fields.map(field => field.name).filter(name => !auditFields.has(name));
      const logicalKeys = keys.filter(key => key !== 'version_id');
      const snapshotScope = table.name === 'parking_sensor_memberships'
        || COMPLETE_SNAPSHOT_SOURCES.has(source.source_id) ? 'AND t.batch_id = @batchId' : '';
      // A transport snapshot batch holds every row it references, all fetched within its own
      // range, so each read is held to those partitions instead of the source's whole history.
      const fetchedWindow = (alias: string) => fetched === null ? ''
        : ` AND ${alias}.fetched_at BETWEEN TIMESTAMP(@fetchedFrom) AND TIMESTAMP(@fetchedTo)`;
      const invalid = [
        't.source_id IS DISTINCT FROM @sourceId', 't.schema_version IS DISTINCT FROM 1', 't.fetched_at IS NULL',
        ...keys.map(key => `t.${key} IS NULL${key === 'observed_at' ? '' : ` OR TRIM(t.${key}) = ''`}`),
      ];
      if (names.has('valid_from')) invalid.push('t.valid_to < t.valid_from');
      if (names.has('source_version_ordinal')) invalid.push('t.source_version_ordinal < 0');
      if (names.has('assertion_kind')) invalid.push("(t.assertion_kind IN ('observation', 'report', 'prediction', 'plan')) IS NOT TRUE");
      if (names.has('rights_status')) invalid.push("(t.rights_status IN ('verified_open', 'restricted', 'review_required')) IS NOT TRUE",
        "t.rights_status = 'verified_open' AND @licenseStatus != 'verified_open'");
      if (names.has('geometry_geojson')) invalid.push('t.geometry_geojson IS NOT NULL AND SAFE.ST_GEOGFROMGEOJSON(t.geometry_geojson) IS NULL');
      if (table.name === 'geo_records') invalid.push(
        "t.public_query_allowed AND t.rights_status = 'review_required'",
        "@licenseStatus = 'restricted' AND ((t.title IS NOT NULL AND NOT EXISTS (SELECT 1 FROM UNNEST(JSON_VALUE_ARRAY(@allowedFields)) f WHERE f = 'title')) OR (t.summary IS NOT NULL AND NOT EXISTS (SELECT 1 FROM UNNEST(JSON_VALUE_ARRAY(@allowedFields)) f WHERE f = 'summary')))",
        '(t.centroid_lat IS NULL) != (t.centroid_lon IS NULL)',
        't.centroid_lat NOT BETWEEN -90 AND 90 OR t.centroid_lon NOT BETWEEN -180 AND 180',
        't.geometry_geojson IS NULL AND (t.centroid_lat IS NOT NULL OR t.centroid_lon IS NOT NULL)',
        "t.geometry_geojson IS NOT NULL AND (t.location_role = 'unknown' OR t.location_confidence = 'unverified')",
        "JSON_VALUE(t.geometry_geojson, '$.type') = 'Point' AND (t.location_role = 'area_only' OR t.location_confidence NOT IN ('source_coordinate', 'official_join'))",
        "(t.location_role IN ('event_site', 'mentioned_place', 'sensor_site', 'area_only', 'unknown')) IS NOT TRUE",
        "(t.location_confidence IN ('source_coordinate', 'official_join', 'resolved_area', 'unverified')) IS NOT TRUE",
        "t.location_confidence = 'resolved_area' AND t.location_role != 'area_only'",
        "(t.record_status IN ('active', 'planned', 'cancelled', 'resolved', 'withdrawn')) IS NOT TRUE",
      );
      if (table.name === 'source_records') invalid.push(
        't.original_url IS NULL AND t.raw_uri IS NULL',
        't.observed_at IS NULL AND t.published_at IS NULL AND t.time_missing_reason IS NULL',
        't.first_accessible_at > t.fetched_at',
        "(t.record_status IN ('active', 'corrected', 'cancelled', 'withdrawn')) IS NOT TRUE",
      );
      if (table.name === 'area_indicators') invalid.push('t.period_end < t.period_start',
        "(t.status IN ('observed', 'suppressed', 'missing')) IS NOT TRUE",
        "(t.status = 'observed') != (t.value IS NOT NULL)");
      if (table.name === 'pedestrian_observations') invalid.push(...['direction_a_count', 'direction_b_count', 'total_count']
        .map(name => `t.${name} < 0`));
      const visible = (alias: string) => `(${alias}.batch_id = @batchId OR ${alias}.batch_id IN (SELECT batch_id FROM batch_states WHERE state = 'published'))`;
      if (table.name === 'geo_record_sources') {
        invalid.push(`NOT EXISTS (SELECT 1 FROM ${path('geo_records')} g WHERE g.source_id = @sourceId AND g.geo_record_id = t.geo_record_id
          AND g.source_id = t.source_id AND g.version_id = t.version_id AND ${visible('g')}${fetchedWindow('g')})`);
      }
      if (table.name !== 'source_records' && names.has('source_record_id')) {
        const sourceMatch = table.name === 'geo_record_sources'
          ? 'AND r.source_id = t.source_id AND r.version_id = t.source_version_id'
          : table.name === 'boundaries'
            ? "AND r.source_id = t.source_id AND r.batch_id = t.batch_id AND r.version_id = t.version_id AND r.rights_status IN ('verified_open', 'restricted')"
            : table.name === 'pedestrian_observations'
              ? 'AND r.source_id = t.source_id AND r.batch_id = t.batch_id AND r.version_id = t.version_id'
            : 'AND r.source_id = t.source_id';
        invalid.push(`NOT EXISTS (SELECT 1 FROM ${path('source_records')} r WHERE r.source_id = @sourceId AND r.source_record_id = t.source_record_id
          ${sourceMatch}
          AND ${visible('r')}${fetchedWindow('r')})`);
      }
      if (table.name === 'geo_records') invalid.push(`NOT EXISTS (
        SELECT 1 FROM ${path('geo_record_sources')} r WHERE r.source_id = @sourceId AND r.geo_record_id = t.geo_record_id
          AND r.source_id = t.source_id AND r.version_id = t.version_id AND ${visible('r')}${fetchedWindow('r')})`);
      // With a windowed history only this batch's business references are checked; the run's published-
      // state recovery proved every older one (see WINDOWED_HISTORY_SOURCES).
      const ownBusiness = fetched === null ? '' : 't.business_batch_id = @batchId AND ';
      if (table.name === 'parking_sensor_memberships') invalid.push(
        "t.source_id != 'melbourne.parking.sensors'",
        `NOT EXISTS (SELECT 1 FROM ${path('source_records')} r
          WHERE r.source_id = @sourceId AND r.source_id = t.source_id AND r.batch_id = t.batch_id
            AND r.source_record_id = t.snapshot_source_record_id
            AND r.version_id = t.snapshot_version_id AND ${visible('r')}${fetchedWindow('r')})`,
        `${ownBusiness}NOT EXISTS (SELECT 1 FROM ${path('source_records')} r
          WHERE r.source_id = @sourceId AND r.source_id = t.source_id AND r.batch_id = t.business_batch_id
            AND r.source_record_id = t.business_source_record_id
            AND r.version_id = t.business_version_id AND ${visible('r')}${fetchedWindow('r')})`,
        `${ownBusiness}(NOT EXISTS (SELECT 1 FROM ${path('parking_observations')} o
          WHERE o.source_id = @sourceId AND o.source_id = t.source_id AND o.batch_id = t.business_batch_id
            AND o.source_record_id = t.business_source_record_id AND o.sensor_id = t.sensor_id
            AND o.version_id = t.business_version_id AND ${visible('o')}${fetchedWindow('o')})
          AND NOT EXISTS (SELECT 1 FROM ${path('source_records')} r
            WHERE r.source_id = @sourceId AND r.source_id = t.source_id AND r.batch_id = t.business_batch_id
              AND r.source_record_id = t.business_source_record_id AND r.version_id = t.business_version_id
              AND r.observed_at IS NULL AND ${visible('r')}${fetchedWindow('r')}))`,
      );
      const ordering = table.name === 'pedestrian_observations' ? `(SELECT COUNT(*) FROM (
        SELECT sensor_id, observed_at, COUNT(*) AS versions,
          COUNTIF(source_updated_at IS NULL) AS missing_time,
          COUNTIF(source_updated_at IS NOT NULL) AS has_time,
          COUNTIF(source_version_ordinal IS NULL) AS missing_ordinal,
          COUNT(DISTINCT TO_JSON_STRING(STRUCT(source_updated_at, source_version_ordinal))) AS positions
        FROM (
          SELECT t.sensor_id, t.observed_at, t.version_id,
            r.source_updated_at, r.source_version_ordinal
          FROM eligible AS t
          JOIN ${path('source_records')} r ON r.batch_id = t.batch_id
            AND r.source_id = t.source_id AND r.source_record_id = t.source_record_id
            AND r.version_id = t.version_id
          WHERE r.source_id = @sourceId AND ${visible('r')}
          QUALIFY ROW_NUMBER() OVER (PARTITION BY t.source_id, t.sensor_id, t.observed_at, t.version_id
            ORDER BY t.fetched_at DESC, t.batch_id DESC) = 1
        ) GROUP BY sensor_id, observed_at
        HAVING versions > 1 AND ((missing_time > 0 AND (has_time > 0 OR missing_ordinal > 0))
          OR positions < versions)
      ))` : table.name === 'boundaries' ? `(SELECT COUNT(*) FROM (
        SELECT boundary_id, COUNT(*) AS versions,
          COUNTIF(source_updated_at IS NULL) AS missing_time,
          COUNTIF(source_updated_at IS NOT NULL) AS has_time,
          COUNTIF(source_version_ordinal IS NULL) AS missing_ordinal,
          COUNT(DISTINCT TO_JSON_STRING(STRUCT(source_updated_at, source_version_ordinal))) AS positions
        FROM (
          SELECT t.boundary_id, t.version_id, r.source_updated_at, r.source_version_ordinal
          FROM eligible AS t
          JOIN ${path('source_records')} AS r
            ON r.batch_id = t.batch_id AND r.source_id = t.source_id
            AND r.source_record_id = t.source_record_id AND r.version_id = t.version_id
          WHERE r.source_id = @sourceId AND ${visible('r')}
          QUALIFY ROW_NUMBER() OVER (
            PARTITION BY t.boundary_id, t.version_id
            ORDER BY t.fetched_at DESC, t.batch_id DESC
          ) = 1
        )
        GROUP BY boundary_id
        HAVING versions > 1 AND ((missing_time > 0 AND (has_time > 0 OR missing_ordinal > 0))
          OR positions < versions)
      ))` : names.has('source_updated_at') && table.name !== 'parking_sensor_memberships' ? `(SELECT COUNT(*) FROM (
        SELECT ${logicalKeys.join(', ')}, COUNT(DISTINCT version_id) AS versions,
          COUNTIF(source_updated_at IS NULL) AS missing_time,
          COUNTIF(source_updated_at IS NOT NULL) AS has_time,
          COUNTIF(source_version_ordinal IS NULL) AS missing_ordinal,
          COUNT(DISTINCT TO_JSON_STRING(STRUCT(source_updated_at, source_version_ordinal))) AS positions
        FROM eligible GROUP BY ${logicalKeys.join(', ')}
        HAVING versions > 1 AND ((missing_time > 0 AND (has_time > 0 OR missing_ordinal > 0)) OR positions < versions)
      ))` : '0';
      if (table.rows.length === 0) {
        // Any physical row in a declared empty batch fails publication, even
        // when its business key is null. No cross-table joins are needed to
        // prove absence, and their minimum billing dominates frequent snapshots.
        const rows = await this.query(`/* validate:${table.name} */
          SELECT COUNT(*) AS distinct_count, 0 AS unexpected, 0 AS invalid,
            0 AS conflicts, 0 AS ambiguous
          FROM ${path(table.name)} t WHERE source_id = @sourceId AND batch_id = @batchId${batchWindow('t')}`, {
          batchId, sourceId: source.source_id, expectedRows: '[]', ...fetchedParams,
        });
        const report = rows[0];
        if (['distinct_count', 'unexpected', 'invalid', 'conflicts', 'ambiguous']
          .some(key => count.parse(Number(report?.[key] ?? NaN)) !== 0)) {
          throw new Error(`BigQuery validation failed for ${table.name}`);
        }
        continue;
      }
      for (const expectedRows of validationChunks(table)) {
        const logicalId = logicalKeys[0];
        if (logicalId === undefined) throw new Error(`Missing logical key in ${table.name}`);
        const rows = await this.query(`/* validate:${table.name} */
        WITH batch_states AS (
          SELECT batch_id, state FROM ${path('sync_batches')} WHERE source_id = @sourceId
          QUALIFY ROW_NUMBER() OVER (PARTITION BY batch_id ORDER BY state_updated_at DESC) = 1
        ), expected AS (
          SELECT ${tuple(keys, true)} AS row_key, ${tuple(contentFields, true)} AS content
          FROM UNNEST(JSON_QUERY_ARRAY(@expectedRows)) e
        ), batch_rows AS (
          SELECT t.*, ${tuple(keys)} AS row_key, ${tuple(contentFields)} AS content
          FROM ${path(table.name)} t WHERE source_id = @sourceId AND batch_id = @batchId${batchWindow('t')}
        ), eligible AS (
          SELECT t.*, ${tuple(keys)} AS row_key, ${tuple(contentFields)} AS content
          FROM ${path(table.name)} t
          WHERE t.source_id = @sourceId ${snapshotScope}${fetchedWindow('t')}
            AND t.${logicalId} IN UNNEST(JSON_VALUE_ARRAY(@logicalIds))
            AND ${visible('t')} AND ${tuple(logicalKeys)} IN (
            SELECT ${tuple(logicalKeys)} FROM batch_rows t
          )
        )
        SELECT (SELECT COUNT(DISTINCT row_key) FROM batch_rows) AS distinct_count,
          (SELECT COUNT(*) FROM expected e WHERE NOT EXISTS (
            SELECT 1 FROM batch_rows t WHERE e.row_key = t.row_key AND e.content = t.content)) AS unexpected,
          ${replayOf !== undefined
            // The published batch passed these checks; an unreferenced CTE is never read.
            ? '0 AS invalid, 0 AS conflicts, 0 AS ambiguous'
            : `(SELECT COUNT(*) FROM batch_rows t WHERE ${invalid.map(check => `(${check})`).join(' OR ')}) AS invalid,
          (SELECT COUNT(*) FROM (SELECT row_key FROM eligible GROUP BY row_key
            HAVING COUNT(DISTINCT content) > 1)) AS conflicts,
          ${ordering} AS ambiguous`}`, {
          batchId, sourceId: source.source_id, licenseStatus: source.license_status,
          allowedFields: JSON.stringify(source.admission_evidence.allowed_fields ?? []),
          expectedRows: JSON.stringify(expectedRows),
          logicalIds: JSON.stringify([...new Set(expectedRows.map(row => row[logicalId]))]),
          ...fetchedParams,
        });
        const values = rows[0];
        const number = (key: string) => count.parse(Number(values?.[key] ?? NaN));
        if (number('distinct_count') !== table.expectedDistinct
          || ['unexpected', 'invalid', 'conflicts', 'ambiguous'].some(key => number(key) !== 0)) {
          throw new Error(`BigQuery validation failed for ${table.name}`);
        }
      }
    }
  }

  /** Serialize revocation with every publication for this source, then remove retained facts. */
  async pauseSource(source: DataSource): Promise<{ deletedCopies: number }> {
    const batchId = `revoke_${digest(`${source.source_id}\n${Date.now()}`).slice(0, 40)}`;
    return this.gcs.withBatchLease(sourceLease(source), async () => {
      const previous = await this.latestSourceTimes(source.source_id);
      const row = { ...source, access_status: 'paused', license_status: 'review_required',
        last_checked_at: previous.lastCheckedAt, last_success_at: previous.lastSuccessAt,
        last_source_update_at: previous.lastSourceUpdateAt,
        updated_at: previous.updatedAt === null ? new Date().toISOString() : after(previous.updatedAt) };
      const staged = await this.gcs.saveNdjson({ kind: 'staging', sourceId: source.source_id,
        batchId, rows: [row], allowedFields: null, retentionDays: 1 });
      await loadNdjson({ bigquery: this.bigquery, dataset: this.config.ingestDataset,
        table: 'data_sources', batchId, uri: staged.uri, location: this.config.region });
      for (const table of Object.keys(TABLE_KEYS)) {
        await this.query(`DELETE FROM \`${this.config.projectId}.${this.config.ingestDataset}.${table}\`
          WHERE source_id = @sourceId`, { sourceId: source.source_id });
      }
      await this.query(`UPDATE \`${this.config.projectId}.${this.config.ingestDataset}.sync_batches\`
        SET raw_uri = NULL, staging_uris = [] WHERE source_id = @sourceId`, { sourceId: source.source_id });
      return { deletedCopies: await this.gcs.purgeSourceCopies(source.source_id) };
    });
  }

  async publish(input: {
    source: DataSource;
    result: ConnectorSuccess;
    windowFrom: string | null;
    windowTo: string | null;
    initialCheckpoint: string | null;
  }): Promise<SyncBatch> {
    const { source, result } = input;
    if (source.license_status === 'review_required' || source.access_status !== 'active'
      || source.admission_evidence.missing_requirements.length > 0) {
      throw new Error('Source has not passed admission');
    }
    if ((input.windowFrom === null) !== (input.windowTo === null)) throw new Error('Both window endpoints are required');
    if (input.windowFrom !== null && input.windowTo !== null) {
      utc.parse(input.windowFrom);
      utc.parse(input.windowTo);
      utc.parse(input.initialCheckpoint);
      if (Date.parse(input.windowFrom) >= Date.parse(input.windowTo)) throw new Error('Window must be non-empty');
    }
    const planned = planRows(result, source, 'pending');
    const effectiveRevision = result.sourceRevision ?? digest(canonical(planned.tables.map(table => ({
      name: table.name, rows: [...new Set(table.rows.map(row => canonical(contentOf(row))))].sort(),
    }))));
    const batchId = stableBatchId(source.source_id, input.windowFrom, input.windowTo, effectiveRevision);
    const plan = { ...planned, tables: planned.tables.map(table => ({ ...table,
      rows: table.rows.map(row => ({ ...row, batch_id: batchId,
        ...(table.name === 'parking_sensor_memberships' && row.business_batch_id === 'pending'
          ? { business_batch_id: batchId } : {}),
      })),
    })) };
    // Different batches can contain the same version; lock the source through validation and publication.
    return this.gcs.withBatchLease(sourceLease(source), async () => {
      const sourceState = await this.latestSourceTimes(source.source_id);
      if (sourceState.accessStatus === 'paused' || sourceState.licenseStatus === 'review_required'
        || (sourceState.licenseStatus === 'restricted' && source.license_status === 'verified_open')) {
        throw new Error('Stored source permission has been withdrawn or narrowed');
      }
      const previous = await this.latestBatch(batchId, source.source_id);
      const now = previous === null ? new Date().toISOString() : after(previous.state_updated_at);
      const before = input.initialCheckpoint === null ? null
        : (await this.gcs.readCheckpoint(source.source_id, input.initialCheckpoint)).manifest.checkpoint;
      const finish = async (batch: SyncBatch): Promise<SyncBatch> => {
        let checkpoint = result.checkpointAfter;
        if (input.windowFrom !== null && input.windowTo !== null && input.initialCheckpoint !== null) {
          checkpoint = (await this.gcs.markPublishedWindow(source.source_id, input.initialCheckpoint,
            { from: input.windowFrom, to: input.windowTo, batchId })).checkpoint;
        }
        const complete = checkpoint === batch.checkpoint_after ? batch : { ...batch,
          checkpoint_after: checkpoint, state_updated_at: after(batch.state_updated_at) };
        if (complete !== batch) await this.appendState(complete);
        await this.appendSourceCheck(source, batchId, result.fetchedAt, result.fetchedAt, result.sourceLatestUpdateAt);
        await this.gcs.deleteStagingObjects(complete.staging_uris);
        return complete;
      };
      if (previous?.state === 'published') {
        // Most scheduled runs of an unchanged source land here. The published batch already passed
        // the history checks, so a replay only proves that its stored rows equal this plan, reading
        // the batch's own partitions instead of the source's whole history once per chunk.
        await this.validateLoadedRows(batchId, plan.tables, source, previous);
        return finish(previous);
      }
      const base: SyncBatch = {
        batch_id: batchId, source_id: source.source_id, schema_version: 1,
        window_from: input.windowFrom, window_to: input.windowTo, source_revision: effectiveRevision,
        started_at: COMPLETE_SNAPSHOT_SOURCES.has(source.source_id) || source.source_id === 'melbourne.parking.sensors'
          ? result.fetchedAt : now, finished_at: null, state: 'running', state_updated_at: now,
        raw_uri: previous?.raw_uri ?? null, staging_uris: previous?.staging_uris ?? [], published_at: null,
        input_count: result.inputCount, output_count: result.outputCount,
        rejected_count: result.rejectedCount + plan.rejectedGeography,
        checkpoint_before: before, checkpoint_after: null, error_code: null,
      };
      await this.appendState(base);
      const stagingUris = new Set(base.staging_uris);
      let published = false;
      let lastTransitionAt = base.state_updated_at;
      try {
        const rawRetentionDays = source.admission_evidence.raw_retention_days ?? 0;
        if (result.retainableRawRecords && rawRetentionDays > 0) {
          const raw = await this.gcs.saveNdjson({ kind: 'raw', sourceId: source.source_id,
            batchId, rows: result.retainableRawRecords,
            allowedFields: source.admission_evidence.allowed_fields,
            retentionDays: rawRetentionDays });
          base.raw_uri = raw.uri;
        }
        await this.appendSourceCheck(source, batchId, result.fetchedAt, null, result.sourceLatestUpdateAt);
        for (const table of plan.tables) {
          if (table.rows.length === 0) continue;
          const highFrequency = (source.cadence_seconds ?? Number.POSITIVE_INFINITY) <= 300
            && ['parking_observations', 'parking_sensor_memberships', 'geo_record_sources',
              'pedestrian_observations', 'source_records', 'geo_records'].includes(table.name);
          if (highFrequency) {
            await this.writeRows({ projectId: this.config.projectId,
              dataset: this.config.ingestDataset, table: table.name, batchId, rows: table.rows });
          } else {
            const object = await this.gcs.saveNdjson({ kind: 'staging', sourceId: source.source_id,
              batchId: `${batchId}.${table.name}`, rows: table.rows, allowedFields: null,
              retentionDays: source.admission_evidence.staging_retention_days ?? 1 });
            stagingUris.add(object.uri);
            await loadNdjson({ bigquery: this.bigquery, dataset: this.config.ingestDataset,
              table: table.name, batchId, uri: object.uri, location: this.config.region });
          }
        }
        base.staging_uris = [...stagingUris];
        await this.validateLoadedRows(batchId, plan.tables, source);
        const validated: SyncBatch = { ...base, state: 'validated', state_updated_at: after(base.state_updated_at) };
        await this.appendState(validated);
        lastTransitionAt = validated.state_updated_at;
        const publishedAt = after(validated.state_updated_at);
        const complete: SyncBatch = { ...validated, state: 'published', state_updated_at: publishedAt,
          finished_at: publishedAt, published_at: publishedAt };
        await this.appendState(complete);
        published = true;
        return await finish(complete);
      } catch (error) {
        let remote: SyncBatch | null | undefined;
        if (!published) {
          try {
            remote = await this.latestBatch(batchId, source.source_id);
          } catch {
            // An uncertain publish must be reconciled before any failure marker can hide it.
          }
        }
        if (!published && remote !== undefined && remote?.state !== 'published') {
          const failedAt = after(remote?.state_updated_at ?? lastTransitionAt);
          await this.appendState({ ...base, state: 'failed', state_updated_at: failedAt,
            finished_at: failedAt, error_code: 'validation_failed', staging_uris: [...stagingUris] });
        }
        throw error;
      }
    });
  }
}
