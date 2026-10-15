import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';

import type { DataConfig } from '../../src/core/config.js';
import {
  GEO_CURRENT_REBUILD_MAX_BYTES, GEO_CURRENT_SOURCES, NO_STATE_MESSAGE, applyGeoRecordsCurrentBatchesSql,
  currentGeoRecordsSelect, readCoreViewSql, rebuildGeoRecordsCurrent, rebuildGeoRecordsCurrentSql,
  refreshGeoRecordsCurrent,
} from '../../src/core/geo-records-current.js';

const config: DataConfig = { projectId: 'melens-test', region: 'australia-southeast2',
  ingestDataset: 'melens_ingest_test', queryDataset: 'melens_query', bucketName: 'bucket',
  maxBytesBilled: '500000000', secretNames: [] };

type Call = { query: string; params: Record<string, unknown>; maximumBytesBilled: string; location: string };
function fakeBigQuery(fail: (call: Call) => Error | null = () => null) {
  const calls: Call[] = [];
  return { calls, bigquery: { query: async (options: Call) => {
    calls.push(options);
    const error = fail(options);
    if (error) throw error;
    return [[]];
  } } };
}

test('the current select is the reviewed view SQL, inlined and narrowed to the refreshed sources', () => {
  const viewSql = readCoreViewSql();
  const select = currentGeoRecordsSelect(viewSql, config);
  // Its own rules come from the view file, so the copy cannot drift from v_geo_records_current.
  assert.match(select, /QUALIFY ROW_NUMBER\(\) OVER \(\s*PARTITION BY geo_record_id/);
  assert.match(select, /current_development_snapshot/);
  assert.doesNotMatch(select, /`melens_(query|ingest)\./, 'every dataset reference is qualified to the job config');
  for (const table of ['geo_records', 'source_records', 'geo_record_sources', 'parking_sensor_memberships']) {
    assert.ok(select.includes(`(SELECT * FROM \`melens-test.melens_ingest_test.${table}\` WHERE source_id IN UNNEST(@sourceIds))`),
      `${table} is narrowed to the refreshed sources`);
    assert.ok(!select.includes(`\`melens-test.melens_ingest_test.${table}\` AS`), `${table} is never read unnarrowed`);
  }
  assert.ok(select.includes('`melens-test.melens_ingest_test.sync_batches`'));
  assert.ok(select.includes('`melens-test.melens_ingest_test.data_sources`'));
});

test('a view file whose current view stops reading the history view is refused', () => {
  const viewSql = readCoreViewSql().replace('FROM `melens_query.v_geo_records_history` AS g\n-- Development',
    'FROM `melens_ingest.geo_records` AS g\n-- Development');
  assert.throws(() => currentGeoRecordsSelect(viewSql, config), /no longer reads the history view/);
});

