import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

import { BigQuery } from '@google-cloud/bigquery';
import { z } from 'zod';

const project = process.env.MELENS_GUARD_TEST_PROJECT;
const enabled = project === 'melens-510012' && process.env.MELENS_GUARD_TEST_CONFIRM === project;
const unplanned = 'victoria.transport.road_unplanned';
const planned = 'victoria.transport.road_planned';

test('production road SQL uses complete published snapshots, removes missing impacts and fails closed on conflicting proofs', {
  skip: !enabled, timeout: 120_000,
}, async () => {
  assert.ok(project);
  const sql = await readFile(new URL('../../../sql/002_core_views.sql', import.meta.url), 'utf8');
  const body = sql.split('CREATE OR REPLACE VIEW `melens_query.v_geo_records_current` AS')[1]
    ?.trim().replace(/;\s*$/, '');
  assert.ok(body);
  assert.ok(body.startsWith('WITH '));
  const view = body.slice(5)
    .replaceAll('`melens_ingest.sync_batches`', 'fixture_batches')
    .replaceAll('`melens_ingest.geo_records`', 'fixture_geo')
    .replaceAll('`melens_ingest.source_records`', 'fixture_sources')
    .replaceAll('`melens_ingest.geo_record_sources`', 'fixture_links')
    .replaceAll('`melens_query.v_geo_records_history`', 'fixture_history');
  const query = `WITH fixture_batches AS (
    SELECT JSON_VALUE(row, '$.batch_id') AS batch_id, JSON_VALUE(row, '$.source_id') AS source_id,
      JSON_VALUE(row, '$.source_revision') AS source_revision, JSON_VALUE(row, '$.state') AS state,
      TIMESTAMP(JSON_VALUE(row, '$.published_at')) AS published_at,
      TIMESTAMP(JSON_VALUE(row, '$.state_updated_at')) AS state_updated_at,
      TIMESTAMP(JSON_VALUE(row, '$.state_updated_at')) AS started_at
    FROM UNNEST(JSON_QUERY_ARRAY(@batches)) row
  ), fixture_geo AS (
    SELECT JSON_VALUE(row, '$.batch_id') AS batch_id, JSON_VALUE(row, '$.source_id') AS source_id,
      JSON_VALUE(row, '$.geo_record_id') AS geo_record_id, JSON_VALUE(row, '$.version_id') AS version_id,
      JSON_VALUE(row, '$.record_status') AS record_status,
      TIMESTAMP(JSON_VALUE(row, '$.source_updated_at')) AS source_updated_at,
      CAST(NULL AS INT64) AS source_version_ordinal
    FROM UNNEST(JSON_QUERY_ARRAY(@records)) row
  ), fixture_sources AS (
    SELECT JSON_VALUE(row, '$.batch_id') AS batch_id, JSON_VALUE(row, '$.source_id') AS source_id,
      JSON_VALUE(row, '$.source_record_id') AS source_record_id, JSON_VALUE(row, '$.version_id') AS version_id,
      TIMESTAMP(JSON_VALUE(row, '$.fetched_at')) AS fetched_at,
      CAST(NULL AS TIMESTAMP) AS source_updated_at FROM UNNEST(JSON_QUERY_ARRAY(@parents)) row
  ), fixture_links AS (
    SELECT JSON_VALUE(row, '$.batch_id') AS batch_id, JSON_VALUE(row, '$.source_id') AS source_id,
      JSON_VALUE(row, '$.source_record_id') AS source_record_id,
      JSON_VALUE(row, '$.source_version_id') AS source_version_id,
      JSON_VALUE(row, '$.geo_record_id') AS geo_record_id, JSON_VALUE(row, '$.version_id') AS version_id,
      JSON_VALUE(row, '$.evidence_role') AS evidence_role FROM UNNEST(JSON_QUERY_ARRAY(@links)) row
  ), fixture_history AS (
    SELECT g.* FROM fixture_geo g JOIN fixture_batches b USING (batch_id, source_id)
    WHERE b.state = 'published' AND b.published_at IS NOT NULL
  ), ${view}`;
  const instant = (minute: number) => `2026-10-01T00:${String(minute).padStart(2, '0')}:00Z`;
  const batch = (id: string, source: string, minute: number, state = 'published') => ({
    batch_id: id, source_id: source, source_revision: id, state,
    published_at: state === 'published' ? instant(minute) : null, state_updated_at: instant(minute),
  });
  const parent = (id: string, source: string, minute: number, version = `snapshot:${minute}`) => ({
    batch_id: id, source_id: source, source_record_id: `${source}:snapshot:${instant(minute)}`,
    version_id: version, fetched_at: instant(minute),
  });
  const member = (snapshot: ReturnType<typeof parent>, id: string, version = 'business-v1',
    status = 'active') => ({
    record: { batch_id: snapshot.batch_id, source_id: snapshot.source_id,
      geo_record_id: `${snapshot.source_id}:${id}`, version_id: version,
      record_status: status, source_updated_at: null },
    link: { batch_id: snapshot.batch_id, source_id: snapshot.source_id,
      geo_record_id: `${snapshot.source_id}:${id}`, version_id: version,
      source_record_id: snapshot.source_record_id, source_version_id: snapshot.version_id,
      evidence_role: 'road_snapshot_membership' },
  });
  const first = parent('first', unplanned, 0);
  const works = parent('works', planned, 1);
  const removed = member(first, 'removed');
  const retained = member(first, 'retained', 'zz-old');
  const plannedEvent = member(works, 'future', 'works-v1', 'planned');
  const batches = [batch('first', unplanned, 2), batch('works', planned, 3)];
  const parents = [first, works];
  const records = [removed.record, retained.record, plannedEvent.record];
  const links = [removed.link, retained.link, plannedEvent.link];
  const bq = new BigQuery({ projectId: project });
  const ids = async () => {
    let rows: unknown;
    try {
      [rows] = await bq.query({ query, location: 'australia-southeast2',
        maximumBytesBilled: '100000000', useQueryCache: false, params: {
          batches: JSON.stringify(batches), parents: JSON.stringify(parents),
          records: JSON.stringify(records), links: JSON.stringify(links),
        } });
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : 'Cloud query failed');
    }
    return z.array(z.object({ geo_record_id: z.string(), version_id: z.string() }))
      .parse(rows).map(row => `${row.geo_record_id}|${row.version_id}`).sort();
  };
  const workId = `${plannedEvent.record.geo_record_id}|works-v1`;
  assert.deepEqual(await ids(), [workId, `${removed.record.geo_record_id}|business-v1`,
    `${retained.record.geo_record_id}|zz-old`].sort());
  const newer = parent('new', unplanned, 10);
  const changed = member(newer, 'retained', 'aa-new');
  batches.push(batch('new', unplanned, 11));
  parents.push(newer);
  records.push(changed.record);
  links.push(changed.link);
  assert.deepEqual(await ids(), [workId, `${changed.record.geo_record_id}|aa-new`].sort());
  // A failed empty response must not clear the last published observations.
  batches.push(batch('failed', unplanned, 21, 'failed'));
  parents.push(parent('failed', unplanned, 20));
  // A delayed publication of an older snapshot must not supersede its fetch order.
  batches.push(batch('backfill', unplanned, 22));
  parents.push(parent('backfill', unplanned, 5));
  assert.deepEqual(await ids(), [workId, `${changed.record.geo_record_id}|aa-new`].sort());
  // Same-ID versions must come from the exact parent proof, not any old link.
  const empty = parent('empty', unplanned, 30);
  batches.push(batch('empty', unplanned, 31));
  parents.push(empty);
  links.push({ ...changed.link, batch_id: 'empty', source_record_id: empty.source_record_id,
    source_version_id: 'wrong-parent-version' });
  assert.deepEqual(await ids(), [workId]);
  const worksGone = parent('works-empty', planned, 40);
  batches.push(batch('works-empty', planned, 41));
  parents.push(worksGone);
  assert.deepEqual(await ids(), []);
  // Return one event, then reject a competing proof at exactly the same fetch time.
  const returnSnapshot = parent('return', unplanned, 45);
  const returned = member(returnSnapshot, 'retained', 'return-v1');
  batches.push(batch('return', unplanned, 46));
  parents.push(returnSnapshot);
  records.push(returned.record);
  links.push(returned.link);
  assert.deepEqual(await ids(), [`${returned.record.geo_record_id}|return-v1`]);
  batches.push(batch('conflict', unplanned, 47));
  parents.push(parent('conflict', unplanned, 45, 'different-content'));
  assert.deepEqual(await ids(), []);
  assert.equal(records.every(record => record.record_status !== 'resolved'), true);
});
