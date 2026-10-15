import assert from 'node:assert/strict';
import test from 'node:test';

import type { DataConfig } from '../../src/core/config.js';
import { cleanupSourceContent, retentionDeleteSql, sourceRetentionPlan } from '../../src/core/source-retention.js';

const config: DataConfig = { projectId: 'melens-test', region: 'australia-southeast2',
  ingestDataset: 'melens_ingest', queryDataset: 'melens_query', bucketName: 'bucket',
  maxBytesBilled: '500000000', secretNames: [] };
const now = new Date('2026-10-15T06:00:00.000Z');

type Call = { query: string; params: Record<string, string>; maximumBytesBilled: string };

function fakeBigQuery(partitions: readonly string[], fail: (call: Call) => boolean = () => false) {
  const calls: Call[] = [];
  return { calls, bigquery: { query: async (options: Call) => {
    calls.push(options);
    if (fail(options)) throw new Error('Query exceeded limit for bytes billed: 500000000');
    if (options.query.includes('retention-latest-parking-snapshot')) return [[{ batch_id: 'batch_latest' }]];
    if (options.query.includes('INFORMATION_SCHEMA.PARTITIONS')) {
      return [partitions.filter(id => id <= (options.params.lastDay ?? '')).map(partition_id => ({ partition_id }))];
    }
    return [[]];
  } } };
}

const gcs = { cleanupSourceExpired: async () => 0 };

test('parking retention deletes one day at a time against a constant latest snapshot', async () => {
  const { calls, bigquery } = fakeBigQuery(['20261001', '20261002', '20261015']);
  const result = await cleanupSourceContent(config, bigquery as never, gcs, 'melbourne.parking.sensors', now);
  const deletes = calls.filter(call => call.query.includes('DELETE FROM'));
  assert.equal(result.partitionsChecked, deletes.length);
  // Five tables over three days; today's partition holds superseded memberships and failed batches.
  assert.equal(deletes.length, 15);
  for (const call of deletes) {
    assert.equal(call.params.latestBatchId, 'batch_latest');
    assert.equal(call.maximumBytesBilled, '500000000');
    assert.match(call.query, /DATE\(t\.fetched_at\) = DATE\(@day\)/);
    assert.doesNotMatch(call.query, /ORDER BY started_at DESC LIMIT 1\)/,
      'A per-row latest-snapshot subquery prevents block pruning');
  }
  assert.deepEqual([...new Set(deletes.map(call => call.params.day))], ['2026-10-01', '2026-10-02', '2026-10-15']);
  assert.equal(deletes[0]?.query.includes('parking_sensor_memberships'), true,
    'The largest table is cleaned first');
});

test('a failing day does not stop the remaining cleanup and is reported', async () => {
  const { calls, bigquery } = fakeBigQuery(['20261001', '20261002'],
    call => call.query.includes('DELETE') && call.params.day === '2026-10-01'
      && call.query.includes('parking_sensor_memberships'));
  await assert.rejects(cleanupSourceContent(config, bigquery as never, gcs, 'melbourne.parking.sensors', now),
    /parking_sensor_memberships 2026-10-01: Query exceeded limit/);
  assert.equal(calls.filter(call => call.query.includes('DELETE FROM')).length, 10);
});

test('rows of batches that never published are removed after two hours for every retained source', () => {
  const plan = sourceRetentionPlan('ticketmaster.events', now);
  assert.equal(plan.unpublishedCutoff, '2026-10-15T04:00:00.000Z');
  assert.equal(sourceRetentionPlan('melbourne.parking.sensors', now).membershipCutoff, '2026-10-15T05:00:00.000Z');
  for (const table of plan.tables) {
    const sql = retentionDeleteSql(config, 'ticketmaster.events', table);
    assert.match(sql, /fetched_at < TIMESTAMP\(@unpublishedCutoff\)/);
    assert.match(sql, /b\.state = 'published'/);
  }
  const membership = retentionDeleteSql(config, 'melbourne.parking.sensors', 'parking_sensor_memberships');
  assert.match(membership, /t\.batch_id != @latestBatchId/);
  assert.match(membership, /@membershipCutoff/);
});

test('retention still requires a billed-byte ceiling and a known source', async () => {
  const { bigquery } = fakeBigQuery([]);
  await assert.rejects(cleanupSourceContent({ ...config, maxBytesBilled: null }, bigquery as never, gcs,
    'melbourne.parking.sensors', now), /query ceiling/);
  await assert.rejects(cleanupSourceContent(config, bigquery as never, gcs, 'unknown.source', now));
});
