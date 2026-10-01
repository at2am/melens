import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

import { BigQuery } from '@google-cloud/bigquery';
import { z } from 'zod';

const project = process.env.MELENS_GUARD_TEST_PROJECT;
const enabled = project === 'melens-510012' && process.env.MELENS_GUARD_TEST_CONFIRM === project;
const source = 'victoria.transport.gtfs_realtime';
type Mode = 'metro_train' | 'yarra_tram';

test('production GTFS SQL uses latest published FULL_DATASET per mode, including empty snapshots', {
  skip: !enabled, timeout: 120_000,
}, async () => {
  assert.ok(project);
  const sql = await readFile(new URL('../../../sql/002_core_views.sql', import.meta.url), 'utf8');
  const marker = 'CREATE OR REPLACE VIEW `melens_query.v_geo_records_current` AS';
  const body = sql.split(marker)[1]?.trim().replace(/;\s*$/, '');
  assert.ok(body);
  assert.ok(body.startsWith('WITH '));
  const view = body.replace('WITH ', '')
    .replaceAll('`melens_ingest.sync_batches`', 'synthetic_batches')
    .replaceAll('`melens_ingest.geo_records`', 'synthetic_geo')
    .replaceAll('`melens_ingest.source_records`', 'synthetic_sources')
    .replaceAll('`melens_ingest.geo_record_sources`', 'synthetic_links')
    .replaceAll('`melens_query.v_geo_records_history`', 'synthetic_history');
  const query = `WITH synthetic_batches AS (
    SELECT JSON_VALUE(row, '$.batch_id') AS batch_id, JSON_VALUE(row, '$.source_id') AS source_id,
      JSON_VALUE(row, '$.source_revision') AS source_revision, JSON_VALUE(row, '$.state') AS state,
      TIMESTAMP(JSON_VALUE(row, '$.published_at')) AS published_at,
      TIMESTAMP(JSON_VALUE(row, '$.state_updated_at')) AS state_updated_at,
      TIMESTAMP(JSON_VALUE(row, '$.state_updated_at')) AS started_at
    FROM UNNEST(JSON_QUERY_ARRAY(@batches)) row
  ), synthetic_geo AS (
    SELECT JSON_VALUE(row, '$.batch_id') AS batch_id, JSON_VALUE(row, '$.source_id') AS source_id,
      JSON_VALUE(row, '$.geo_record_id') AS geo_record_id, JSON_VALUE(row, '$.version_id') AS version_id,
      JSON_VALUE(row, '$.record_status') AS record_status,
      TIMESTAMP(JSON_VALUE(row, '$.source_updated_at')) AS source_updated_at,
      CAST(NULL AS INT64) AS source_version_ordinal FROM UNNEST(JSON_QUERY_ARRAY(@records)) row
  ), synthetic_sources AS (
    SELECT JSON_VALUE(row, '$.batch_id') AS batch_id, JSON_VALUE(row, '$.source_id') AS source_id,
      JSON_VALUE(row, '$.source_record_id') AS source_record_id, JSON_VALUE(row, '$.version_id') AS version_id,
      TIMESTAMP(JSON_VALUE(row, '$.source_updated_at')) AS source_updated_at
    FROM UNNEST(JSON_QUERY_ARRAY(@parents)) row
  ), synthetic_links AS (
    SELECT JSON_VALUE(row, '$.batch_id') AS batch_id, JSON_VALUE(row, '$.source_id') AS source_id,
      JSON_VALUE(row, '$.source_record_id') AS source_record_id,
      JSON_VALUE(row, '$.source_version_id') AS source_version_id,
      JSON_VALUE(row, '$.geo_record_id') AS geo_record_id, JSON_VALUE(row, '$.version_id') AS version_id,
      JSON_VALUE(row, '$.evidence_role') AS evidence_role FROM UNNEST(JSON_QUERY_ARRAY(@links)) row
  ), synthetic_history AS (
    SELECT g.* FROM synthetic_geo g JOIN synthetic_batches b USING (batch_id, source_id)
    WHERE b.state = 'published'
  ), ${view}`;
  const instant = (minute: number) => `2026-09-28T00:${String(minute).padStart(2, '0')}:00Z`;
  const batch = (id: string, minute: number, state = 'published') => ({
    batch_id: id, source_id: source, source_revision: id, state,
    published_at: state === 'published' ? instant(minute) : null, state_updated_at: instant(minute),
  });
  const parent = (batchId: string, mode: Mode, minute: number) => ({
    batch_id: batchId, source_id: source,
    source_record_id: `${source}:feed:${mode}:${instant(minute)}`,
    version_id: `${mode}:snapshot:${minute}`, source_updated_at: instant(minute),
  });
  const member = (feed: ReturnType<typeof parent>, id: string) => {
    const geoId = `${source}:alert:${id}`;
    const versionId = `${id}:${feed.source_updated_at}`;
    return {
      record: { batch_id: feed.batch_id, source_id: source, geo_record_id: geoId, version_id: versionId,
        record_status: 'active', source_updated_at: feed.source_updated_at },
      link: { batch_id: feed.batch_id, source_id: source, geo_record_id: geoId, version_id: versionId,
        source_record_id: feed.source_record_id, source_version_id: feed.version_id,
        evidence_role: 'parent_feed_snapshot' },
    };
  };
  const initialMetro = parent('initial', 'metro_train', 5);
  const initialTram = parent('initial', 'yarra_tram', 4);
  const oldMetro = member(initialMetro, 'metro_train:M1');
  const oldTram = member(initialTram, 'yarra_tram:T1');
  const batches = [batch('initial', 6)];
  const parents = [initialMetro, initialTram];
  const records = [oldMetro.record, oldTram.record];
  const links = [oldMetro.link, oldTram.link];
  const bq = new BigQuery({ projectId: project });
  const ids = async () => {
    let rows: unknown;
    try {
      const [queried] = await bq.query({ query, location: 'australia-southeast2',
      maximumBytesBilled: '100000000', useQueryCache: false, params: {
        batches: JSON.stringify(batches), parents: JSON.stringify(parents),
        records: JSON.stringify(records), links: JSON.stringify(links),
      } });
      rows = queried;
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : 'Cloud query failed');
    }
    return z.array(z.object({ geo_record_id: z.string() })).parse(rows).map(row => row.geo_record_id).sort();
  };
  assert.deepEqual(await ids(), [oldMetro.record.geo_record_id, oldTram.record.geo_record_id]);
  // Metro advances to an empty complete feed while Tram repeats its original snapshot.
  batches.push(batch('metro-empty', 11));
  parents.push(parent('metro-empty', 'metro_train', 10), parent('metro-empty', 'yarra_tram', 4));
  const repeatedTram = member(parent('metro-empty', 'yarra_tram', 4), 'yarra_tram:T1');
  records.push(repeatedTram.record);
  links.push(repeatedTram.link);
  assert.deepEqual(await ids(), [oldTram.record.geo_record_id]);
  // A newer failed refresh and later published old backfill cannot supersede mode timestamps.
  batches.push(batch('failed', 21, 'failed'), batch('backfill', 22));
  parents.push(parent('failed', 'metro_train', 20), parent('failed', 'yarra_tram', 20),
    parent('backfill', 'metro_train', 3), parent('backfill', 'yarra_tram', 3));
  const backfill = member(parent('backfill', 'metro_train', 3), 'metro_train:OLD');
  records.push(backfill.record);
  links.push(backfill.link);
  assert.deepEqual(await ids(), [oldTram.record.geo_record_id]);
  // Disappearance changes membership only; no alert fact has been cancelled or deleted.
  batches.push(batch('both-empty', 31));
  parents.push(parent('both-empty', 'metro_train', 30), parent('both-empty', 'yarra_tram', 30));
  assert.deepEqual(await ids(), []);
  assert.equal(records.every(record => record.record_status === 'active'), true);
  assert.equal(records.length, 4);
});
