import assert from 'node:assert/strict';
import { test } from 'node:test';

import { BigQuery } from '@google-cloud/bigquery';

import { PedestrianLocationsConnector, SOURCE_ID } from '../../src/connectors/com_pedestrian_locations/index.js';
import { parseConnectorInput } from '../../src/core/connector.js';
import type { DataConfig } from '../../src/core/config.js';
import { OpenDataSoftClient, type OdsRecords } from '../../src/core/opendatasoft.js';
import { withPublishedPedestrianLocationHistory } from '../../src/core/pedestrian-location-history.js';
import type { SensorLocation } from '../../src/core/types.js';
import { joinPedestrianObservations } from '../../src/normalization/pedestrian.js';
import { parseSourceRecord } from '../../src/validation/record.js';

const config: DataConfig = { projectId: 'melens-fixture', region: 'australia-southeast2',
  bucketName: 'fixture', ingestDataset: 'melens_ingest', queryDataset: 'melens_query',
  secretNames: [], maxBytesBilled: '100000000' };
const input = parseConnectorInput({ sourceId: SOURCE_ID, runId: 'location-1',
  window: { kind: 'snapshot', revision: 'latest' }, checkpoint: null });
const firstTime = '2026-09-01T00:00:00.000Z';
const secondTime = '2026-09-02T00:00:00.000Z';
const thirdTime = '2026-09-03T00:00:00.000Z';
const row = { location_id: 999, sensor_description: 'Fixture', status: 'A',
  latitude: -37.81, longitude: 144.96, installation_date: '2010-01-01' };

class SnapshotClient extends OpenDataSoftClient {
  constructor(private readonly snapshot: OdsRecords) { super(); }
  override async fetchRecords(): Promise<OdsRecords> { return this.snapshot; }
}
const snapshot = (records: unknown[], fetchedAt: string, lastModified: string | null = null): OdsRecords => ({
  records, fetchedAt, lastModified, pageCount: 1, totalCount: records.length,
});

