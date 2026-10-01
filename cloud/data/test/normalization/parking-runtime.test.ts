import assert from 'node:assert/strict';
import test from 'node:test';

import { ParkingSensorsConnector, SOURCE_ID } from '../../src/connectors/com_parking_sensors/index.js';
import { parseConnectorInput, type ConnectorSuccess } from '../../src/core/connector.js';
import type { DataConfig } from '../../src/core/config.js';
import { OpenDataSoftClient, type OdsRecords } from '../../src/core/opendatasoft.js';
import { assembleParkingRuntime, parkingRuntimeHistorySchema, withPublishedParkingState,
  type ParkingHistoryReader, type ParkingRuntimeHistoryEntry } from '../../src/normalization/parking-runtime.js';
import { parseSourceRecord } from '../../src/validation/record.js';

const initial = '2026-10-01T10:00:00.000Z';
const later = '2026-10-01T10:02:00.000Z';
const observed = '2026-09-30T09:00:00.000Z';
const row = { kerbsideid: 42, lastupdated: initial, status_timestamp: observed,
  status_description: 'Unoccupied', zone_number: 7, location: { lat: -37.81, lon: 144.96 } };
class SnapshotClient extends OpenDataSoftClient {
  constructor(private readonly snapshot: OdsRecords) { super(); }
  override async fetchRecords(): Promise<OdsRecords> { return this.snapshot; }
}
async function collect(rows: unknown[], fetchedAt = initial, runId = 'initial'): Promise<ConnectorSuccess> {
  const result = await new ParkingSensorsConnector(new SnapshotClient({ records: rows,
    totalCount: rows.length, pageCount: 1, fetchedAt, lastModified: null }))
    .collect(parseConnectorInput({ sourceId: SOURCE_ID, runId,
      window: { kind: 'snapshot', revision: fetchedAt }, checkpoint: null }));
  if (result.kind !== 'success') throw new Error('Parking fixture collection failed');
  return result;
}
const normalize = (input: Omit<Parameters<typeof assembleParkingRuntime>[0], 'licenseStatus'>) =>
  assembleParkingRuntime({ ...input, licenseStatus: 'verified_open' });

function history(result: ReturnType<typeof assembleParkingRuntime>): ParkingRuntimeHistoryEntry[] {
  return result.parkingSensorMemberships.map(member => ({ sensor_id: member.sensor_id,
    business_source_record_id: member.business_source_record_id,
    business_state_hash: member.business_state_hash,
    business_version_id: member.business_version_id, business_batch_id: 'published-initial' }));
}

test('new cold parking runs append changed business facts and preserve complete membership and upstream clocks', async () => {
  const first = normalize({ result: await collect([row]), history: [] });
  assert.equal(first.sourceRecords.length, 2);
  assert.equal(first.parkingObservations.length, 1);
  assert.equal(first.parkingSensorMemberships.length, 1);
  assert.equal(first.parkingSensorMemberships[0]?.source_updated_at, initial);
  assert.equal(first.sourceRecords[0]?.source_updated_at, initial);
  assert.equal(first.parkingSensorMemberships[0]?.business_batch_id, 'initial');
  for (const record of first.sourceRecords) assert.deepEqual(parseSourceRecord(record), record);
  const unchanged = normalize({ result: await collect([{ ...row, lastupdated: later }], later, 'later'),
    history: history(first) });
  assert.equal(unchanged.sourceRecords.length, 1, 'An unchanged read appends only the complete snapshot proof');
  assert.equal(unchanged.geoRecords.length, 0);
  assert.equal(unchanged.geoRecordSources.length, 0);
  assert.equal(unchanged.parkingObservations.length, 0);
  assert.equal(unchanged.parkingSensorMemberships.length, 1);
  assert.equal(unchanged.parkingSensorMemberships[0]?.business_batch_id, 'published-initial');
  assert.equal(unchanged.parkingSensorMemberships[0]?.business_version_id,
    first.parkingSensorMemberships[0]?.business_version_id);
  assert.equal(unchanged.parkingSensorMemberships[0]?.source_updated_at, later);
  assert.notEqual(unchanged.sourceRevision, first.sourceRevision);
  const changed = normalize({ result: await collect([{ ...row, lastupdated: later,
    status_description: 'Present', status_timestamp: later }], later, 'changed'), history: history(first) });
  assert.equal(changed.parkingObservations[0]?.occupied, true);
  assert.equal(changed.parkingSensorMemberships[0]?.business_batch_id, 'changed');
  assert.notEqual(changed.parkingSensorMemberships[0]?.business_version_id,
    first.parkingSensorMemberships[0]?.business_version_id);
});

