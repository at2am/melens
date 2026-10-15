import assert from 'node:assert/strict';
import test from 'node:test';

import type { BigQuery } from '@google-cloud/bigquery';

import { ParkingSensorsConnector, SOURCE_ID } from '../../src/connectors/com_parking_sensors/index.js';
import { parseConnectorInput, type ConnectorSuccess } from '../../src/core/connector.js';
import type { DataConfig } from '../../src/core/config.js';
import { OpenDataSoftClient, type OdsRecords } from '../../src/core/opendatasoft.js';
import { buildParkingSensorCurrentRows, replaceParkingSensorCurrent, replaceParkingSensorCurrentSql,
  type ParkingSensorCurrentRow } from '../../src/core/parking-sensor-current.js';

const now = '2026-10-15T09:00:00.000Z';
const offlineSince = '2025-06-26T02:44:34.000Z';
const config: DataConfig = { projectId: 'melens-fixture', region: 'australia-southeast2',
  bucketName: 'fixture', ingestDataset: 'melens_ingest', queryDataset: 'melens_query',
  maxBytesBilled: '500000000', secretNames: [] };

class SnapshotClient extends OpenDataSoftClient {
  constructor(private readonly snapshot: OdsRecords) { super(); }
  override async fetchRecords(): Promise<OdsRecords> { return this.snapshot; }
}
async function collect(rows: unknown[]): Promise<ConnectorSuccess> {
  const result = await new ParkingSensorsConnector(new SnapshotClient({ records: rows,
    totalCount: rows.length, pageCount: 1, fetchedAt: now, lastModified: null }))
    .collect(parseConnectorInput({ sourceId: SOURCE_ID, runId: 'run', window: { kind: 'snapshot', revision: now },
      checkpoint: null }));
  if (result.kind !== 'success') throw new Error('Parking fixture collection failed');
  return result;
}

const online = { kerbsideid: 1, lastupdated: now, status_timestamp: '2026-10-15T08:50:00.000Z',
  status_description: 'Present', zone_number: 7, location: { lat: -37.81, lon: 144.96 } };
// A sensor that stopped reporting keeps its old report time: it must not look current.
const offline = { kerbsideid: 2, lastupdated: offlineSince, status_timestamp: '2025-06-16T02:55:00.000Z',
  status_description: 'Unoccupied', zone_number: 8, location: { lat: -37.82, lon: 144.97 } };
const unlocated = { kerbsideid: 3, lastupdated: now, status_timestamp: null,
  status_description: 'Unoccupied', zone_number: null, location: null };

const byId = (rows: ParkingSensorCurrentRow[], id: string) => {
  const row = rows.find(value => value.sensor_id === id);
  assert.ok(row, `${id} must be present`);
  return row;
};

test('every sensor in the snapshot gets exactly one row, built from the fresh fetch alone', async () => {
  const rows = buildParkingSensorCurrentRows(await collect([online, offline, unlocated]), 'batch_new');
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map(row => row.sensor_id).sort(), ['kerbside:1', 'kerbside:2', 'kerbside:3']);
  for (const row of rows) {
    assert.equal(row.batch_id, 'batch_new');
    assert.equal(row.source_id, SOURCE_ID);
    assert.equal(row.schema_version, 1);
    assert.equal(row.fetched_at, now);
    assert.equal(row.record_status, 'active');
    assert.equal(row.rights_status, 'verified_open');
    assert.match(row.original_url, /^https:\/\/data\.melbourne\.vic\.gov\.au\//);
  }
});

test('occupancy, zone and position are carried over; an offline sensor keeps its own old report time', async () => {
  const rows = buildParkingSensorCurrentRows(await collect([online, offline, unlocated]), 'batch_new');
  const live = byId(rows, 'kerbside:1');
  assert.equal(live.occupied, true);
  assert.equal(live.status_description, 'Present');
  assert.equal(live.zone_number, 7);
  assert.equal(live.source_updated_at, now);
  assert.equal(live.observed_at, '2026-10-15T08:50:00.000Z');
  assert.equal(live.latitude, -37.81);
  assert.equal(live.longitude, 144.96);
  assert.deepEqual(JSON.parse(live.geometry_geojson ?? 'null'), { type: 'Point', coordinates: [144.96, -37.81] });
  const dead = byId(rows, 'kerbside:2');
  assert.equal(dead.source_updated_at, offlineSince, 'The per-sensor heartbeat is what marks it stale');
  assert.equal(dead.occupied, false);
});