test('cold runs restore published intervals, replay unchanged facts, and emit immutable closure evidence', async t => {
  const bigquery = new BigQuery({ projectId: config.projectId });
  let published: readonly SensorLocation[] = [];
  const query = t.mock.method(bigquery, 'query', async (options: {
    query: string; params: Record<string, string>; maximumBytesBilled: string;
  }) => {
    assert.equal(options.maximumBytesBilled, '100000000');
    assert.deepEqual(options.params, { sourceId: SOURCE_ID });
    assert.match(options.query, /b\.state = 'published' AND b\.published_at IS NOT NULL/);
    assert.match(options.query, /r\.batch_id = l\.batch_id/);
    assert.match(options.query, /r\.version_id = l\.version_id/);
    assert.match(options.query, /IF\(l\.valid_to IS NULL, 1, 0\)/);
    assert.match(options.query, /LIMIT 50001/);
    return [published.map(location => ({ location: JSON.stringify(location) }))];
  });
  const first = await new PedestrianLocationsConnector({ client: new SnapshotClient(snapshot([row], firstTime)) })
    .collect(await withPublishedPedestrianLocationHistory(input, config, bigquery));
  assert.equal(first.kind, 'success');
  if (first.kind !== 'success') throw new Error('Initial snapshot failed');
  const original = first.sensorLocations[0];
  assert.ok(original);
  const originalJson = JSON.stringify(original);
  published = first.sensorLocations;

  const repeated = await new PedestrianLocationsConnector({ client: new SnapshotClient(snapshot([row], secondTime)) })
    .collect(await withPublishedPedestrianLocationHistory({ ...input, runId: 'location-2' }, config, bigquery));
  assert.equal(repeated.kind, 'success');
  if (repeated.kind !== 'success') throw new Error('Unchanged snapshot failed');
  assert.equal(repeated.sensorLocations[0]?.version_id, original.version_id);
  assert.equal(repeated.sensorLocations[0]?.valid_from, firstTime);
  assert.notEqual(repeated.sourceRevision, first.sourceRevision,
    'A later complete check needs a distinct publication batch to persist its confirmation');
  assert.match(repeated.sourceRevision ?? '', /^observation-snapshot:/);
  assert.equal(repeated.sourceLatestUpdateAt, first.sourceLatestUpdateAt);
  const businessContent = (value: object) => Object.fromEntries(Object.entries(value)
    .filter(([key]) => !['batch_id', 'fetched_at', 'raw_uri'].includes(key)));
  assert.deepEqual(businessContent(repeated.sourceRecords[0] ?? {}),
    businessContent(first.sourceRecords[0] ?? {}));
  assert.deepEqual(businessContent(repeated.geoRecords[0] ?? {}),
    businessContent(first.geoRecords[0] ?? {}));
  assert.deepEqual(businessContent(repeated.geoRecordSources[0] ?? {}),
    businessContent(first.geoRecordSources[0] ?? {}));
  published = repeated.sensorLocations;
  const moved = await new PedestrianLocationsConnector({
    client: new SnapshotClient(snapshot([{ ...row, longitude: 144.97 }], thirdTime)),
  }).collect(await withPublishedPedestrianLocationHistory({ ...input, runId: 'location-3' }, config, bigquery));
  assert.equal(moved.kind, 'success');
  if (moved.kind !== 'success') throw new Error('Moved snapshot failed');
  assert.equal(JSON.stringify(original), originalJson);
  assert.equal(repeated.sensorLocations[0]?.valid_to, null);
  const closed = moved.sensorLocations.find(location => location.valid_to !== null);
  const current = moved.sensorLocations.find(location => location.valid_to === null);
  assert.ok(closed);
  assert.ok(current);
  assert.notEqual(closed.version_id, original.version_id);
  assert.equal(closed.valid_to, secondTime, 'Last fetched confirmation matters even when Last-Modified is absent');
  assert.equal(current.valid_from, thirdTime);
  for (const location of moved.sensorLocations) {
    const sourceFact: (typeof moved.sourceRecords)[number] | undefined = moved.sourceRecords.find(fact => fact.batch_id === location.batch_id
      && fact.source_record_id === location.source_record_id && fact.version_id === location.version_id);
    assert.ok(sourceFact, 'Every closure and current location has an exact source fact');
    assert.deepEqual(parseSourceRecord(sourceFact), sourceFact);
  }
  const observation = (observedAt: string) => ({ batch_id: 'readings', source_id: 'melbourne.pedestrian.minute',
    schema_version: 1, fetched_at: thirdTime, sensor_id: '999', observed_at: observedAt,
    version_id: 'reading', direction_a_count: 1, direction_b_count: 2, total_count: 3,
    source_record_id: 'reading:999' });
  const joined = joinPedestrianObservations({ granularity: 'minute', locations: moved.sensorLocations,
    observations: [observation('2026-09-01T12:00:00.000Z'),
      observation('2026-09-02T12:00:00.000Z'), observation('2026-09-03T12:00:00.000Z')] });
  assert.deepEqual(joined.map(item => item.locationStatus), ['located', 'unlocated', 'located']);
  assert.equal(query.mock.callCount(), 3);
});

test('complete-snapshot disappearance closes only confirmed history and does not invent removal status', async () => {
  const first = await new PedestrianLocationsConnector({ client: new SnapshotClient(snapshot([row], firstTime)) })
    .collect(input);
  assert.equal(first.kind, 'success');
  if (first.kind !== 'success') throw new Error('First snapshot failed');
  const missing = await new PedestrianLocationsConnector({ previousLocations: first.sensorLocations,
    client: new SnapshotClient(snapshot([], secondTime)) }).collect({ ...input, runId: 'missing' });
  assert.equal(missing.kind, 'success');
  if (missing.kind !== 'success') throw new Error('Missing snapshot failed');
  assert.equal(missing.sensorLocations.length, 1);
  assert.equal(missing.sensorLocations[0]?.valid_to, firstTime);
  assert.equal(missing.sensorLocations[0]?.device_status, 'A');
  assert.equal(missing.geoRecords.length, 0);
  assert.match(missing.sourceRecords[0]?.time_missing_reason ?? '', /no inferred removal time or status/);
  assert.equal(first.sensorLocations[0]?.valid_to, null);
});

