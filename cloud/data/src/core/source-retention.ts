import { BigQuery } from '@google-cloud/bigquery';
import { z } from 'zod';

import type { DataConfig } from './config.js';
import { GcsStore } from './gcs.js';

export const SOURCE_RETENTION = {
  'ticketmaster.events': { seconds: 86_400, cleanupAgeSeconds: 64_800,
    tables: ['source_records', 'geo_records', 'geo_record_sources'] },
  // Memberships come first: the other tables protect only what the latest membership still
  // references, so shrinking it first keeps every later cleanup query small.
  'melbourne.parking.sensors': { seconds: 172_800, cleanupAgeSeconds: 172_800,
    tables: ['parking_sensor_memberships', 'source_records', 'geo_records', 'geo_record_sources',
      'parking_observations'] },
  'gdelt.news': { seconds: 2_592_000, cleanupAgeSeconds: 2_592_000,
    tables: ['source_records', 'geo_records', 'geo_record_sources'] },
} as const;

/**
 * Rows of a batch that never reached `published` are invisible to every view
 * and are never replayed by a later publication of another batch. Two hours is
 * well past the longest task timeout, so no live publication still owns them.
 */
export const UNPUBLISHED_BATCH_CLEANUP_SECONDS = 7_200;

/**
 * Every sensor snapshot writes one membership row per sensor (about 3.3 MB). Only the latest
 * published snapshot is ever read (the current views and the ingest recovery), so older ones
 * are audit noise that grows to gigabytes a day. Keep an hour for investigation, no more;
 * that also keeps the deletes well clear of rows still on the streaming write path.
 */
export const PARKING_MEMBERSHIP_RETENTION_SECONDS = 3_600;

export type RetainedSourceId = keyof typeof SOURCE_RETENTION;
const retainedSourceId = z.enum(['ticketmaster.events', 'melbourne.parking.sensors', 'gdelt.news']);
const parkingSourceId = 'melbourne.parking.sensors';

/** Only reviewed source content is removed; other facts and batch audit remain. */
export function sourceRetentionPlan(sourceId: string, now: Date) {
  const source = retainedSourceId.parse(sourceId);
  if (!Number.isFinite(now.getTime())) throw new Error('Invalid retention clock');
  const policy = SOURCE_RETENTION[source];
  const ago = (seconds: number) => new Date(now.getTime() - seconds * 1000).toISOString();
  return { sourceId: source, tables: policy.tables,
    cutoff: ago(policy.cleanupAgeSeconds),
    unpublishedCutoff: ago(UNPUBLISHED_BATCH_CLEANUP_SECONDS),
    membershipCutoff: ago(PARKING_MEMBERSHIP_RETENTION_SECONDS) };
}

type RetentionPlan = ReturnType<typeof sourceRetentionPlan>;
type RetainedTable = RetentionPlan['tables'][number];

/** The newest boundary any table's delete can reach; later partitions are never touched. */
function latestCutoff(plan: RetentionPlan, table: RetainedTable): string {
  const candidates = [plan.cutoff, plan.unpublishedCutoff,
    ...(table === 'parking_sensor_memberships' ? [plan.membershipCutoff] : [])];
  return candidates.reduce((a, b) => (Date.parse(a) >= Date.parse(b) ? a : b));
}

/**
 * One DELETE for one source, table and fetched_at date. The caller binds
 * @sourceId, @day, @latestBatchId (empty when no snapshot is published),
 * @cutoff, @unpublishedCutoff and @membershipCutoff.
 */
export function retentionDeleteSql(config: Pick<DataConfig, 'projectId' | 'ingestDataset'>,
  sourceId: RetainedSourceId, table: RetainedTable): string {
  const path = (name: string) => `\`${config.projectId}.${config.ingestDataset}.${name}\``;
  const unpublished = `NOT EXISTS (SELECT 1 FROM ${path('sync_batches')} b
      WHERE b.source_id = @sourceId AND b.batch_id = t.batch_id
        AND b.state = 'published' AND b.published_at IS NOT NULL)`;
  const scope = `t.source_id = @sourceId AND DATE(t.fetched_at) = DATE(@day)`;
  if (table === 'parking_sensor_memberships') {
    return `DELETE FROM ${path(table)} t
    WHERE ${scope} AND t.fetched_at < TIMESTAMP(@membershipCutoff) AND t.batch_id != @latestBatchId`;
  }
  let expired = 'TRUE';
  if (sourceId === parkingSourceId) {
    const match = table === 'source_records' ? 't.source_record_id = m.business_source_record_id AND t.version_id = m.business_version_id'
      : table === 'geo_record_sources' ? 't.source_record_id = m.business_source_record_id AND t.source_version_id = m.business_version_id'
        : table === 'parking_observations' ? 't.sensor_id = m.sensor_id AND t.version_id = m.business_version_id'
          : 't.geo_record_id = m.business_source_record_id AND t.version_id = m.business_version_id';
    // A stable device can remain unchanged for months. Preserve its exact
    // business version while the latest complete snapshot still references it.
    // The snapshot batch is a constant so the clustered membership read prunes.
    expired = `NOT EXISTS (SELECT 1 FROM ${path('parking_sensor_memberships')} m
        WHERE m.source_id = @sourceId AND m.batch_id = @latestBatchId
          AND m.business_batch_id = t.batch_id AND ${match})${table === 'source_records'
      ? `
      AND (t.batch_id != @latestBatchId OR NOT STARTS_WITH(t.source_record_id, '${parkingSourceId}:snapshot:'))`
      : ''}`;
  }
  return `DELETE FROM ${path(table)} t
    WHERE ${scope} AND (
      (t.fetched_at < TIMESTAMP(@cutoff) AND ${expired})
      OR (t.fetched_at < TIMESTAMP(@unpublishedCutoff) AND ${unpublished}))`;
}