test('a rebuild swaps the sources rows and their state in one transaction', () => {
  const sql = rebuildGeoRecordsCurrentSql(config, readCoreViewSql());
  const statements = ['BEGIN TRANSACTION', 'DELETE FROM `melens-test.melens_ingest_test.geo_records_current` WHERE source_id IN UNNEST(@sourceIds)',
    'INSERT INTO `melens-test.melens_ingest_test.geo_records_current`', 'DELETE FROM `melens-test.melens_ingest_test.geo_records_current_state`',
    'INSERT INTO `melens-test.melens_ingest_test.geo_records_current_state`', 'COMMIT TRANSACTION'];
  let position = -1;
  for (const statement of statements) {
    const next = sql.indexOf(statement, position + 1);
    assert.ok(next > position, `${statement} follows the previous statement`);
    position = next;
  }
  // The state names the newest published batch per source, or null for a source that never published.
  assert.match(sql, /LEFT JOIN \(/);
  assert.match(sql, /'rebuild'/);
});

test('an incremental apply reads only the new batches and their recent partitions', () => {
  const sql = applyGeoRecordsCurrentBatchesSql(config);
  assert.match(sql, /^\/\* apply-geo-records-current \*\/\nDECLARE/);
  assert.ok(sql.includes(`RAISE USING MESSAGE = '${NO_STATE_MESSAGE}'`));
  assert.match(sql, /published_at > state_published/);
  // A scripting variable is a constant, so BigQuery prunes partitions on it.
  assert.match(sql, /DATE\(g\.fetched_at\) >= fetched_floor/);
  // Newest version wins by the history view's ordering; the same version prefers the newer batch.
  assert.match(sql, /source_updated_at DESC NULLS LAST,\s*source_version_ordinal DESC NULLS LAST, version_id DESC, is_incoming DESC/);
  // A newer version that is not public or that ended the record removes it, as the views do.
  assert.match(sql, /i\.public_query_allowed = TRUE AND i\.rights_status IN \('verified_open', 'restricted'\)/);
  assert.match(sql, /i\.record_status NOT IN \('cancelled', 'resolved', 'withdrawn'\)/);
  // No new batch: the state is kept rather than cleared.
  assert.match(sql, /DELETE FROM `melens-test\.melens_ingest_test\.geo_records_current_state` WHERE source_id = @sourceId AND EXISTS \(SELECT 1 FROM new_batches\)/);
});

test('GDELT applies its new batches under the source ceiling', async () => {
  const { calls, bigquery } = fakeBigQuery();
  assert.equal(await refreshGeoRecordsCurrent(config, bigquery as never, 'gdelt.news'), 'incremental');
  assert.equal(calls.length, 1);
  assert.match(calls[0]!.query, /apply-geo-records-current/);
  assert.deepEqual(calls[0]!.params, { sourceId: 'gdelt.news' });
  assert.equal(calls[0]!.maximumBytesBilled, '500000000');
  assert.equal(calls[0]!.location, 'australia-southeast2');
});

test('GDELT without a recorded state rebuilds instead', async () => {
  const { calls, bigquery } = fakeBigQuery(call => call.query.includes('apply-geo-records-current')
    ? new Error(`Query error: ${NO_STATE_MESSAGE} at [7:3]`) : null);
  assert.equal(await refreshGeoRecordsCurrent(config, bigquery as never, 'gdelt.news', readCoreViewSql()), 'rebuild');
  assert.equal(calls.length, 2);
  assert.match(calls[1]!.query, /rebuild-geo-records-current/);
  assert.deepEqual(calls[1]!.params, { sourceIds: ['gdelt.news'] });
  assert.equal(calls[1]!.maximumBytesBilled, GEO_CURRENT_REBUILD_MAX_BYTES);
});

test('any other GDELT failure is reported, not hidden behind a rebuild', async () => {
  const { calls, bigquery } = fakeBigQuery(() => new Error('Transaction is aborted due to a concurrent update'));
  await assert.rejects(refreshGeoRecordsCurrent(config, bigquery as never, 'gdelt.news'), /concurrent update/);
  assert.equal(calls.length, 1);
});

test('snapshot sources rebuild their own rows', async () => {
  const { calls, bigquery } = fakeBigQuery();
  assert.equal(await refreshGeoRecordsCurrent(config, bigquery as never, 'ticketmaster.events', readCoreViewSql()), 'rebuild');
  assert.deepEqual(calls.map(call => call.params), [{ sourceIds: ['ticketmaster.events'] }]);
});

test('only map geo sources can be refreshed, and a ceiling is required', async () => {
  const { bigquery } = fakeBigQuery();
  await assert.rejects(refreshGeoRecordsCurrent(config, bigquery as never, 'homes_victoria.rents'), /Not a map geo source/);
  await assert.rejects(rebuildGeoRecordsCurrent(config, bigquery as never, []), /needs map geo sources/);
  await assert.rejects(refreshGeoRecordsCurrent({ ...config, maxBytesBilled: null }, bigquery as never, 'gdelt.news'),
    /requires a BigQuery query ceiling/);
  assert.ok(GEO_CURRENT_SOURCES.has('melbourne.development_monitor'));
  assert.ok(!GEO_CURRENT_SOURCES.has('melbourne.parking.sensors'), 'parking has its own current table');
});

test('every connector the map draws in a geo layer is refreshed', () => {
  const root = new URL('../../src/connectors/', import.meta.url);
  const notDrawn = new Set(['victoria.transport.gtfs_static', 'melbourne.transport.activity_counts']);
  const drawn = readdirSync(root, { withFileTypes: true }).filter(entry => entry.isDirectory())
    .map(entry => JSON.parse(readFileSync(new URL(`${entry.name}/source.json`, root), 'utf8')) as { source_id: string; topic: string })
    .filter(source => ['planning', 'transport', 'road_disruption', 'event', 'news'].includes(source.topic))
    .map(source => source.source_id).filter(id => !notDrawn.has(id)).sort();
  assert.deepEqual([...GEO_CURRENT_SOURCES].sort(), drawn);
});
