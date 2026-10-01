import { BigQuery } from '@google-cloud/bigquery';
import { z } from 'zod';

import type { DataConfig } from './config.js';
import { GcsStore } from './gcs.js';

export const SOURCE_RETENTION = {
  'ticketmaster.events': { seconds: 86_400, cleanupAgeSeconds: 64_800,
    tables: ['source_records', 'geo_records', 'geo_record_sources'] },
  'melbourne.parking.sensors': { seconds: 172_800, cleanupAgeSeconds: 172_800,
    tables: ['source_records', 'geo_records', 'geo_record_sources', 'parking_observations',
      'parking_sensor_memberships'] },
  'gdelt.news': { seconds: 2_592_000, cleanupAgeSeconds: 2_592_000,
    tables: ['source_records', 'geo_records', 'geo_record_sources'] },
} as const;

export type RetainedSourceId = keyof typeof SOURCE_RETENTION;
const retainedSourceId = z.enum(['ticketmaster.events', 'melbourne.parking.sensors', 'gdelt.news']);

/** Only reviewed source content is removed; other facts and batch audit remain. */
export function sourceRetentionPlan(sourceId: string, now: Date) {
  const source = retainedSourceId.parse(sourceId);
  if (!Number.isFinite(now.getTime())) throw new Error('Invalid retention clock');
  const policy = SOURCE_RETENTION[source];
  return { sourceId: source, tables: policy.tables,
    cutoff: new Date(now.getTime() - policy.cleanupAgeSeconds * 1000).toISOString() };
}

export async function cleanupSourceContent(
  config: DataConfig,
  bigquery: Pick<BigQuery, 'query'>,
  gcs: Pick<GcsStore, 'cleanupSourceExpired'>,
  sourceId: string,
  now = new Date(),
): Promise<{ sourceId: string; tablesChecked: number; deletedObjects: number }> {
  const plan = sourceRetentionPlan(sourceId, now);
  if (!config.maxBytesBilled) throw new Error('Retention requires a BigQuery query ceiling');
  // A script submits the deletes together, avoiding one minimum query job per
  // empty table. Source and fetched-date predicates prune unrelated partitions.
  const path = (table: string) => `\`${config.projectId}.${config.ingestDataset}.${table}\``;
  const latestSensorBatch = `(SELECT batch_id FROM ${path('sync_batches')}
    WHERE source_id = @sourceId
    QUALIFY ROW_NUMBER() OVER (PARTITION BY batch_id ORDER BY state_updated_at DESC) = 1
      AND state = 'published' AND published_at IS NOT NULL
    ORDER BY started_at DESC LIMIT 1)`;
  const query = plan.tables.map(table => {
    const sensor = plan.sourceId === 'melbourne.parking.sensors';
    const membership = table === 'parking_sensor_memberships';
    const match = table === 'source_records' ? 't.source_record_id = m.business_source_record_id AND t.version_id = m.business_version_id'
      : table === 'geo_record_sources' ? 't.source_record_id = m.business_source_record_id AND t.source_version_id = m.business_version_id'
        : table === 'parking_observations' ? 't.sensor_id = m.sensor_id AND t.version_id = m.business_version_id'
          : 't.geo_record_id = m.business_source_record_id AND t.version_id = m.business_version_id';
    // A stable device can remain unchanged for months. Preserve its exact
    // business version while the latest complete snapshot still references it.
    const protectedReference = sensor && membership
      ? `AND (${latestSensorBatch} IS NULL OR t.batch_id != ${latestSensorBatch})`
      : sensor ? `AND NOT EXISTS (
      SELECT 1 FROM ${path('parking_sensor_memberships')} m
      WHERE m.source_id = @sourceId AND m.business_batch_id = t.batch_id AND ${match}
        AND m.batch_id = ${latestSensorBatch})
      ${table === 'source_records' ? `AND (${latestSensorBatch} IS NULL OR t.batch_id != ${latestSensorBatch}
        OR NOT STARTS_WITH(t.source_record_id, 'melbourne.parking.sensors:snapshot:'))` : ''}` : '';
    const cutoff = membership ? new Date(now.getTime() - 86_400_000).toISOString() : plan.cutoff;
    return `DELETE FROM ${path(table)} t
    WHERE source_id = @sourceId AND DATE(fetched_at) <= DATE(TIMESTAMP('${cutoff}'))
      AND fetched_at < TIMESTAMP('${cutoff}') ${protectedReference};`;
  }).join('\n');
  await bigquery.query({ query, params: { sourceId: plan.sourceId, cutoff: plan.cutoff },
    location: config.region, maximumBytesBilled: config.maxBytesBilled });
  const deletedObjects = await gcs.cleanupSourceExpired(plan.sourceId, now, 1000,
    SOURCE_RETENTION[plan.sourceId].cleanupAgeSeconds);
  return { sourceId: plan.sourceId, tablesChecked: plan.tables.length, deletedObjects };
}
