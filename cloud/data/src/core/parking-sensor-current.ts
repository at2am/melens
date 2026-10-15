import type { BigQuery } from '@google-cloud/bigquery';
import { z } from 'zod';

import type { DataConfig } from './config.js';
import type { ConnectorSuccess } from './connector.js';
import { validateGeoRecordGeography } from '../validation/geography.js';

/**
 * The latest complete sensor snapshot, kept as a single small table the map reads.
 *
 * The append-only fact tables stay the audit trail, but they cannot serve a map: their
 * unchanged-sensor deduplication scatters one snapshot across many partitions, so a view over
 * them scans everything however few sensors a viewport needs (165 MB against a 100 MB ceiling
 * on 2026-10-15). This table is rebuilt from the fresh fetch alone, with no history, and
 * swapped in one transaction after the batch is published. If the swap fails the previous
 * snapshot stays and its per-sensor `source_updated_at` makes it read as stale.
 */
export const SENSOR_SOURCE_ID = 'melbourne.parking.sensors';
export const PARKING_SENSOR_CURRENT_TABLE = 'parking_sensor_current';
/**
 * The real 6,324-sensor snapshot was 5.0 MB of JSON on 2026-10-15. Stay inside BigQuery's 10 MB
 * request limit; a snapshot that outgrows this needs a load job instead of a query parameter.
 */
const MAX_PAYLOAD_BYTES = 8_000_000;

export interface ParkingSensorCurrentRow {
  sensor_id: string;
  source_id: string;
  batch_id: string;
  schema_version: 1;
  fetched_at: string;
  source_record_id: string;
  version_id: string;
  /** The sensor's own last report; a sensor that stopped reporting keeps an old value. */
  source_updated_at: string;
  observed_at: string | null;
  occupied: boolean | null;
  status_description: string | null;
  zone_number: number | null;
  marker_id: string | null;
  bay_id: string | null;
  latitude: number | null;
  longitude: number | null;
  geometry_geojson: string | null;
  original_url: string;
  record_status: string;
  rights_status: string;
}

const summarySchema = z.object({
  status_description: z.string().nullable().optional(),
  zone_number: z.number().int().nullable().optional(),
}).passthrough();

function readSummary(summary: string | null): { status: string | null; zone: number | null } {
  if (summary === null) return { status: null, zone: null };
  try {
    const parsed = summarySchema.safeParse(JSON.parse(summary));
    if (!parsed.success) return { status: null, zone: null };
    return { status: parsed.data.status_description ?? null, zone: parsed.data.zone_number ?? null };
  } catch {
    return { status: null, zone: null };
  }
}

/** Build one row per sensor from a complete snapshot. Missing facts stay null, never guessed. */
export function buildParkingSensorCurrentRows(result: ConnectorSuccess, batchId: string): ParkingSensorCurrentRow[] {
  if (result.sourceId !== SENSOR_SOURCE_ID) throw new Error('Current-sensor projection requires the parking sensor source');
  if (!batchId) throw new Error('Current-sensor projection requires the published batch id');
  const prefix = `${SENSOR_SOURCE_ID}:`;
  const geoById = new Map(result.geoRecords.map(row => [row.geo_record_id, row]));
  const observations = new Map<string, ConnectorSuccess['parkingObservations'][number]>();
  for (const row of result.parkingObservations) {
    const previous = observations.get(row.source_record_id);
    if (previous === undefined || row.observed_at > previous.observed_at) observations.set(row.source_record_id, row);
  }
  const rows: ParkingSensorCurrentRow[] = [];
  const seen = new Set<string>();
  for (const record of result.sourceRecords) {
    if (!record.source_record_id.startsWith(prefix)) continue; // the snapshot proof, not a sensor
    const sensorId = record.source_record_id.slice(prefix.length);
    if (!/^kerbside:\S+$/.test(sensorId)) throw new Error('Invalid parking sensor identity');
    if (seen.has(sensorId)) throw new Error('Duplicate sensors cannot establish a complete parking snapshot');
    seen.add(sensorId);
    if (record.source_updated_at === null) throw new Error('A sensor snapshot row needs its own report time');
    if (record.original_url === null) throw new Error('A sensor snapshot row needs its source page for attribution');
    const geo = geoById.get(record.source_record_id);
    // A location that fails geography validation is dropped, exactly as the fact tables drop it.
    const located = geo === undefined ? null : validateGeoRecordGeography(geo).geographicRecord;
    const observation = observations.get(record.source_record_id);
    const summary = readSummary(geo?.summary ?? null);
    rows.push({
      sensor_id: sensorId, source_id: SENSOR_SOURCE_ID, batch_id: batchId, schema_version: 1,
      fetched_at: result.fetchedAt, source_record_id: record.source_record_id, version_id: record.version_id,
      source_updated_at: record.source_updated_at,
      observed_at: record.observed_at,
      occupied: observation?.occupied ?? null,
      status_description: summary.status, zone_number: summary.zone,
      marker_id: observation?.marker_id ?? null, bay_id: observation?.bay_id ?? null,
      latitude: located?.centroid_lat ?? null, longitude: located?.centroid_lon ?? null,
      geometry_geojson: located?.geometry_geojson ?? null,
      original_url: record.original_url, record_status: record.record_status, rights_status: record.rights_status,
    });
  }
  if (rows.length !== result.inputCount) {
    throw new Error('Current-sensor projection must account for every input sensor');
  }
  return rows;
}

