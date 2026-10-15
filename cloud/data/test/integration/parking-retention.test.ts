import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { BigQuery } from '@google-cloud/bigquery';
import { Storage } from '@google-cloud/storage';
import { z } from 'zod';

import { ParkingSensorsConnector, SOURCE_ID } from '../../src/connectors/com_parking_sensors/index.js';
import type { DataConfig } from '../../src/core/config.js';
import { parseConnectorInput, type ConnectorSuccess } from '../../src/core/connector.js';
import { GcsStore } from '../../src/core/gcs.js';
import { OpenDataSoftClient, type OdsRecords } from '../../src/core/opendatasoft.js';
import { cleanupSourceContent } from '../../src/core/source-retention.js';
import { assembleParkingRuntime, withPublishedParkingState,
  type ParkingRuntimeHistoryEntry } from '../../src/normalization/parking-runtime.js';

async function readSql(name: string): Promise<string> {
  try { return await readFile(new URL(`../../../sql/${name}`, import.meta.url), 'utf8'); }
  catch { return readFile(new URL(`../../sql/${name}`, import.meta.url), 'utf8'); }
}

class SnapshotClient extends OpenDataSoftClient {
  constructor(private readonly snapshot: OdsRecords) { super(); }
  override async fetchRecords(): Promise<OdsRecords> { return this.snapshot; }
}

async function collect(records: unknown[], fetchedAt: string, runId: string): Promise<ConnectorSuccess> {
  const result = await new ParkingSensorsConnector(new SnapshotClient({ records,
    totalCount: records.length, pageCount: 1, fetchedAt, lastModified: null }))
    .collect(parseConnectorInput({ sourceId: SOURCE_ID, runId,
      window: { kind: 'snapshot', revision: fetchedAt }, checkpoint: null }));
  assert.equal(result.kind, 'success', 'Synthetic complete collection must use the actual parking connector');
  if (result.kind !== 'success') throw new Error('Parking retention fixture collection failed');
  return result;
}

function history(result: ReturnType<typeof assembleParkingRuntime>): ParkingRuntimeHistoryEntry[] {
  return result.parkingSensorMemberships.map(member => ({ sensor_id: member.sensor_id,
    business_source_record_id: member.business_source_record_id,
    business_state_hash: member.business_state_hash,
    business_version_id: member.business_version_id, business_batch_id: member.business_batch_id }));
}

const project = process.env.MELENS_PUBLISH_TEST_PROJECT;
const rowsSchema = z.array(z.record(z.string(), z.unknown()));
const countSchema = z.array(z.object({ table_name: z.string(), n: z.number().int().nonnegative() }));
const tables = ['source_records', 'geo_records', 'geo_record_sources',
  'parking_observations', 'parking_sensor_memberships'];