test('a location returning to its earlier position creates a new immutable generation', async () => {
  const first = normalize({ result: await collect([row]), history: [] });
  const moved = normalize({ result: await collect([{ ...row, lastupdated: later,
    location: { lat: -37.82, lon: 144.97 } }], later, 'moved'), history: history(first) });
  const returned = normalize({ result: await collect([{ ...row,
    lastupdated: '2026-10-01T10:04:00.000Z' }], '2026-10-01T10:04:00.000Z', 'returned'), history: history(moved) });
  assert.equal(first.parkingSensorMemberships[0]?.business_state_hash,
    returned.parkingSensorMemberships[0]?.business_state_hash);
  assert.notEqual(first.parkingSensorMemberships[0]?.business_version_id,
    returned.parkingSensorMemberships[0]?.business_version_id);
  assert.equal(returned.parkingObservations[0]?.observed_at, observed);
  assert.equal(returned.sourceRecords[0]?.source_updated_at, '2026-10-01T10:04:00.000Z');
});

test('sensor location and zone changes create business versions; heartbeat time alone does not', async () => {
  const first = normalize({ result: await collect([row]), history: [] });
  for (const changed of [{ ...row, location: { lat: -37.82, lon: 144.97 } }, { ...row, zone_number: 8 }]) {
    const next = normalize({ result: await collect([changed], later, 'changed'), history: history(first) });
    assert.equal(next.geoRecords.length, 1);
    assert.notEqual(next.parkingSensorMemberships[0]?.business_version_id,
      first.parkingSensorMemberships[0]?.business_version_id);
  }
});

test('empty snapshots have distinct confirmation proofs and absent sensors never acquire vacancy', async () => {
  const first = normalize({ result: await collect([row]), history: [] });
  const gone = normalize({ result: await collect([], later, 'empty'), history: history(first) });
  assert.equal(gone.parkingSensorMemberships.length, 0);
  assert.equal(gone.sourceRecords.length, 1);
  assert.equal(gone.parkingObservations.length, 0);
  const repeated = normalize({ result: await collect([], '2026-10-01T10:04:00.000Z', 'empty-later'),
    history: [] });
  assert.notEqual(gone.sourceRevision, repeated.sourceRevision);
});

test('undated statuses preserve membership and official position with no fabricated observation time', async () => {
  const result = normalize({ result: await collect([{ ...row, status_timestamp: null }]), history: [] });
  assert.equal(result.parkingSensorMemberships.length, 1);
  assert.equal(result.geoRecords.length, 1);
  assert.equal(result.parkingObservations.length, 0);
  assert.equal(result.sourceRecords[0]?.observed_at, null);
  assert.equal(result.sourceRecords[0]?.source_updated_at, initial);
});

test('ambiguous published history and incomplete snapshots cannot produce a publication candidate', async () => {
  const first = normalize({ result: await collect([row]), history: [] });
  const current = history(first);
  assert.throws(() => parkingRuntimeHistorySchema.parse([...current, ...current]), /Multiple published current versions/);
  assert.throws(() => normalize({ result: { ...first, sourceRecords: [] }, history: [] }), /all source facts/);
});

