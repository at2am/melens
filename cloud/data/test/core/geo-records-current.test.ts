import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
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

test('an incremental apply reads recent batch payloads and checks published version clocks', () => {
  const sql = applyGeoRecordsCurrentBatchesSql(config);
  assert.match(sql, /^\/\* apply-geo-records-current \*\/\nDECLARE/);
  assert.ok(sql.includes(`RAISE USING MESSAGE = '${NO_STATE_MESSAGE}'`));
  assert.match(sql, /published_at > state_published/);
  // A scripting variable is a constant, so BigQuery prunes partitions on it.
  assert.match(sql, /DATE\(g\.fetched_at\) >= fetched_floor/);
  assert.match(sql, /JOIN published_batches AS b ON g\.batch_id = b\.batch_id AND g\.source_id = b\.source_id/);
  // Newest version wins by the history view's ordering; the same version prefers the newer batch.
  assert.match(sql, /source_updated_at DESC NULLS LAST,\s*source_version_ordinal DESC NULLS LAST, version_id DESC, is_incoming DESC/);
  // A newer version that is not public or that ended the record removes it, as the views do.
  assert.match(sql, /i\.public_query_allowed = TRUE AND i\.rights_status IN \('verified_open', 'restricted'\)/);
  assert.match(sql, /i\.record_status NOT IN \('cancelled', 'resolved', 'withdrawn'\)/);
  // No new batch: the state is kept rather than cleared.
  assert.match(sql, /DELETE FROM `melens-test\.melens_ingest_test\.geo_records_current_state` WHERE source_id = @sourceId AND EXISTS \(SELECT 1 FROM new_batches\)/);
});