const COLUMNS = ['sensor_id', 'source_id', 'batch_id', 'schema_version', 'fetched_at', 'source_record_id',
  'version_id', 'source_updated_at', 'observed_at', 'occupied', 'status_description', 'zone_number',
  'marker_id', 'bay_id', 'latitude', 'longitude', 'geometry_geojson', 'original_url', 'record_status',
  'rights_status'] as const;

/**
 * The swap statement. Exported so tests can assert it without a BigQuery connection.
 * Source coordinates carry up to 16 significant digits (144.9434975049776). PARSE_JSON's default
 * `exact` mode rejects any number that does not round-trip through FLOAT64, which failed the first
 * production run on 2026-10-15; `round` keeps the nearest FLOAT64, the column's own precision.
 */
export function replaceParkingSensorCurrentSql(config: DataConfig): string {
  const table = `\`${config.projectId}.${config.ingestDataset}.${PARKING_SENSOR_CURRENT_TABLE}\``;
  const json = (column: string) => `JSON_VALUE(j, '$.${column}')`;
  const select: Record<(typeof COLUMNS)[number], string> = {
    sensor_id: json('sensor_id'), source_id: json('source_id'), batch_id: json('batch_id'),
    schema_version: `CAST(${json('schema_version')} AS INT64)`,
    fetched_at: `CAST(${json('fetched_at')} AS TIMESTAMP)`,
    source_record_id: json('source_record_id'), version_id: json('version_id'),
    source_updated_at: `CAST(${json('source_updated_at')} AS TIMESTAMP)`,
    observed_at: `SAFE_CAST(${json('observed_at')} AS TIMESTAMP)`,
    occupied: `SAFE_CAST(${json('occupied')} AS BOOL)`,
    status_description: json('status_description'),
    zone_number: `SAFE_CAST(${json('zone_number')} AS INT64)`,
    marker_id: json('marker_id'), bay_id: json('bay_id'),
    latitude: `SAFE_CAST(${json('latitude')} AS FLOAT64)`,
    longitude: `SAFE_CAST(${json('longitude')} AS FLOAT64)`,
    geometry_geojson: json('geometry_geojson'), original_url: json('original_url'),
    record_status: json('record_status'), rights_status: json('rights_status'),
  };
  return `BEGIN TRANSACTION;
    DELETE FROM ${table} WHERE source_id = @sourceId;
    INSERT INTO ${table} (${COLUMNS.join(', ')})
    SELECT ${COLUMNS.map(column => select[column]).join(', ')}
    FROM UNNEST(JSON_QUERY_ARRAY(PARSE_JSON(@payload, wide_number_mode => 'round'))) AS j;
    COMMIT TRANSACTION;`;
}

/** Replace the whole current snapshot atomically. Readers see the old or the new one, never a mix. */
export async function replaceParkingSensorCurrent(
  config: DataConfig,
  bigquery: Pick<BigQuery, 'query'>,
  rows: readonly ParkingSensorCurrentRow[],
): Promise<{ rows: number }> {
  if (!config.maxBytesBilled) throw new Error('Current-sensor projection requires a BigQuery query ceiling');
  if (new Set(rows.map(row => row.batch_id)).size > 1) throw new Error('A current snapshot belongs to one batch');
  const payload = JSON.stringify(rows);
  if (Buffer.byteLength(payload) > MAX_PAYLOAD_BYTES) throw new Error('Current-sensor snapshot exceeds the safe request size');
  await bigquery.query({ query: replaceParkingSensorCurrentSql(config),
    params: { sourceId: SENSOR_SOURCE_ID, payload }, location: config.region,
    maximumBytesBilled: config.maxBytesBilled });
  return { rows: rows.length };
}
