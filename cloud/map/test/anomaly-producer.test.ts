import assert from 'node:assert/strict';
import test from 'node:test';

import { parseViewportQuery } from '@melens/shared/contracts/map-contract';
import { MapQueryError } from '@melens/shared/query/query-runner';
import { consumeVerifiedAnomalyBatch, createAnomalyLayerLoader, type VerifiedAnomalyBatch } from '@melens/shared/query/anomalies';
import { createViewAnomalyProducer } from '@melens/shared/query/anomaly-producer';
import type { PublicSourceReference } from '@melens/shared/query/adapter-common';
import type { SourceCoverageSnapshot } from '@melens/shared/query/source-coverage';

const sourceId = 'melens.anomaly.replay';
const references = new Map<string, PublicSourceReference>([[sourceId, { sourceId, url: 'https://data.melbourne.vic.gov.au/explore/dataset/x/',
  attribution: 'Melens replay of City of Melbourne pedestrian counts', versionRef: null }]]);
const request = parseViewportQuery({ requestId: 'replay-test', bbox: [144.9, -37.9, 145.0, -37.7], zoom: 15, mode: 'current',
  layers: ['anomaly'], window: { from: '2026-10-15T04:45:00Z', to: '2026-10-15T05:00:00Z' } });
const limits = { rowLimit: 100, resultBudgetBytes: 1_000_000 };

function row(overrides: Record<string, unknown> = {}) {
  return { result_id: 'replay-1-2025092702', source_id: sourceId, batch_id: 'batch_replay_new', sensor_id: '1', sensor_name: 'Birrarung Marr - COM - Pole 1109',
    lat: -37.8194, lon: 144.9706, window_from: '2025-09-27T02:00:00Z', window_to: '2025-09-27T03:00:00Z', observation_id: 'obs-1',
    baseline_definition_id: 'same-hour-prev-7d-mean-v1', baseline_value: 616.43, observed_value: 8880, delta: 8263.57, direction: 'higher',
    classification: 'anomalous', is_replay: true, replay_label: 'Replay of 27 Sep 2025 (AFL Grand Final day)',
    location_evidence: 'City of Melbourne sensor locations', published_at: '2026-10-15T04:00:00Z', ...overrides };
}
const producerOver = (rows: unknown[], kind: 'complete' | 'partial' = 'complete') => createViewAnomalyProducer({ references,
  runQuery: async () => ({ kind, rows }) as never });
function coverage(overrides: Record<string, unknown> = {}): SourceCoverageSnapshot {
  return { completeness: 'complete', sources: [{ sourceId, topic: 'anomaly', scope: 'city', coverageAreaRefs: ['com_municipal:1:2008-07-01'],
    coverageFrom: '2025-09-26T14:00:00Z', coverageTo: null, licenseStatus: 'verified_open', accessStatus: 'active', admitted: true,
    healthState: 'healthy_versioned', publishedBatchId: 'batch_replay_new', publishedAt: '2026-10-15T04:00:00Z',
    publishedWindow: { from: '2025-09-26T14:00:00Z', to: '2025-09-27T14:00:00Z' }, publishedOutputCount: 1, evidenceState: 'verified', ...overrides }] };
}
const readBatch = async (rows: unknown[]) => await producerOver(rows).read(request, limits) as VerifiedAnomalyBatch;
const errorCode = (code: MapQueryError['code']) => (error: unknown) => error instanceof MapQueryError && error.code === code;

test('a replay result is served with its historical window, a Replay title and the replay label in its attribution', async () => {
  const batch = await readBatch([row()]);
  const consumed = consumeVerifiedAnomalyBatch(batch, { request, coverage: coverage(), ...limits });
  const [item] = consumed.items;
  assert.equal(item?.id, 'anomaly:replay-1-2025092702');
  assert.equal(item?.title, 'Replay · Birrarung Marr - COM - Pole 1109');
  assert.equal(item?.details.window.from, '2025-09-27T02:00:00.000Z');
  assert.equal(item?.details.observedValue, 8880);
  assert.match(item?.sources[0]?.attribution ?? '', /AFL Grand Final day/);
  assert.equal(item?.sources[0]?.versionRef, 'batch_replay_new');
  assert.equal(consumed.totalMatching, 1);
});

test('the layer loader reports the replay results as available', async () => {
  const loader = createAnomalyLayerLoader({ producer: producerOver([row()]) });
  const loaded = await loader(request, 'anomaly', coverage(), limits);
  assert.equal(loaded.result.state, 'available');
  assert.equal(loaded.result.items.length, 1);
  assert.deepEqual(loaded.result.sourceIds, [sourceId]);
});

test('only the latest published batch of a source is offered, because that is the batch coverage certifies', async () => {
  const older = row({ result_id: 'old', batch_id: 'batch_replay_old', published_at: '2026-10-14T04:00:00Z' });
  const batch = await readBatch([older, row()]);
  assert.deepEqual(batch.records.map((record) => record.item.id), ['anomaly:replay-1-2025092702']);
  assert.deepEqual(batch.publicationProofs, [{ sourceId, publishedBatchId: 'batch_replay_new', publishedAt: '2026-10-15T04:00:00.000Z' }]);
});

test('a result of a source with no reviewed reference is dropped', async () => {
  const batch = await readBatch([row({ source_id: 'unreviewed.source' })]);
  assert.equal(batch.records.length, 0);
});

test('a replay cannot hide: mixing replay and live rows, a missing Replay title, or a stale publication is refused', async () => {
  await assert.rejects(producerOver([row(), row({ result_id: 'live', is_replay: false })]).read(request, limits), errorCode('serviceUnavailable'));
  const batch = await readBatch([row()]) as { records: { item: { title: string } }[] };
  batch.records[0]!.item.title = 'Birrarung Marr';
  assert.throws(() => consumeVerifiedAnomalyBatch(batch, { request, coverage: coverage(), ...limits }), errorCode('serviceUnavailable'));
  const fresh = await readBatch([row()]);
  assert.throws(() => consumeVerifiedAnomalyBatch(fresh, { request, coverage: coverage({ publishedBatchId: 'another' }), ...limits }), errorCode('notAvailable'));
});

test('a live result still has to lie inside the requested window', async () => {
  const live = row({ is_replay: false, replay_label: null, window_from: '2026-10-15T03:00:00Z', window_to: '2026-10-15T04:00:00Z' });
  const batch = await readBatch([live]);
  assert.equal(batch.replay, false);
  assert.throws(() => consumeVerifiedAnomalyBatch(batch, { request, coverage: coverage(), ...limits }), errorCode('serviceUnavailable'));
});

test('a failing anomaly read makes only that layer unavailable, and a cancelled read still cancels', async () => {
  const { failSoftAnomalyLayerLoader } = await import('@melens/shared/query/anomalies');
  const broken = failSoftAnomalyLayerLoader(createAnomalyLayerLoader({ producer: createViewAnomalyProducer({ references,
    runQuery: async () => { throw new MapQueryError('serviceUnavailable'); } }) }));
  const loaded = await broken(request, 'anomaly', coverage(), limits);
  assert.equal(loaded.result.state, 'unavailable');
  assert.equal(loaded.result.items.length, 0);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(broken(request, 'anomaly', coverage(), { ...limits, signal: controller.signal }));
});