const config: DataConfig = { projectId: 'melens-fixture', region: 'australia-southeast2',
  bucketName: 'fixture', ingestDataset: 'melens_ingest', queryDataset: 'melens_query',
  maxBytesBilled: '100000000', secretNames: [] };

function fixtureReader(responses: readonly unknown[]) {
  const calls: Parameters<ParkingHistoryReader['query']>[0][] = [];
  const reader: ParkingHistoryReader = { async query(options) {
    calls.push(options);
    assert.ok(calls.length <= responses.length, 'The runtime must not submit an unexpected unbounded query');
    return [responses[calls.length - 1]];
  } };
  return { reader, calls };
}
const latest = (input = '1', output = input) => [{ batch_id: 'published-snapshot',
  source_revision: 'snapshot-revision', input_count: input, output_count: output }];
const recovered = (rows: readonly ParkingRuntimeHistoryEntry[], proof = '1', members = String(rows.length)) =>
  [{ proof_count: proof, member_count: members, history: rows }];

test('a fresh process reads only the constant latest snapshot and its exact published business references', async () => {
  const first = normalize({ result: await collect([row]), history: [] });
  const { reader, calls } = fixtureReader([latest(), recovered(history(first))]);
  const next = await withPublishedParkingState(await collect([{ ...row, lastupdated: later }], later, 'later'),
    config, reader);
  assert.equal(next.geoRecords.length, 0);
  assert.equal(next.parkingObservations.length, 0);
  assert.equal(next.sourceRecords.length, 1);
  assert.equal(next.parkingSensorMemberships?.length, 1);
  assert.equal(next.parkingSensorMemberships?.[0]?.business_batch_id, 'published-initial');
  assert.equal(calls.length, 2);
  const discovery = calls[0];
  const state = calls[1];
  assert.ok(discovery && state);
  assert.match(discovery.query, /state = 'published' AND published_at IS NOT NULL/);
  assert.match(discovery.query, /ORDER BY started_at DESC, batch_id DESC LIMIT 1/);
  assert.deepEqual(discovery.params, { sourceId: SOURCE_ID });
  assert.match(state.query, /WHERE source_id = @sourceId AND batch_id = @batchId/);
  assert.match(state.query, /p\.version_id = m\.snapshot_version_id/);
  assert.match(state.query, /r\.version_id = m\.business_version_id/);
  assert.match(state.query, /r\.status_variants = 1/);
  assert.match(state.query, /LIMIT 50001/);
  assert.doesNotMatch(state.query, /v_parking_sensor_current|geo_records|parking_observations|data_sources/);
  assert.doesNotMatch(state.query, /CURRENT_TIMESTAMP|INTERVAL 24 HOUR/);
  assert.deepEqual(state.params, { sourceId: SOURCE_ID, batchId: 'published-snapshot',
    sourceRevision: 'snapshot-revision' });
  assert.ok(calls.every(call => call.maximumBytesBilled === '100000000'
    && call.location === 'australia-southeast2'));
  await assert.rejects(withPublishedParkingState(await collect([row]), { ...config, maxBytesBilled: null }, reader),
    /billed-byte ceiling/);
});

test('cold storage without a published batch creates initial business facts without scanning membership', async () => {
  const { reader, calls } = fixtureReader([[]]);
  const result = await withPublishedParkingState(await collect([row]), config, reader);
  assert.equal(result.geoRecords.length, 1);
  assert.equal(result.sourceRecords.length, 2);
  assert.equal(result.parkingSensorMemberships?.[0]?.business_batch_id, 'initial');
  assert.equal(calls.length, 1);
});

test('an old or publicly hidden complete snapshot can restore exact references without a public-view fallback', async () => {
  const first = normalize({ result: await collect([row]), history: [] });
  const { reader, calls } = fixtureReader([latest(), recovered(history(first))]);
  const result = await withPublishedParkingState(await collect([{ ...row, lastupdated: later }], later, 'restored'),
    config, reader);
  assert.equal(result.geoRecords.length, 0);
  assert.equal(result.parkingSensorMemberships?.[0]?.business_batch_id, 'published-initial');
  assert.equal(result.sourceRecords[0]?.rights_status, 'verified_open');
  assert.equal(calls.length, 2);
});