test('a sensor with no position or status time keeps nulls instead of invented values', async () => {
  const rows = buildParkingSensorCurrentRows(await collect([unlocated]), 'batch_new');
  const row = byId(rows, 'kerbside:3');
  assert.equal(row.latitude, null);
  assert.equal(row.longitude, null);
  assert.equal(row.geometry_geojson, null);
  assert.equal(row.observed_at, null);
  assert.equal(row.occupied, null, 'No status time means no observation, so no occupancy claim');
  assert.equal(row.zone_number, null);
  assert.equal(row.marker_id, null, 'No sensor-to-bay crosswalk is admitted');
  assert.equal(row.bay_id, null);
});

test('an empty snapshot produces an empty projection so a vanished sensor cannot linger', async () => {
  assert.deepEqual(buildParkingSensorCurrentRows(await collect([]), 'batch_new'), []);
});

test('the projection rejects another source and a missing batch', async () => {
  const result = await collect([online]);
  assert.throws(() => buildParkingSensorCurrentRows({ ...result, sourceId: 'melbourne.parking.bays' } as ConnectorSuccess,
    'batch'), /parking sensor source/);
  assert.throws(() => buildParkingSensorCurrentRows(result, ''), /published batch id/);
  assert.throws(() => buildParkingSensorCurrentRows({ ...result, inputCount: 2 }, 'batch'), /every input sensor/);
});

test('the swap is one transaction that removes the old snapshot and inserts the new one', () => {
  const sql = replaceParkingSensorCurrentSql(config);
  assert.match(sql, /^BEGIN TRANSACTION;/);
  assert.match(sql, /COMMIT TRANSACTION;$/);
  const del = sql.indexOf('DELETE FROM `melens-fixture.melens_ingest.parking_sensor_current`');
  const insert = sql.indexOf('INSERT INTO `melens-fixture.melens_ingest.parking_sensor_current`');
  assert.ok(del > 0 && insert > del, 'Delete must precede insert inside the transaction');
  assert.match(sql, /WHERE source_id = @sourceId/);
  // Real coordinates (144.9434975049776) do not round-trip through FLOAT64; the default exact mode
  // rejected them in production on 2026-10-15.
  assert.match(sql, /PARSE_JSON\(@payload, wide_number_mode => 'round'\)/);
  assert.doesNotMatch(sql, /parking_sensor_memberships|source_records|geo_records/,
    'The swap must not depend on the append-only history');
});

test('replacing submits the rows with the billed-byte ceiling and returns the count', async () => {
  const calls: { query: string; params: Record<string, string>; location: string; maximumBytesBilled: string }[] = [];
  const bigquery = { async query(options: (typeof calls)[number]) { calls.push(options); return [[]]; },
  } as unknown as Pick<BigQuery, 'query'>;
  const rows = buildParkingSensorCurrentRows(await collect([online, offline]), 'batch_new');
  assert.deepEqual(await replaceParkingSensorCurrent(config, bigquery, rows), { rows: 2 });
  assert.equal(calls.length, 1, 'One query, so the swap is atomic');
  assert.equal(calls[0]?.maximumBytesBilled, '500000000');
  assert.equal(calls[0]?.location, 'australia-southeast2');
  assert.equal(calls[0]?.params.sourceId, SOURCE_ID);
  assert.equal((JSON.parse(calls[0]?.params.payload ?? '[]') as unknown[]).length, 2);
});

test('replacing refuses a missing ceiling, mixed batches and oversized snapshots', async () => {
  const bigquery = { async query() { throw new Error('must not be called'); } } as unknown as Pick<BigQuery, 'query'>;
  const rows = buildParkingSensorCurrentRows(await collect([online, offline]), 'batch_new');
  await assert.rejects(replaceParkingSensorCurrent({ ...config, maxBytesBilled: null }, bigquery, rows), /query ceiling/);
  const first = rows[0];
  const second = rows[1];
  assert.ok(first && second);
  await assert.rejects(replaceParkingSensorCurrent(config, bigquery, [first, { ...second, batch_id: 'other' }]),
    /one batch/);
  const huge = Array.from({ length: 30_000 }, (_, index) => ({ ...first, sensor_id: `kerbside:${index}` }));
  await assert.rejects(replaceParkingSensorCurrent(config, bigquery, huge), /safe request size/);
});

test('a failed swap surfaces so the job fails and the next cycle retries', async () => {
  const bigquery = { async query() { throw new Error('transaction aborted'); } } as unknown as Pick<BigQuery, 'query'>;
  const rows = buildParkingSensorCurrentRows(await collect([online]), 'batch_new');
  await assert.rejects(replaceParkingSensorCurrent(config, bigquery, rows), /transaction aborted/);
});