test('reusing one process never supplies unpublished history to a later collection', async t => {
  const client = new SnapshotClient(snapshot([row], firstTime));
  let page = snapshot([row], firstTime);
  t.mock.method(client, 'fetchRecords', async () => page);
  const connector = new PedestrianLocationsConnector({ client });
  const first = await connector.collect(input);
  page = snapshot([{ ...row, longitude: 144.97 }], secondTime);
  const second = await connector.collect({ ...input, runId: 'second' });
  assert.equal(first.kind, 'success');
  assert.equal(second.kind, 'success');
  if (first.kind !== 'success' || second.kind !== 'success') throw new Error('Snapshots failed');
  assert.equal(second.sensorLocations.length, 1);
  assert.equal(second.sourceRecords.length, 1);
  assert.equal(second.sensorLocations[0]?.valid_from, secondTime);
  assert.equal(first.sensorLocations[0]?.valid_to, null);
  const replay = await connector.collect({ ...input, runId: 'retry-same-acquisition' });
  assert.equal(replay.kind, 'success');
  if (replay.kind !== 'success') throw new Error('Acquisition replay failed');
  assert.equal(replay.sourceRevision, second.sourceRevision);
  assert.equal(replay.sensorLocations[0]?.version_id, second.sensorLocations[0]?.version_id);
});

test('malformed and duplicate published checkpoints fail before any source request', async t => {
  const client = new SnapshotClient(snapshot([row], firstTime));
  const request = t.mock.method(client, 'fetchRecords');
  const connector = new PedestrianLocationsConnector({ client });
  for (const checkpoint of ['{', '{}', '[]', JSON.stringify({
    kind: 'published_pedestrian_locations', cursor: null, locations: [{ sensor_id: '999' }],
  })]) {
    const result = await connector.collect({ ...input, checkpoint });
    assert.equal(result.kind, 'failure');
  }
  assert.equal(request.mock.callCount(), 0);
});

test('history ceiling, schema, duplicate intervals, and source scope are enforced before collection', async t => {
  const bigquery = new BigQuery({ projectId: config.projectId });
  await assert.rejects(withPublishedPedestrianLocationHistory(input, { ...config, maxBytesBilled: null }, bigquery),
    /billed-byte ceiling/);
  const query = t.mock.method(bigquery, 'query', async () => [[{ location: '{}' }]]);
  await assert.rejects(withPublishedPedestrianLocationHistory(input, config, bigquery));
  query.mock.mockImplementation(async () => [Array.from({ length: 50_001 }, () => ({ location: '{}' }))]);
  await assert.rejects(withPublishedPedestrianLocationHistory(input, config, bigquery));
  const first = await new PedestrianLocationsConnector({ client: new SnapshotClient(snapshot([row], firstTime)) })
    .collect(input);
  assert.equal(first.kind, 'success');
  if (first.kind !== 'success') throw new Error('Fixture failed');
  const encoded = { location: JSON.stringify(first.sensorLocations[0]) };
  query.mock.mockImplementation(async () => [[encoded, encoded]]);
  await assert.rejects(withPublishedPedestrianLocationHistory(input, config, bigquery), /Duplicate sensor location interval/);
  query.mock.mockImplementation(async () => { throw new Error('Unexpected query'); });
  const other = { ...input, sourceId: 'melbourne.pedestrian.hourly' };
  assert.equal(await withPublishedPedestrianLocationHistory(other, config, bigquery), other);
});

test('a snapshot cannot overwrite newer published sensor revision or observation evidence', async () => {
  const first = await new PedestrianLocationsConnector({ client: new SnapshotClient(snapshot([row], secondTime, secondTime)) })
    .collect(input);
  assert.equal(first.kind, 'success');
  if (first.kind !== 'success') throw new Error('Fixture failed');
  for (const page of [snapshot([{ ...row, longitude: 144.97 }], firstTime),
    snapshot([{ ...row, longitude: 144.97 }], thirdTime, firstTime),
    snapshot([{ ...row, longitude: 144.97 }], thirdTime)]) {
    const result = await new PedestrianLocationsConnector({ previousLocations: first.sensorLocations,
      client: new SnapshotClient(page) }).collect(input);
    assert.equal(result.kind, 'failure');
    if (result.kind !== 'failure') throw new Error('Regressed evidence was accepted');
    assert.match(result.message, /precedes published history/);
    assert.equal('sensorLocations' in result, false, 'Rejected revision exposes no publishable closure bundle');
  }
  assert.equal(first.sensorLocations[0]?.valid_to, null);
});