test('GCP parking retention protects old latest references, restores runtime and removes superseded empty-snapshot content', {
  skip: !project || process.env.MELENS_PUBLISH_TEST_ALLOW_CREATE !== '1'
    ? 'requires MELENS_PUBLISH_TEST_PROJECT and MELENS_PUBLISH_TEST_ALLOW_CREATE=1' : false,
  timeout: 600_000,
}, async t => {
  assert.ok(project);
  z.string().regex(/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/).parse(project);
  const id = randomUUID().replaceAll('-', '').slice(0, 16);
  const maximumBytesBilled = '500000000';
  const config: DataConfig = {
    projectId: project, region: 'australia-southeast2',
    ingestDataset: `parking_retention_${id}`, queryDataset: `parking_retention_views_${id}`,
    bucketName: `melens-parking-retention-${id}`, maxBytesBilled: maximumBytesBilled, secretNames: [],
  };
  const bigquery = new BigQuery({ projectId: config.projectId, location: config.region });
  const storage = new Storage({ projectId: config.projectId });
  const gcs = new GcsStore(storage, config.bucketName);
  const createdDatasets: string[] = [];
  let createdBucket = false;
  let queryJobs = 0;
  const query = async (sql: string, params: Record<string, string> = {}) => {
    queryJobs += 1;
    try {
      const [rows] = await bigquery.query({ query: sql, params,
        location: config.region, maximumBytesBilled });
      return rowsSchema.parse(rows);
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : 'BigQuery parking retention fixture failed');
    }
  };
  const table = (name: string) => `\`${config.projectId}.${config.ingestDataset}.${name}\``;
  const view = (name: string) => `\`${config.projectId}.${config.queryDataset}.${name}\``;
  const qualify = (sql: string) => sql
    .replaceAll('`melens_ingest.', `\`${config.projectId}.${config.ingestDataset}.`)
    .replaceAll('`melens_query.', `\`${config.projectId}.${config.queryDataset}.`);
  const now = new Date();
  const ago = (hours: number) => new Date(now.getTime() - hours * 3_600_000).toISOString();
  const row = { kerbsideid: 42, lastupdated: ago(96), status_timestamp: ago(120),
    status_description: 'Unoccupied', zone_number: 7, location: { lat: -37.81, lon: 144.96 } };
  const first = assembleParkingRuntime({ result: await collect([row], ago(96), 'business-old'),
    history: [], licenseStatus: 'verified_open' });
  const latest = assembleParkingRuntime({ result: await collect([{ ...row, lastupdated: ago(72) }],
    ago(72), 'snapshot-latest'), history: history(first), licenseStatus: 'verified_open' });
  const unused = assembleParkingRuntime({ result: await collect([{ ...row, kerbsideid: 99,
    lastupdated: ago(120), status_timestamp: ago(144) }], ago(120), 'unused-old'),
    history: [], licenseStatus: 'verified_open' });
  assert.equal(latest.geoRecords.length, 0, 'A heartbeat snapshot must reference the earlier business generation');

  // Values come from the production connector/runtime; only this fixture's
  // SQL insertion seam differs from the publisher's Storage Write API.
  const insert = (name: string, rows: readonly unknown[],
    columns: readonly (readonly [string, 'STRING' | 'TIMESTAMP' | 'INT64' | 'FLOAT64' | 'BOOL' | 'STRINGS'])[]) => {
    if (rows.length === 0) return '';
    const values = columns.map(([column, kind]) => {
      const scalar = `JSON_VALUE(item, '$.${column}')`;
      return kind === 'STRING' ? scalar : kind === 'TIMESTAMP' ? `TIMESTAMP(${scalar})`
        : kind === 'STRINGS' ? `ARRAY(SELECT JSON_VALUE(value) FROM UNNEST(JSON_QUERY_ARRAY(item, '$.${column}')) value)`
          : `CAST(${scalar} AS ${kind})`;
    });
    return `INSERT INTO ${table(name)} (${columns.map(([column]) => column).join(', ')})
      SELECT ${values.join(', ')} FROM UNNEST(JSON_QUERY_ARRAY(@${name})) item;`;
  };
  const persist = async (results: readonly ReturnType<typeof assembleParkingRuntime>[]) => {
    const provenance: readonly (readonly [string, 'STRING' | 'TIMESTAMP' | 'INT64'])[] = [
      ['batch_id', 'STRING'], ['source_id', 'STRING'], ['schema_version', 'INT64'], ['fetched_at', 'TIMESTAMP'],
    ];
    const sourceRecords = results.flatMap(result => result.sourceRecords);
    const geoRecords = results.flatMap(result => result.geoRecords);
    const links = results.flatMap(result => result.geoRecordSources);
    const observations = results.flatMap(result => result.parkingObservations);
    const members = results.flatMap(result => result.parkingSensorMemberships);
    await query(`INSERT INTO ${table('sync_batches')}
      (batch_id, source_id, started_at, state, state_updated_at, published_at,
       source_revision, input_count, output_count, schema_version)
      SELECT JSON_VALUE(item, '$.runId'), @source,
        TIMESTAMP(JSON_VALUE(item, '$.fetchedAt')), 'published', TIMESTAMP(@now), TIMESTAMP(@now),
        JSON_VALUE(item, '$.sourceRevision'), CAST(JSON_VALUE(item, '$.inputCount') AS INT64),
        CAST(JSON_VALUE(item, '$.outputCount') AS INT64), 1
      FROM UNNEST(JSON_QUERY_ARRAY(@batches)) item;
      ${insert('source_records', sourceRecords, [...provenance, ['source_record_id', 'STRING'],
        ['version_id', 'STRING'], ['source_updated_at', 'TIMESTAMP'], ['observed_at', 'TIMESTAMP'],
        ['original_url', 'STRING'], ['record_status', 'STRING'], ['assertion_kind', 'STRING'], ['rights_status', 'STRING']])}
      ${insert('geo_records', geoRecords, [...provenance, ['geo_record_id', 'STRING'],
        ['version_id', 'STRING'], ['source_updated_at', 'TIMESTAMP'], ['observed_at', 'TIMESTAMP'],
        ['topic', 'STRING'], ['assertion_kind', 'STRING'], ['title', 'STRING'], ['summary', 'STRING'],
        ['original_url', 'STRING'], ['geometry_geojson', 'STRING'], ['centroid_lat', 'FLOAT64'],
        ['centroid_lon', 'FLOAT64'], ['location_role', 'STRING'], ['location_confidence', 'STRING'],
        ['area_refs', 'STRINGS'], ['freshness_state', 'STRING'], ['record_status', 'STRING'],
        ['rights_status', 'STRING'], ['public_query_allowed', 'BOOL']])}
      ${insert('geo_record_sources', links, [...provenance, ['geo_record_id', 'STRING'], ['version_id', 'STRING'],
        ['source_record_id', 'STRING'], ['source_version_id', 'STRING'], ['evidence_role', 'STRING'], ['original_url', 'STRING']])}
      ${insert('parking_observations', observations, [...provenance, ['sensor_id', 'STRING'], ['version_id', 'STRING'],
        ['source_record_id', 'STRING'], ['observed_at', 'TIMESTAMP'], ['occupied', 'BOOL'],
        ['marker_id', 'STRING'], ['bay_id', 'STRING']])}
      ${insert('parking_sensor_memberships', members, [...provenance, ['sensor_id', 'STRING'], ['version_id', 'STRING'],
        ['business_source_record_id', 'STRING'], ['business_state_hash', 'STRING'],
        ['business_version_id', 'STRING'], ['business_batch_id', 'STRING'],
        ['source_updated_at', 'TIMESTAMP'], ['snapshot_source_record_id', 'STRING'], ['snapshot_version_id', 'STRING']])}`,
    { source: SOURCE_ID, now: now.toISOString(), batches: JSON.stringify(results.map(result => ({
      runId: result.runId, fetchedAt: result.fetchedAt, sourceRevision: result.sourceRevision,
      inputCount: result.inputCount, outputCount: result.outputCount }))),
    source_records: JSON.stringify(sourceRecords), geo_records: JSON.stringify(geoRecords),
    geo_record_sources: JSON.stringify(links), parking_observations: JSON.stringify(observations),
    parking_sensor_memberships: JSON.stringify(members) });
  };
  const counts = async () => countSchema.parse(await query(tables.map(name =>
    `SELECT '${name}' AS table_name, COUNT(*) AS n FROM ${table(name)} WHERE source_id = @source`)
    .join(' UNION ALL '), { source: SOURCE_ID }));
  const expectCounts = (actual: z.infer<typeof countSchema>, expected: readonly number[]) => {
    assert.equal(actual.length, tables.length);
    tables.forEach((name, index) => assert.equal(actual.find(value => value.table_name === name)?.n,
      expected[index], `${name} must retain only the expected exact current references`));
  };

  try {
    for (const dataset of [config.ingestDataset, config.queryDataset]) {
      await bigquery.createDataset(dataset, { location: config.region, defaultTableExpirationMs: '86400000' });
      createdDatasets.push(dataset);
    }
    await storage.createBucket(config.bucketName, { location: config.region,
      iamConfiguration: { uniformBucketLevelAccess: { enabled: true } },
      softDeletePolicy: { retentionDurationSeconds: 0 } });
    createdBucket = true;
    for (const file of ['001_tables.sql', '003_parking_views.sql']) await query(qualify(await readSql(file)));
    await query(`INSERT INTO ${table('data_sources')}
      (source_id, provider, dataset_title, landing_url, topic, scope, record_granularity,
       license_status, access_status, cadence_seconds, check_interval_seconds, last_success_at, updated_at)
      VALUES (@source, 'fixture', 'Synthetic parking retention fixture', 'https://example.org/',
        'parking', 'city_of_melbourne', 'sensor', 'verified_open', 'active', 120, 120,
        TIMESTAMP(@checked), TIMESTAMP(@now))`,
    { source: SOURCE_ID, checked: ago(72), now: now.toISOString() });
    await persist([unused, first, latest]);
    expectCounts(await counts(), [5, 2, 2, 2, 3]);

    await t.test('72-hour latest membership protects exact 96-hour business facts while unused old content is deleted', async () => {
      queryJobs += 1;
      const cleaned = await cleanupSourceContent(config, bigquery, gcs, SOURCE_ID, now);
      assert.equal(cleaned.tablesChecked, 5);
      assert.equal(cleaned.deletedObjects, 0);
      expectCounts(await counts(), [2, 1, 1, 1, 1]);
      // The map no longer reads this history: v_parking_sensor_current serves only the latest
      // snapshot table (see parking-sensor-current-view.test.ts). Retention still has to keep
      // the exact references the ingest recovery restores.
      const proof = await query(`SELECT source_record_id, version_id FROM ${table('source_records')}
        WHERE batch_id = 'snapshot-latest'`);
      assert.deepEqual(proof, [{ source_record_id: latest.sourceRecords[0]?.source_record_id,
        version_id: latest.sourceRecords[0]?.version_id }]);
      t.diagnostic(JSON.stringify({ protected_latest_membership_age_hours: 72,
        protected_business_age_hours: 96, protected_fact_rows: 6, unreferenced_old_rows_deleted: 8 }));
    });

    await t.test('fresh processes restore the same old published version while the public source is active or hidden', async () => {
      const fresh = await collect([{ ...row, lastupdated: now.toISOString() }], now.toISOString(), 'restart');
      queryJobs += 2;
      const restored = await withPublishedParkingState(fresh, config, bigquery);
      assert.equal(restored.geoRecords.length, 0);
      assert.equal(restored.geoRecordSources.length, 0);
      assert.equal(restored.parkingObservations.length, 0);
      assert.equal(restored.sourceRecords.length, 1, 'Unchanged restart adds only the next complete proof');
      assert.equal(restored.parkingSensorMemberships?.[0]?.business_batch_id, 'business-old');
      assert.equal(restored.parkingSensorMemberships?.[0]?.business_version_id,
        first.parkingSensorMemberships[0]?.business_version_id);
      await query(`UPDATE ${table('data_sources')} SET access_status = 'candidate' WHERE source_id = @source`,
        { source: SOURCE_ID });
      queryJobs += 2;
      const privateRestore = await withPublishedParkingState(fresh, config, bigquery);
      assert.equal(privateRestore.geoRecords.length, 0);
      assert.equal(privateRestore.parkingSensorMemberships?.[0]?.business_version_id,
        first.parkingSensorMemberships[0]?.business_version_id);
      await query(`UPDATE ${table('data_sources')} SET access_status = 'active' WHERE source_id = @source`,
        { source: SOURCE_ID });
    });

    await t.test('a newer empty snapshot removes all expired previous members and businesses but preserves its old proof', async () => {
      const empty = assembleParkingRuntime({ result: await collect([], ago(60), 'snapshot-empty'),
        history: history(first), licenseStatus: 'verified_open' });
      await persist([empty]);
      queryJobs += 1;
      await cleanupSourceContent(config, bigquery, gcs, SOURCE_ID, now);
      expectCounts(await counts(), [1, 0, 0, 0, 0]);
      const remaining = await query(`SELECT source_record_id, version_id, batch_id FROM ${table('source_records')}`);
      assert.deepEqual(remaining, [{ source_record_id: empty.sourceRecords[0]?.source_record_id,
        version_id: empty.sourceRecords[0]?.version_id, batch_id: 'snapshot-empty' }]);
      queryJobs += 2;
      const reappeared = await withPublishedParkingState(await collect([{ ...row, lastupdated: now.toISOString() }],
        now.toISOString(), 'restart-after-empty'), config, bigquery);
      assert.equal(reappeared.geoRecords.length, 1, 'A genuinely reappearing sensor needs newly published business facts');
      assert.equal(reappeared.parkingSensorMemberships?.[0]?.business_batch_id, 'restart-after-empty');
      t.diagnostic(JSON.stringify({ latest_empty_proof_age_hours: 60,
        empty_proof_rows_preserved: 1, previous_member_and_business_rows_deleted: 6,
        runtime_did_not_revive_empty_snapshot_membership: true }));
    });
    t.diagnostic(JSON.stringify({ query_jobs_with_500mb_cap: queryJobs }));
  } catch (error) {
    const code = typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'number' ? error.code : 'unknown';
    throw new Error(`GCP parking retention fixture failed (code ${code})`);
  } finally {
    const cleanup = await Promise.allSettled([
      ...createdDatasets.map(dataset => bigquery.dataset(dataset).delete({ force: true })),
      ...(createdBucket ? [(async () => {
        const bucket = storage.bucket(config.bucketName);
        await bucket.deleteFiles({ force: true }); await bucket.delete();
      })()] : []),
    ]);
    assert.equal(cleanup.filter(result => result.status === 'rejected').length, 0,
      'All uniquely owned parking retention fixture resources must be removed');
  }
});