test('a verified latest empty snapshot cannot revive previous members on restart', async () => {
  const { reader, calls } = fixtureReader([latest('0'), recovered([])]);
  const result = await withPublishedParkingState(await collect([row], later, 'reappeared'), config, reader);
  assert.equal(result.geoRecords.length, 1);
  assert.equal(result.parkingSensorMemberships?.[0]?.business_batch_id, 'reappeared');
  assert.equal(calls.length, 2, 'There must be no query searching for an older nonempty snapshot');
});

test('latest snapshot omissions append only reappearing business facts instead of resurrecting an omitted cached member', async () => {
  const first = normalize({ result: await collect([row]), history: [] });
  const { reader } = fixtureReader([latest(), recovered(history(first))]);
  const result = await withPublishedParkingState(await collect([{ ...row, lastupdated: later },
    { ...row, kerbsideid: 43, lastupdated: later }], later, 'reappeared'), config, reader);
  assert.equal(result.geoRecords.length, 1);
  assert.equal(result.geoRecords[0]?.geo_record_id, `${SOURCE_ID}:kerbside:43`);
  assert.equal(result.parkingSensorMemberships?.find(member => member.sensor_id === 'kerbside:42')?.business_batch_id,
    'published-initial');
  assert.equal(result.parkingSensorMemberships?.find(member => member.sensor_id === 'kerbside:43')?.business_batch_id,
    'reappeared');
});

test('missing or withdrawn proof and business facts are rejected rather than interpreted as a complete empty cache', async () => {
  const first = normalize({ result: await collect([row]), history: [] });
  for (const response of [recovered(history(first), '0'), recovered(history(first), '2'),
    recovered(history(first), '1', '0'), recovered([], '1', '1')]) {
    const { reader } = fixtureReader([latest(), response]);
    await assert.rejects(withPublishedParkingState(await collect([row]), config, reader),
      /proof or exact business references are incomplete/);
  }
  const missingEmptyProof = fixtureReader([latest('0'), recovered([], '0')]);
  await assert.rejects(withPublishedParkingState(await collect([row]), config, missingEmptyProof.reader),
    /proof or exact business references are incomplete/);
  const unequalCounts = fixtureReader([latest('2', '1')]);
  await assert.rejects(withPublishedParkingState(await collect([row]), config, unequalCounts.reader),
    /account for every input sensor/);
  assert.equal(unequalCounts.calls.length, 1);
});

test('malformed or ambiguous persisted membership cannot bypass bounded history validation', async () => {
  const first = normalize({ result: await collect([row]), history: [] });
  const current = history(first);
  const ambiguous = fixtureReader([latest('2'), recovered([...current, ...current])]);
  await assert.rejects(withPublishedParkingState(await collect([row]), config, ambiguous.reader),
    /Multiple published current versions/);
  const malformed = fixtureReader([latest(), recovered(current.map(entry => ({ ...entry,
    business_source_record_id: 'unexpected-source-record' })))]);
  await assert.rejects(withPublishedParkingState(await collect([row]), config, malformed.reader),
    /Unexpected parking business record identity/);
});

test('query failure preserves a secret-free diagnostic and never manufactures new history', async () => {
  const reader: ParkingHistoryReader = { async query() {
    throw new Error('Synthetic bounded history query failed', { cause: 'unprinted SDK request' });
  } };
  await assert.rejects(withPublishedParkingState(await collect([row]), config, reader), error => {
    assert.ok(error instanceof Error);
    assert.equal(error.message, 'Synthetic bounded history query failed');
    assert.equal(error.cause, undefined);
    return true;
  });
});
