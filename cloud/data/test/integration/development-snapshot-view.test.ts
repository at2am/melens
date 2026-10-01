import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

import { BigQuery } from '@google-cloud/bigquery';
import { z } from 'zod';

const project = process.env.MELENS_GUARD_TEST_PROJECT;
const enabled = project === 'melens-510012'
  && process.env.MELENS_GUARD_TEST_CONFIRM === project;
const development = 'melbourne.development_monitor';

test('production current-view SQL handles snapshot removals, failed refresh and old backfill', {
  skip: !enabled, timeout: 120_000,
}, async () => {
  assert.ok(project);
  const sql = await readFile(new URL('../../../sql/002_core_views.sql', import.meta.url), 'utf8');
  const marker = 'CREATE OR REPLACE VIEW `melens_query.v_geo_records_current` AS';
  const body = sql.split(marker)[1]?.trim().replace(/;\s*$/, '');
  assert.ok(body);
  assert.ok(body.startsWith('WITH '));
  const view = body
    .replace('WITH ', '')
    .replaceAll('`melens_ingest.sync_batches`', 'synthetic_batches')
    .replaceAll('`melens_ingest.geo_records`', 'synthetic_geo')
    .replaceAll('`melens_ingest.source_records`', 'synthetic_sources')
    .replaceAll('`melens_ingest.geo_record_sources`', 'synthetic_links')
    .replaceAll('`melens_query.v_geo_records_history`', 'synthetic_history');
  const query = `WITH synthetic_batches AS (
    SELECT JSON_VALUE(row, '$.batch_id') AS batch_id,
      JSON_VALUE(row, '$.source_id') AS source_id,
      JSON_VALUE(row, '$.source_revision') AS source_revision,
      JSON_VALUE(row, '$.state') AS state,
      TIMESTAMP(JSON_VALUE(row, '$.published_at')) AS published_at,
      TIMESTAMP(JSON_VALUE(row, '$.state_updated_at')) AS state_updated_at,
      TIMESTAMP(JSON_VALUE(row, '$.state_updated_at')) AS started_at
    FROM UNNEST(JSON_QUERY_ARRAY(@batches)) AS row
  ), synthetic_geo AS (
    SELECT JSON_VALUE(row, '$.batch_id') AS batch_id,
      JSON_VALUE(row, '$.source_id') AS source_id,
      JSON_VALUE(row, '$.geo_record_id') AS geo_record_id,
      JSON_VALUE(row, '$.version_id') AS version_id,
      JSON_VALUE(row, '$.record_status') AS record_status,
      TIMESTAMP(JSON_VALUE(row, '$.source_updated_at')) AS source_updated_at,
      CAST(NULL AS INT64) AS source_version_ordinal
    FROM UNNEST(JSON_QUERY_ARRAY(@records)) AS row
  ), synthetic_sources AS (
    SELECT CAST(NULL AS STRING) AS batch_id, CAST(NULL AS STRING) AS source_id,
      CAST(NULL AS STRING) AS source_record_id, CAST(NULL AS STRING) AS version_id,
      CAST(NULL AS TIMESTAMP) AS source_updated_at,
      CAST(NULL AS TIMESTAMP) AS fetched_at FROM UNNEST(ARRAY<BOOL>[])
  ), synthetic_links AS (
    SELECT CAST(NULL AS STRING) AS batch_id, CAST(NULL AS STRING) AS source_id,
      CAST(NULL AS STRING) AS source_record_id, CAST(NULL AS STRING) AS source_version_id,
      CAST(NULL AS STRING) AS geo_record_id, CAST(NULL AS STRING) AS version_id,
      CAST(NULL AS STRING) AS evidence_role FROM UNNEST(ARRAY<BOOL>[])
  ), synthetic_history AS (
    SELECT * FROM synthetic_geo WHERE batch_id != 'failed'
  ), ${view}`;
  const batch = (id: string, revision: string, published: string, state = 'published') => ({
    batch_id: id, source_id: development, source_revision: revision, state,
    published_at: state === 'published' ? published : null, state_updated_at: published,
  });
  const batches = [
    batch('old', '2026-09-01T00:00:00Z', '2026-09-01T01:00:00Z'),
    batch('new', '2026-09-15T00:00:00Z', '2026-09-15T01:00:00Z'),
    batch('backfill', '2026-08-01T00:00:00Z', '2026-09-20T01:00:00Z'),
    batch('failed', '2026-10-01T00:00:00Z', '2026-10-01T01:00:00Z', 'failed'),
  ];
  const record = (batchId: string, id: string, updated: string, status = 'planned',
    source = development) => ({ batch_id: batchId, source_id: source,
    geo_record_id: id, version_id: `${id}:${updated}`, record_status: status,
    source_updated_at: updated });
  const records = [
    record('old', 'removed', '2026-09-01T00:00:00Z'),
    record('old', 'retained', '2026-09-01T00:00:00Z'),
    record('new', 'retained', '2026-09-15T00:00:00Z'),
    record('backfill', 'backfill-only', '2026-08-01T00:00:00Z'),
    record('failed', 'failed-only', '2026-10-01T00:00:00Z'),
    record('news', 'unrelated-source', '2026-07-01T00:00:00Z', 'active', 'gdelt.news'),
  ];
  const bigquery = new BigQuery({ projectId: project });
  async function ids(inputBatches: typeof batches, inputRecords = records): Promise<string[]> {
    let rows: unknown;
    try {
      const [queried] = await bigquery.query({ query, location: 'australia-southeast2',
      maximumBytesBilled: '100000000', useQueryCache: false,
      params: { batches: JSON.stringify(inputBatches), records: JSON.stringify(inputRecords) } });
      rows = queried;
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : 'Cloud query failed');
    }
    return z.array(z.object({ geo_record_id: z.string() })).parse(rows)
      .map(row => row.geo_record_id).sort();
  }
  assert.deepEqual(await ids(batches), ['retained', 'unrelated-source']);
  assert.deepEqual(await ids([...batches,
    batch('empty', '2026-10-15T00:00:00Z', '2026-10-15T01:00:00Z')]), ['unrelated-source']);
  assert.deepEqual(await ids(batches, records.map(row =>
    row.batch_id === 'new' ? { ...row, record_status: 'resolved' } : row)), ['unrelated-source']);
});
