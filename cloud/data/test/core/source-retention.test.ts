import assert from 'node:assert/strict';
import test from 'node:test';

import type { BigQuery } from '@google-cloud/bigquery';

import type { DataConfig } from '../../src/core/config.js';
import { cleanupSourceContent, PARKING_MEMBERSHIP_RETENTION_SECONDS, SOURCE_RETENTION,
} from '../../src/core/source-retention.js';

const SENSORS = 'melbourne.parking.sensors';
const now = new Date('2026-10-15T09:00:00.000Z');
const config: DataConfig = { projectId: 'melens-fixture', region: 'australia-southeast2',
  bucketName: 'fixture', ingestDataset: 'melens_ingest', queryDataset: 'melens_query',
  maxBytesBilled: '500000000', secretNames: [] };

type Call = { query: string; params: Record<string, string>; location: string; maximumBytesBilled: string };
const tableOf = (call: Call) => /DELETE FROM `[^`]*\.([a-z_]+)` t/.exec(call.query)?.[1];

function fixture(failTable?: string) {
  const calls: Call[] = [];
  let gcsCleanups = 0;
  const bigquery = { async query(options: Call) {
    calls.push(options);
    if (failTable && tableOf(options) === failTable) {
      throw new Error('Query exceeded limit for bytes billed: 500000000. 506462208 or higher required.');
    }
    return [[]] as never;
  } };
  const gcs = { async cleanupSourceExpired() { gcsCleanups += 1; return 0; } };
  // The runtime only reads query(); the SDK's overloads are not worth reproducing here.
  return { calls, bigquery: bigquery as unknown as Pick<BigQuery, 'query'>, gcs, cleanups: () => gcsCleanups };
}

test('sensor cleanup runs one query per table, memberships first, each with its own byte ceiling', async () => {
  const { calls, bigquery, gcs } = fixture();
  const result = await cleanupSourceContent(config, bigquery, gcs, SENSORS, now);
  assert.equal(result.tablesChecked, 5);
  assert.deepEqual(calls.map(tableOf), ['parking_sensor_memberships', 'source_records', 'geo_records',
    'geo_record_sources', 'parking_observations']);
  for (const call of calls) {
    assert.equal(call.maximumBytesBilled, '500000000');
    assert.equal(call.location, 'australia-southeast2');
    assert.equal((call.query.match(/DELETE FROM/g) ?? []).length, 1, 'A script would share one billed-byte ceiling');
    assert.doesNotMatch(call.query, /;\s*$/);
  }
});

test('only the latest sensor snapshot is kept for an hour, other tables keep their two-day window', async () => {
  const { calls, bigquery, gcs } = fixture();
  await cleanupSourceContent(config, bigquery, gcs, SENSORS, now);
  const hourAgo = new Date(now.getTime() - PARKING_MEMBERSHIP_RETENTION_SECONDS * 1000).toISOString();
  const twoDaysAgo = new Date(now.getTime() - SOURCE_RETENTION[SENSORS].cleanupAgeSeconds * 1000).toISOString();
  assert.equal(PARKING_MEMBERSHIP_RETENTION_SECONDS, 3_600);
  const membership = calls.find(call => tableOf(call) === 'parking_sensor_memberships');
  assert.ok(membership);
  assert.ok(membership.query.includes(`TIMESTAMP('${hourAgo}')`));
  assert.match(membership.query, /t\.batch_id != /, 'The latest published snapshot must never be removed');
  for (const call of calls.filter(call => tableOf(call) !== 'parking_sensor_memberships')) {
    assert.ok(call.query.includes(`TIMESTAMP('${twoDaysAgo}')`), `${tableOf(call)} keeps the two-day window`);
  }
});

test('one table failing does not stop the others, and the failure is still reported', async () => {
  const { calls, bigquery, gcs, cleanups } = fixture('geo_records');
  await assert.rejects(cleanupSourceContent(config, bigquery, gcs, SENSORS, now),
    /geo_records: Query exceeded limit for bytes billed/);
  assert.equal(calls.length, 5, 'Every table is still attempted after the failure');
  assert.equal(cleanups(), 1, 'Expired raw files are still cleaned');
});

test('a failure message names only the failing tables', async () => {
  const { bigquery, gcs } = fixture('source_records');
  await assert.rejects(cleanupSourceContent(config, bigquery, gcs, SENSORS, now), (error: Error) => {
    assert.match(error.message, /1 of 5 tables/);
    assert.match(error.message, /source_records/);
    assert.doesNotMatch(error.message, /parking_sensor_memberships:|geo_record_sources:/);
    return true;
  });
});

test('retention still requires a billed-byte ceiling and a known source', async () => {
  const { bigquery, gcs } = fixture();
  await assert.rejects(cleanupSourceContent({ ...config, maxBytesBilled: null }, bigquery, gcs, SENSORS, now),
    /query ceiling/);
  await assert.rejects(cleanupSourceContent(config, bigquery, gcs, 'unknown.source', now));
});