test('late old batches cannot restore an ended or private record after the current copy removes it', () => {
  const sql = applyGeoRecordsCurrentBatchesSql(config);
  const current = '`melens-test.melens_ingest_test.geo_records_current`';
  const state = '`melens-test.melens_ingest_test.geo_records_current_state`';
  const columns = sql.match(/INSERT INTO `[^`]+geo_records_current` \(([^)]+)\)/)?.[1]?.split(', ');
  assert.ok(columns);
  const start = sql.indexOf('CREATE TEMP TABLE winners AS');
  const end = sql.indexOf(`DELETE FROM ${state}`, start);
  assert.ok(start > 0 && end > start);
  // Execute the generated winner/delete/insert statements. SQLite needs only the
  // dataset names, script variables and unrelated geography conversion adapted.
  const update = sql.slice(start, end)
    .replaceAll(current, 'geo_records_current')
    .replaceAll('`melens-test.melens_ingest_test.geo_records`', 'geo_records')
    .replaceAll('@sourceId', "'user.events'")
    .replace(/\bsource_public\b/g, 'TRUE')
    .replaceAll('SAFE.ST_GEOGFROMGEOJSON(i.geometry_geojson)', 'i.geometry_geojson');

  for (const removed of [
    { status: 'withdrawn', rights: 'verified_open', allowed: 1 },
    { status: 'cancelled', rights: 'verified_open', allowed: 1 },
    { status: 'resolved', rights: 'verified_open', allowed: 1 },
    { status: 'active', rights: 'review_required', allowed: 0 },
  ]) {
    const db = new DatabaseSync(':memory:');
    try {
      const definitions = columns.map(column => `${column} ${column === 'source_version_ordinal' ? 'INTEGER' : 'TEXT'}`).join(', ');
      db.exec(`CREATE TABLE geo_records_current (${definitions});
        CREATE TABLE incoming (${definitions}, public_query_allowed INTEGER);
        CREATE TABLE geo_records AS SELECT * FROM incoming WHERE FALSE;
        CREATE TABLE published_batches (batch_id TEXT, source_id TEXT);`);
      function refresh(batch: string, version: string, clock: string,
        access = { status: 'active', rights: 'verified_open', allowed: 1 }): void {
        db.exec('DELETE FROM incoming; DROP TABLE IF EXISTS winners;');
        db.prepare(`INSERT INTO incoming (geo_record_id, version_id, batch_id, source_id,
          source_updated_at, assertion_kind, record_status, rights_status, public_query_allowed)
          VALUES ('event-1', ?, ?, 'user.events', ?, 'observation', ?, ?, ?)`)
          .run(version, batch, clock, access.status, access.rights, access.allowed);
        db.exec('INSERT INTO geo_records SELECT * FROM incoming;');
        db.prepare("INSERT INTO published_batches VALUES (?, 'user.events')").run(batch);
        db.exec(update);
      }
      const versions = () => db.prepare('SELECT version_id FROM geo_records_current').all().map(row => row.version_id);
      refresh('B1', 'v1', '2026-10-15T01:00:00Z');
      assert.deepEqual(versions(), ['v1']);
      refresh('B2', 'v2', '2026-10-15T02:00:00Z', removed);
      assert.deepEqual(versions(), []);
      refresh('B3', 'v1', '2026-10-15T01:00:00Z');
      assert.deepEqual(versions(), [], `${removed.status}/${removed.rights} stays absent after a late old version`);
      db.exec(`INSERT INTO geo_records (geo_record_id, version_id, batch_id, source_id, source_updated_at)
        VALUES ('event-1', 'v4', 'unpublished', 'user.events', '2026-10-15T04:00:00Z');`);
      refresh('B4', 'v3', '2026-10-15T03:00:00Z');
      assert.deepEqual(versions(), ['v3'], 'A genuinely newer public version can restore the record');
    } finally {
      db.close();
    }
  }
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
  const { calls, bigquery } = fakeBigQuery(() => new Error('Exceeded rate limits'));
  await assert.rejects(refreshGeoRecordsCurrent(config, bigquery as never, 'gdelt.news'), /rate limits/);
  assert.equal(calls.length, 1);
});

test('a refresh aborted by another source\'s concurrent refresh is retried after a wait', async () => {
  let failures = 1;
  const { calls, bigquery } = fakeBigQuery(() => failures-- > 0
    ? new Error('Transaction is aborted due to concurrent update against table geo_records_current') : null);
  const waits: number[] = [];
  const sleep = async (ms: number) => { waits.push(ms); };
  assert.equal(await refreshGeoRecordsCurrent(config, bigquery as never, 'gdelt.news', undefined,
    { retryDelaysMs: [5, 15], sleep }), 'incremental');
  assert.deepEqual(waits, [5]);
  assert.equal(calls.length, 2);
});

test('a refresh that keeps meeting concurrent refreshes fails after its retries', async () => {
  const { calls, bigquery } = fakeBigQuery(() => new Error('Transaction is aborted due to a concurrent update'));
  const waits: number[] = [];
  await assert.rejects(refreshGeoRecordsCurrent(config, bigquery as never, 'gdelt.news', undefined,
    { retryDelaysMs: [5, 15], sleep: async (ms) => { waits.push(ms); } }), /concurrent update/);
  assert.deepEqual(waits, [5, 15]);
  assert.equal(calls.length, 3);
});

test('snapshot sources rebuild their own rows', async () => {
  const { calls, bigquery } = fakeBigQuery();
  assert.equal(await refreshGeoRecordsCurrent(config, bigquery as never, 'ticketmaster.events', readCoreViewSql()), 'rebuild');
  assert.deepEqual(calls.map(call => call.params), [{ sourceIds: ['ticketmaster.events'] }]);
});

test('complete-snapshot transport sources rebuild from the partitions of their latest batch', async () => {
  const calls: Call[] = [];
  const bigquery = { query: async (options: Call) => {
    calls.push(options);
    return options.query.includes('latest-snapshot-batch') ? [[{ started_at: '2026-10-16 14:30:18.919+00' }]] : [[]];
  } };
  assert.equal(await refreshGeoRecordsCurrent(config, bigquery as never, 'victoria.transport.road_planned', readCoreViewSql()), 'rebuild');
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0]!.params, { sourceId: 'victoria.transport.road_planned' });
  const rebuild = calls[1]!;
  assert.match(rebuild.query, /rebuild-geo-records-current/);
  assert.ok(rebuild.query.includes('WHERE source_id IN UNNEST(@sourceIds) AND fetched_at >= @fetchedFloor)'));
  assert.deepEqual(rebuild.params.sourceIds, ['victoria.transport.road_planned']);
  assert.equal((rebuild.params.fetchedFloor as { value: string }).value, '2026-10-15T14:30:18.919Z');
  // Before anything is published there is no floor, and other sources never get one.
  const empty = fakeBigQuery();
  await refreshGeoRecordsCurrent(config, empty.bigquery as never, 'victoria.transport.gtfs_realtime', readCoreViewSql());
  assert.deepEqual(empty.calls[1]!.params, { sourceIds: ['victoria.transport.gtfs_realtime'] });
  assert.ok(!empty.calls[1]!.query.includes('@fetchedFloor'));
  await assert.rejects(rebuildGeoRecordsCurrent(config, empty.bigquery as never, ['ticketmaster.events'],
    readCoreViewSql(), '2026-10-15T00:00:00Z'), /Only complete-snapshot sources/);
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
  // Police candidates use a private table and do not enter the public geo publisher.
  const notDrawn = new Set(['victoria.transport.gtfs_static', 'melbourne.transport.activity_counts', 'victoria.police.news']);
  const drawn = readdirSync(root, { withFileTypes: true }).filter(entry => entry.isDirectory())
    .map(entry => JSON.parse(readFileSync(new URL(`${entry.name}/source.json`, root), 'utf8')) as { source_id: string; topic: string })
    .filter(source => ['planning', 'transport', 'road_disruption', 'event', 'news'].includes(source.topic))
    .map(source => source.source_id).filter(id => !notDrawn.has(id)).sort();
  assert.deepEqual([...GEO_CURRENT_SOURCES].sort(), drawn);
});