const partitionRows = z.array(z.object({ partition_id: z.string().regex(/^\d{8}$/) }));
const latestRows = z.array(z.object({ batch_id: z.string().min(1) })).max(1);

export async function cleanupSourceContent(
  config: DataConfig,
  bigquery: Pick<BigQuery, 'query'>,
  gcs: Pick<GcsStore, 'cleanupSourceExpired'>,
  sourceId: string,
  now = new Date(),
): Promise<{ sourceId: string; tablesChecked: number; partitionsChecked: number; deletedObjects: number }> {
  const plan = sourceRetentionPlan(sourceId, now);
  if (!config.maxBytesBilled) throw new Error('Retention requires a BigQuery query ceiling');
  const maximumBytesBilled = config.maxBytesBilled;
  const query = async (sql: string, params: Record<string, string>) => {
    const [rows] = await bigquery.query({ query: sql, params, location: config.region, maximumBytesBilled });
    return rows as unknown;
  };
  const path = (table: string) => `\`${config.projectId}.${config.ingestDataset}.${table}\``;
  // Resolved once, before any delete, so every delete compares against a
  // constant. The source lease held by the caller keeps it current throughout.
  const latestBatchId = plan.sourceId !== parkingSourceId ? '' : latestRows.parse(await query(
    `/* retention-latest-parking-snapshot */
    SELECT batch_id FROM ${path('sync_batches')}
    WHERE source_id = @sourceId
    QUALIFY ROW_NUMBER() OVER (PARTITION BY batch_id ORDER BY state_updated_at DESC) = 1
      AND state = 'published' AND published_at IS NOT NULL
    ORDER BY started_at DESC LIMIT 1`, { sourceId: plan.sourceId }))[0]?.batch_id ?? '';
  const failures: string[] = [];
  let partitionsChecked = 0;
  for (const table of plan.tables) {
    const lastDay = latestCutoff(plan, table).slice(0, 10).replaceAll('-', '');
    let days: string[];
    try {
      // Partition metadata is free to read and lets each delete scan one day,
      // so a backlog is worked through instead of exceeding the billed-byte ceiling.
      days = partitionRows.parse(await query(`/* retention-partitions:${table} */
        SELECT partition_id FROM ${path('INFORMATION_SCHEMA.PARTITIONS')}
        WHERE table_name = @table AND REGEXP_CONTAINS(partition_id, r'^[0-9]{8}$')
          AND partition_id <= @lastDay AND (total_rows IS NULL OR total_rows > 0)
        ORDER BY partition_id`, { table, lastDay })).map(row =>
        `${row.partition_id.slice(0, 4)}-${row.partition_id.slice(4, 6)}-${row.partition_id.slice(6)}`);
    } catch (error) {
      failures.push(`${table}: ${error instanceof Error ? error.message : 'partition listing failed'}`);
      continue;
    }
    const sql = retentionDeleteSql(config, plan.sourceId, table);
    for (const day of days) {
      partitionsChecked += 1;
      try {
        await query(`/* retention:${table} */ ${sql}`, { sourceId: plan.sourceId, day, latestBatchId,
          cutoff: plan.cutoff, unpublishedCutoff: plan.unpublishedCutoff,
          membershipCutoff: plan.membershipCutoff });
      } catch (error) {
        // One oversized or contended day must not stop the remaining cleanup.
        failures.push(`${table} ${day}: ${error instanceof Error ? error.message : 'delete failed'}`);
      }
    }
  }
  const deletedObjects = await gcs.cleanupSourceExpired(plan.sourceId, now, 1000,
    SOURCE_RETENTION[plan.sourceId].cleanupAgeSeconds);
  if (failures.length) {
    throw new Error(`Source retention incomplete for ${plan.sourceId}: ${failures.join('; ')}`);
  }
  return { sourceId: plan.sourceId, tablesChecked: plan.tables.length, partitionsChecked, deletedObjects };
}
