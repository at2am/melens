import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

import { BigQuery } from '@google-cloud/bigquery';
import { Storage } from '@google-cloud/storage';
import { z } from 'zod';

import type { DataConfig } from '../../src/core/config.js';
import { GcsStore } from '../../src/core/gcs.js';
import { cleanupSourceContent } from '../../src/core/source-retention.js';

async function readSql(name: string): Promise<string> {
  try { return await readFile(new URL(`../../../sql/${name}`, import.meta.url), 'utf8'); }
  catch { return readFile(new URL(`../../sql/${name}`, import.meta.url), 'utf8'); }
}

const devProject = process.env.MELENS_PUBLISH_TEST_PROJECT;
const rowsSchema = z.array(z.record(z.string(), z.unknown()));
const countsSchema = z.array(z.object({ table_name: z.string(), source_id: z.string(),
  old_count: z.number(), total_count: z.number() }));

test('GCP retention: real views expire cached references and physical cleanup removes positive fixtures', {
  skip: !devProject || process.env.MELENS_PUBLISH_TEST_ALLOW_CREATE !== '1'
    ? 'requires MELENS_PUBLISH_TEST_PROJECT and MELENS_PUBLISH_TEST_ALLOW_CREATE=1' : false,
  timeout: 600_000,
}, async t => {
  assert.ok(devProject);
  z.string().regex(/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/).parse(devProject);
  const id = randomUUID().replaceAll('-', '').slice(0, 16);
  const maximumBytesBilled = '500000000';
  const config: DataConfig = {
    projectId: devProject, region: 'australia-southeast2',
    ingestDataset: `news_retention_${id}`, queryDataset: `news_retention_views_${id}`,
    bucketName: `melens-news-retention-${id}`, maxBytesBilled: maximumBytesBilled, secretNames: [],
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
      // Do not print SDK requests, authentication headers or nested causes.
      throw new Error(error instanceof Error ? error.message : 'BigQuery retention fixture failed');
    }
  };
  const table = (name: string) => `\`${config.projectId}.${config.ingestDataset}.${name}\``;
  const view = (name: string) => `\`${config.projectId}.${config.queryDataset}.${name}\``;
  const qualify = (sql: string) => sql
    .replaceAll('`melens_ingest.', `\`${config.projectId}.${config.ingestDataset}.`)
    .replaceAll('`melens_query.', `\`${config.projectId}.${config.queryDataset}.`);
  const now = new Date();
  const ago = (hours: number) => new Date(now.getTime() - hours * 3_600_000).toISOString();

  const fixture = [
    { source: 'ticketmaster.events', batch: 'tm-expired', record: 'expired-event', version: 'expired', topic: 'event', geoAge: 25, sourceAge: 25, linkAge: 25 },
    { source: 'ticketmaster.events', batch: 'tm-expired', record: 'expired-news', version: 'expired', topic: 'news', geoAge: 25, sourceAge: 25, linkAge: 25 },
    { source: 'ticketmaster.events', batch: 'tm-old', record: 'event', version: 'z-older', topic: 'event', geoAge: 3, sourceAge: 3, linkAge: 3 },
    { source: 'ticketmaster.events', batch: 'tm-old', record: 'news', version: 'z-older', topic: 'news', geoAge: 3, sourceAge: 3, linkAge: 3 },
    { source: 'ticketmaster.events', batch: 'tm-old', record: 'disappeared', version: 'older', topic: 'event', geoAge: 3, sourceAge: 3, linkAge: 3 },
    { source: 'ticketmaster.events', batch: 'tm-latest', record: 'event', version: 'a-newer', topic: 'event', geoAge: 2, sourceAge: 2, linkAge: 2 },
    { source: 'ticketmaster.events', batch: 'tm-latest', record: 'news', version: 'a-newer', topic: 'news', geoAge: 2, sourceAge: 2, linkAge: 2 },
    { source: 'ticketmaster.events', batch: 'tm-latest', record: 'fresh-reference', version: 'fresh', topic: 'news', geoAge: 2, sourceAge: 2, linkAge: 2 },
    { source: 'ticketmaster.events', batch: 'tm-latest', record: 'expired-source-reference', version: 'fresh', topic: 'news', geoAge: 2, sourceAge: 25, linkAge: 2 },
    { source: 'ticketmaster.events', batch: 'tm-latest', record: 'expired-link-reference', version: 'fresh', topic: 'news', geoAge: 2, sourceAge: 2, linkAge: 25 },
    { source: 'ticketmaster.events', batch: 'tm-cleanup-old', record: 'cleanup-positive', version: 'old', topic: 'news', geoAge: 19, sourceAge: 19, linkAge: 19 },
    { source: 'gdelt.news', batch: 'gdelt-other', record: 'other-source-news', version: 'untouched', topic: 'news', geoAge: 35, sourceAge: 35, linkAge: 35 },
  ];
  const batches = [
    { source: 'ticketmaster.events', id: 'tm-expired', age: 25 },
    { source: 'ticketmaster.events', id: 'tm-old', age: 3 },
    { source: 'ticketmaster.events', id: 'tm-latest', age: 2 },
    { source: 'ticketmaster.events', id: 'tm-cleanup-old', age: 19 },
    { source: 'gdelt.news', id: 'gdelt-other', age: 35 },
  ];
  const contentCounts = async () => countsSchema.parse(await query([
    'source_records', 'geo_records', 'geo_record_sources',
  ].map(name => `SELECT '${name}' AS table_name, source_id,
      COUNTIF(fetched_at < TIMESTAMP_SUB(TIMESTAMP(@now), INTERVAL 18 HOUR)) AS old_count,
      COUNT(*) AS total_count FROM ${table(name)} GROUP BY source_id`).join(' UNION ALL '),
  { now: now.toISOString() }));

  try {
    for (const dataset of [config.ingestDataset, config.queryDataset]) {
      await bigquery.createDataset(dataset, { location: config.region, defaultTableExpirationMs: '86400000' });
      createdDatasets.push(dataset);
    }
    await storage.createBucket(config.bucketName, {
      location: config.region,
      iamConfiguration: { uniformBucketLevelAccess: { enabled: true } },
      softDeletePolicy: { retentionDurationSeconds: 0 },
    });
    createdBucket = true;
    for (const file of ['001_tables.sql', '002_core_views.sql', '005_news_views.sql', '007_changes_views.sql']) {
      await query(qualify(await readSql(file)));
    }
    await query(`
      INSERT INTO ${table('data_sources')}
        (source_id, provider, dataset_title, landing_url, topic, scope,
         record_granularity, license_status, access_status, updated_at)
      VALUES ('ticketmaster.events', 'fixture', 'retention fixture', 'https://example.org/',
        'event', 'greater_melbourne', 'event', 'restricted', 'active', TIMESTAMP(@now)),
        ('gdelt.news', 'fixture', 'retention fixture', 'https://example.org/',
        'news', 'global', 'article', 'verified_open', 'active', TIMESTAMP(@now));

      INSERT INTO ${table('sync_batches')}
        (batch_id, source_id, started_at, state, state_updated_at, published_at, schema_version)
      SELECT JSON_VALUE(item, '$.id'), JSON_VALUE(item, '$.source'),
        TIMESTAMP_SUB(TIMESTAMP(@now), INTERVAL CAST(JSON_VALUE(item, '$.age') AS INT64) HOUR),
        'published', TIMESTAMP(@now), TIMESTAMP(@now), 1
      FROM UNNEST(JSON_QUERY_ARRAY(@batches)) item;

      CREATE TEMP TABLE fixture AS
      SELECT JSON_VALUE(item, '$.record') AS record, JSON_VALUE(item, '$.version') AS version,
        JSON_VALUE(item, '$.batch') AS batch, JSON_VALUE(item, '$.source') AS source,
        JSON_VALUE(item, '$.topic') AS topic,
        TIMESTAMP_SUB(TIMESTAMP(@now), INTERVAL CAST(JSON_VALUE(item, '$.geoAge') AS INT64) HOUR) AS geo_time,
        TIMESTAMP_SUB(TIMESTAMP(@now), INTERVAL CAST(JSON_VALUE(item, '$.sourceAge') AS INT64) HOUR) AS source_time,
        TIMESTAMP_SUB(TIMESTAMP(@now), INTERVAL CAST(JSON_VALUE(item, '$.linkAge') AS INT64) HOUR) AS link_time
      FROM UNNEST(JSON_QUERY_ARRAY(@fixture)) item;

      INSERT INTO ${table('source_records')}
        (source_record_id, version_id, batch_id, source_id, schema_version, fetched_at,
         original_url, record_status, assertion_kind, rights_status)
      SELECT CONCAT('source-', record), version, batch, source, 1, source_time,
        CONCAT('https://example.org/', record), 'active', 'report',
        IF(source = 'ticketmaster.events', 'restricted', 'verified_open') FROM fixture;

      INSERT INTO ${table('geo_records')}
        (geo_record_id, version_id, batch_id, source_id, schema_version, fetched_at,
         topic, assertion_kind, title, summary, original_url, location_role,
         location_confidence, area_refs, freshness_state, record_status, rights_status, public_query_allowed)
      SELECT record, version, batch, source, 1, geo_time, topic, 'report',
        'Synthetic retention fixture', '{"news_scope":"city"}',
        CONCAT('https://example.org/', record), 'unknown', 'unverified', CAST([] AS ARRAY<STRING>),
        'unknown', 'active', IF(source = 'ticketmaster.events', 'restricted', 'verified_open'), TRUE FROM fixture;

      INSERT INTO ${table('geo_record_sources')}
        (geo_record_id, version_id, source_record_id, source_version_id, evidence_role,
         original_url, batch_id, source_id, schema_version, fetched_at)
      SELECT record, version, CONCAT('source-', record), version, 'article_metadata',
        CONCAT('https://example.org/', record), batch, source, 1, link_time FROM fixture;
    `, { now: now.toISOString(), fixture: JSON.stringify(fixture), batches: JSON.stringify(batches) });

    await t.test('25-hour cache is hidden by actual core and news views while fresh metadata remains', async () => {
      for (const name of ['v_geo_records_history', 'v_geo_records_current', 'v_news_history',
        'v_news_current', 'v_melbourne_news_current', 'v_news_sources', 'v_change_timeline', 'v_events_current']) {
        const expired = await query(`SELECT COUNT(*) AS n FROM ${view(name)}
          WHERE geo_record_id IN ('expired-event', 'expired-news')`);
        assert.equal(expired[0]?.n, 0, `${name} must not expose a 25-hour Ticketmaster cache`);
      }
      const fresh = await query(`SELECT geo_record_id FROM ${view('v_news_sources')}
        WHERE geo_record_id = 'fresh-reference'`);
      assert.equal(fresh.length, 1, 'The positive fresh source reference must remain visible');
    });

    await t.test('fresh geometry cannot expose an expired cached source or cached evidence link', async () => {
      const references = await query(`SELECT geo_record_id FROM ${view('v_news_sources')}
        WHERE geo_record_id IN ('expired-source-reference', 'expired-link-reference')`);
      assert.equal(references.length, 0, 'Source and evidence cache lifetimes must both be enforced');
    });

    await t.test('only latest complete event snapshot membership is current', async () => {
      const current = await query(`SELECT geo_record_id, version_id FROM ${view('v_geo_records_current')}
        WHERE geo_record_id IN ('event', 'news', 'disappeared') ORDER BY geo_record_id`);
      assert.deepEqual(current, [
        { geo_record_id: 'event', version_id: 'a-newer' },
        { geo_record_id: 'news', version_id: 'a-newer' },
      ]);
      const history = await query(`SELECT COUNT(*) AS n FROM ${view('v_geo_records_history')}
        WHERE geo_record_id IN ('event', 'news', 'disappeared')`);
      assert.equal(history[0]?.n, 5, 'History must retain both fresh-cache versions and omitted old member');
    });

    await t.test('failed newer snapshot preserves the previous complete cache', async () => {
      await query(`INSERT INTO ${table('sync_batches')}
        (batch_id, source_id, started_at, state, state_updated_at, schema_version)
        VALUES ('tm-failed', 'ticketmaster.events', TIMESTAMP(@started), 'failed', TIMESTAMP(@now), 1)`,
      { started: ago(1), now: now.toISOString() });
      const events = await query(`SELECT geo_record_id, version_id FROM ${view('v_events_current')}`);
      assert.deepEqual(events, [{ geo_record_id: 'event', version_id: 'a-newer' }]);
    });

    await t.test('empty complete snapshot clears current membership and keeps permitted history', async () => {
      await query(`INSERT INTO ${table('sync_batches')}
        (batch_id, source_id, started_at, state, state_updated_at, published_at, output_count, schema_version)
        VALUES ('tm-empty', 'ticketmaster.events', TIMESTAMP(@started), 'published', TIMESTAMP(@now), TIMESTAMP(@now), 0, 1)`,
      { started: ago(0.5), now: now.toISOString() });
      const current = await query(`SELECT COUNT(*) AS n FROM ${view('v_geo_records_current')}
        WHERE source_id = 'ticketmaster.events'`);
      assert.equal(current[0]?.n, 0);
      const history = await query(`SELECT COUNT(*) AS n FROM ${view('v_geo_records_history')}
        WHERE geo_record_id = 'event'`);
      assert.equal(history[0]?.n, 2, 'An empty complete snapshot does not invent a cancellation or erase cache history');
    });

    await t.test('actual cleanup physically removes target old content and preserves other sources and fresh cache', async () => {
      const bucket = storage.bucket(config.bucketName);
      const objects = [
        { name: 'raw/ticketmaster.events/expired/fixture.ndjson', expiresAt: ago(1) },
        { name: 'staging/ticketmaster.events/expired/fixture.ndjson', expiresAt: ago(1) },
        { name: 'staging/ticketmaster.events/fresh/fixture.ndjson', expiresAt: ago(-8) },
        { name: 'staging/gdelt.news/expired/fixture.ndjson', expiresAt: ago(1) },
      ];
      for (const object of objects) {
        await bucket.file(object.name).save('{"synthetic_fixture":true}\n', { resumable: false,
          metadata: { metadata: { expiresAt: object.expiresAt } },
          preconditionOpts: { ifGenerationMatch: 0 } });
      }
      const before = await contentCounts();
      const positiveOld = before.filter(row => row.source_id === 'ticketmaster.events');
      assert.equal(positiveOld.length, 3);
      assert.ok(positiveOld.every(row => row.old_count > 0), 'Every cleaned table must contain positive expired fixtures');
      const cleaned = await cleanupSourceContent(config, bigquery, gcs, 'ticketmaster.events', now);
      assert.equal(cleaned.tablesChecked, 3);
      assert.equal(cleaned.deletedObjects, 2, 'Positive expired GCS fixtures must be physically deleted');
      const after = await contentCounts();
      for (const old of before) {
        const remaining = after.find(row => row.table_name === old.table_name && row.source_id === old.source_id);
        assert.ok(remaining);
        if (old.source_id === 'ticketmaster.events') {
          assert.equal(remaining.old_count, 0);
          assert.equal(remaining.total_count, old.total_count - old.old_count,
            'Cleanup must delete exactly the target facts older than 18 hours');
        } else assert.deepEqual(remaining, old, 'Other-source old content must remain unchanged');
      }
      const freshGeo = await query(`SELECT COUNT(*) AS n FROM ${table('geo_records')}
        WHERE source_id = 'ticketmaster.events' AND fetched_at >= TIMESTAMP(@cutoff)`, { cutoff: ago(18) });
      assert.ok(typeof freshGeo[0]?.n === 'number' && freshGeo[0].n > 0, 'Positive new cache must remain');
      const objectStatus = await Promise.all(objects.map(async object => {
        const [exists] = await bucket.file(object.name).exists(); return exists;
      }));
      assert.deepEqual(objectStatus, [false, false, true, true]);
      t.diagnostic(JSON.stringify({ retention_positive_evidence: true,
        bq_old_rows_removed: positiveOld.reduce((sum, row) => sum + row.old_count, 0),
        gcs_expired_objects_removed: cleaned.deletedObjects,
        fresh_cache_rows_preserved: freshGeo[0].n, other_source_tables_preserved: 3 }));
    });
    t.diagnostic(JSON.stringify({ query_jobs_with_500mb_cap: queryJobs + 1 }));
  } catch (error) {
    const code = typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'number' ? error.code : 'unknown';
    throw new Error(`GCP retention fixture failed (code ${code})`);
  } finally {
    const cleanup = await Promise.allSettled([
      ...createdDatasets.map(dataset => bigquery.dataset(dataset).delete({ force: true })),
      ...(createdBucket ? [(async () => {
        const bucket = storage.bucket(config.bucketName);
        await bucket.deleteFiles({ force: true }); await bucket.delete();
      })()] : []),
    ]);
    const failed = cleanup.filter(result => result.status === 'rejected').length;
    assert.equal(failed, 0, 'All uniquely owned retention fixture resources must be removed');
  }
});
