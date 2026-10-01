import { BigQuery } from '@google-cloud/bigquery';
import { z } from 'zod';

import type { ConnectorInput } from './connector.js';
import type { DataConfig } from './config.js';

const utc = z.iso.datetime({ offset: false });
const publishedSummary = z.object({
  sensorId: z.string().min(1),
  observedAt: utc,
  recordId: z.string().min(1),
  versionId: z.string().min(1),
  sourceUpdatedAt: utc.nullable(),
  count: z.number().int().nonnegative().nullable(),
});
const maximumSummaries = 50_000;

/** Coverage stays a UTC cursor. Published facts supply bounded correction history. */
export async function withPublishedPedestrianHistory(input: ConnectorInput,
  config: DataConfig, bigquery: Pick<BigQuery, 'query'>): Promise<ConnectorInput> {
  if (input.sourceId !== 'melbourne.pedestrian.hourly' || input.window.kind !== 'time') return input;
  if (!config.maxBytesBilled) throw new Error('Hourly history requires a billed-byte ceiling');
  const path = (table: string) => `\`${config.projectId}.${config.ingestDataset}.${table}\``;
  const [rows] = await bigquery.query({
    query: `/* published-pedestrian-history */
      WITH batch_states AS (
        SELECT batch_id, state FROM ${path('sync_batches')}
        QUALIFY ROW_NUMBER() OVER (PARTITION BY batch_id ORDER BY state_updated_at DESC) = 1
      ), observations AS (
        SELECT p.sensor_id, p.observed_at, p.source_record_id, p.version_id,
          p.total_count, r.source_updated_at, r.source_version_ordinal
        FROM ${path('pedestrian_observations')} p
        JOIN batch_states b ON b.batch_id = p.batch_id AND b.state = 'published'
        JOIN ${path('source_records')} r ON r.batch_id = p.batch_id
          AND r.source_id = p.source_id AND r.source_record_id = p.source_record_id
          AND r.version_id = p.version_id
        WHERE p.source_id = @sourceId
          AND p.observed_at >= TIMESTAMP(@from) AND p.observed_at < TIMESTAMP(@to)
        QUALIFY ROW_NUMBER() OVER (PARTITION BY p.sensor_id, p.observed_at
          ORDER BY r.source_updated_at DESC, r.source_version_ordinal DESC, p.fetched_at DESC) = 1
      )
      SELECT TO_JSON_STRING(STRUCT(sensor_id AS sensorId,
        FORMAT_TIMESTAMP('%Y-%m-%dT%H:%M:%E3SZ', observed_at, 'UTC') AS observedAt,
        source_record_id AS recordId, version_id AS versionId,
        FORMAT_TIMESTAMP('%Y-%m-%dT%H:%M:%E3SZ', source_updated_at, 'UTC') AS sourceUpdatedAt,
        total_count AS count)) AS summary
      FROM observations ORDER BY sensor_id, observed_at LIMIT ${maximumSummaries + 1}`,
    params: { sourceId: input.sourceId, from: input.window.from, to: input.window.to },
    location: config.region,
    maximumBytesBilled: config.maxBytesBilled,
  });
  const summaries = z.array(z.object({ summary: z.string() })).max(maximumSummaries).parse(rows)
    .map(row => publishedSummary.parse(JSON.parse(row.summary)))
    .map(row => ({ recordId: row.recordId,
      sensorHourKey: `${row.sensorId}:${new Date(row.observedAt).toISOString()}`,
      versionId: row.versionId, sourceUpdatedAt: row.sourceUpdatedAt, count: row.count }));
  return { ...input, checkpoint: JSON.stringify({ cursor: input.checkpoint ?? input.window.from, summaries }) };
}
