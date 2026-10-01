import type { BigQuery } from '@google-cloud/bigquery';
import { z } from 'zod';

import type { ConnectorInput } from './connector.js';
import type { DataConfig } from './config.js';
import type { SensorLocation } from './types.js';

const sourceId = 'melbourne.pedestrian.locations';
const utc = z.iso.datetime({ offset: false });
const nonEmpty = z.string().trim().min(1);
export const maximumPedestrianLocationHistory = 50_000;
export const pedestrianPointSchema = z.object({
  type: z.literal('Point'),
  coordinates: z.tuple([
    z.number().finite().min(-180).max(180), z.number().finite().min(-90).max(90),
  ]),
}).strict();

export const pedestrianLocationHistoryRowSchema: z.ZodType<SensorLocation> = z.object({
  batch_id: nonEmpty,
  source_id: z.literal(sourceId),
  schema_version: z.literal(1),
  fetched_at: utc,
  sensor_id: z.string().regex(/^\d+$/),
  version_id: nonEmpty,
  geometry_geojson: z.string().refine(value => {
    try { return pedestrianPointSchema.safeParse(JSON.parse(value)).success; }
    catch { return false; }
  }, 'History coordinates must be a valid WGS84 Point').nullable(),
  device_status: z.string().nullable(),
  valid_from: utc,
  valid_to: utc.nullable(),
  source_record_id: nonEmpty,
  source_updated_at: utc.nullable(),
  source_version_ordinal: z.number().int().nonnegative().nullable(),
}).strict().superRefine((row, context) => {
  if (row.source_record_id !== `${sourceId}:${row.sensor_id}`) {
    context.addIssue({ code: 'custom', path: ['source_record_id'], message: 'Unexpected sensor source record identity' });
  }
  if (row.valid_to !== null && Date.parse(row.valid_to) < Date.parse(row.valid_from)) {
    context.addIssue({ code: 'custom', path: ['valid_to'], message: 'Location interval is reversed' });
  }
});

export const pedestrianLocationHistorySchema = z.array(pedestrianLocationHistoryRowSchema)
  .max(maximumPedestrianLocationHistory).superRefine((locations, context) => {
    const intervals = new Set<string>();
    const openSensors = new Set<string>();
    for (const [index, location] of locations.entries()) {
      const key = `${location.sensor_id}:${new Date(location.valid_from).toISOString()}`;
      if (intervals.has(key)) {
        context.addIssue({ code: 'custom', path: [index], message: 'Duplicate sensor location interval in history' });
      }
      intervals.add(key);
      if (location.valid_to === null) {
        if (openSensors.has(location.sensor_id)) {
          context.addIssue({ code: 'custom', path: [index], message: 'Multiple open sensor location intervals in history' });
        }
        openSensors.add(location.sensor_id);
      }
    }
  });

export const pedestrianLocationCheckpointSchema = z.object({
  kind: z.literal('published_pedestrian_locations'),
  cursor: nonEmpty.nullable(),
  locations: pedestrianLocationHistorySchema,
}).strict();

/** Published facts restore history in a fresh process; snapshot cursors stay opaque. */
export async function withPublishedPedestrianLocationHistory(input: ConnectorInput,
  config: DataConfig, bigquery: Pick<BigQuery, 'query'>): Promise<ConnectorInput> {
  if (input.sourceId !== sourceId) return input;
  if (input.window.kind !== 'snapshot') throw new Error('Pedestrian locations require a complete snapshot');
  if (!config.maxBytesBilled) throw new Error('Location history requires a billed-byte ceiling');
  const path = (table: string) => `\`${config.projectId}.${config.ingestDataset}.${table}\``;
  const [rows] = await bigquery.query({
    query: `/* published-pedestrian-location-history */
      WITH batch_states AS (
        SELECT batch_id, source_id, state, published_at FROM ${path('sync_batches')}
        QUALIFY ROW_NUMBER() OVER (PARTITION BY batch_id
          ORDER BY state_updated_at DESC, started_at DESC) = 1
      ), locations AS (
        SELECT l.* FROM ${path('sensor_locations')} l
        JOIN batch_states b ON b.batch_id = l.batch_id AND b.source_id = l.source_id
          AND b.state = 'published' AND b.published_at IS NOT NULL
        JOIN ${path('source_records')} r ON r.batch_id = l.batch_id
          AND r.source_id = l.source_id AND r.source_record_id = l.source_record_id
          AND r.version_id = l.version_id
        WHERE l.source_id = @sourceId
        QUALIFY ROW_NUMBER() OVER (PARTITION BY l.source_id, l.sensor_id, l.valid_from
          ORDER BY l.source_updated_at DESC NULLS LAST,
            l.source_version_ordinal DESC NULLS LAST, l.fetched_at DESC,
            IF(l.valid_to IS NULL, 1, 0), l.batch_id DESC, l.version_id DESC) = 1
      )
      SELECT TO_JSON_STRING(STRUCT(batch_id, source_id, schema_version,
        FORMAT_TIMESTAMP('%Y-%m-%dT%H:%M:%E3SZ', fetched_at, 'UTC') AS fetched_at,
        sensor_id, version_id, geometry_geojson, device_status,
        FORMAT_TIMESTAMP('%Y-%m-%dT%H:%M:%E3SZ', valid_from, 'UTC') AS valid_from,
        FORMAT_TIMESTAMP('%Y-%m-%dT%H:%M:%E3SZ', valid_to, 'UTC') AS valid_to,
        source_record_id,
        FORMAT_TIMESTAMP('%Y-%m-%dT%H:%M:%E3SZ', source_updated_at, 'UTC') AS source_updated_at,
        source_version_ordinal)) AS location
      FROM locations ORDER BY sensor_id, valid_from LIMIT ${maximumPedestrianLocationHistory + 1}`,
    params: { sourceId },
    location: config.region,
    maximumBytesBilled: config.maxBytesBilled,
  });
  const encoded = z.array(z.object({ location: z.string() }).strict())
    .max(maximumPedestrianLocationHistory).parse(rows);
  const locations = pedestrianLocationHistorySchema.parse(encoded.map(row => JSON.parse(row.location)));
  return { ...input, checkpoint: JSON.stringify({
    kind: 'published_pedestrian_locations', cursor: input.checkpoint, locations,
  }) };
}
