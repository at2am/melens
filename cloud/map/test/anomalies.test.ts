import assert from 'node:assert/strict';
import test from 'node:test';

import { mapItemSchema, normalizedViewportIdentity, parseViewportQuery, type MapItem }
  from '../src/contracts/map-contract.js';
import {
  anomalyCatalogAssessment, consumeVerifiedAnomalyBatch, createAnomalyLayerLoader,
  type VerifiedAnomalyBatch,
} from '../src/query/anomalies.js';
import { MapQueryError } from '../src/query/query-runner.js';
import type { SourceCoverageSnapshot } from '../src/query/source-coverage.js';
import { createDetailService } from '../src/services/details.js';
import { createSnapshotStore, MapServiceError } from '../src/services/snapshot-store.js';
import { createViewportService } from '../src/services/viewport.js';

const request = parseViewportQuery({ requestId: 'test-anomaly', bbox: [144.95, -37.83, 145, -37.8],
  zoom: 16, mode: 'current', layers: ['anomaly'],
  window: { from: '2026-10-01T00:00:00Z', to: '2026-10-01T01:00:00Z' } });
const window = { from: '2026-10-01T00:59:00Z', to: '2026-10-01T01:00:00Z' };
const limits = { rowLimit: 10, resultBudgetBytes: 100_000 };
const sourceId = 'verified.anomaly.producer';
function coverage(): SourceCoverageSnapshot {
  return { completeness: 'complete', sources: [{ sourceId, topic: 'anomaly', scope: 'melbourne',
    coverageAreaRefs: ['official.melbourne'], coverageFrom: request.window.from, coverageTo: request.window.to,
    licenseStatus: 'verified_open', accessStatus: 'active', admitted: true, healthState: 'current',
    publishedBatchId: 'published-batch-1', publishedAt: '2026-10-01T01:01:00Z',
    publishedWindow: request.window, publishedOutputCount: 1, evidenceState: 'verified' }] };
}
function item(): Extract<MapItem, { kind: 'anomaly' }> {
  const parsed = mapItemSchema.parse({ id: 'anomaly-result-1', versionId: 'result-version-1',
    layerId: 'anomaly', kind: 'anomaly', title: 'Verified producer sensor result',
    geometry: { type: 'Point', coordinates: [144.967, -37.818] },
    location: { precision: 'point', role: 'sensor', evidence: 'Published effective sensor coordinates' },
    assertionKind: 'observation', lifecycle: 'active',
    time: { observedAt: window.from, reportedAt: null, validFrom: window.from, validTo: window.to,
      fetchedAt: '2026-10-01T01:01:00Z', periodLabel: null, sourceTimeText: null, sourceTimezone: null },
    sources: [{ sourceId, url: 'https://example.org/public/anomaly-result-1',
      attribution: 'Reviewed public anomaly producer', versionRef: 'result-version-1' }],
    details: { resultId: 'result-1', sensorId: 'sensor-1', observationId: 'observation-1', window,
      baselineDefinitionId: 'producer-baseline-7d-v1', baselineValue: 20, observedValue: 30,
      delta: 10, direction: 'higher', eligibility: 'eligible', classification: 'anomalous' },
  });
  assert.equal(parsed.kind, 'anomaly');
  if (parsed.kind !== 'anomaly') throw new Error('Test item is not an anomaly');
  return parsed;
}
function batch(): VerifiedAnomalyBatch {
  return { verification: 'verifiedPublic', dataMode: 'live',
    queryIdentity: normalizedViewportIdentity(request),
    publicationProofs: [{ sourceId, publishedBatchId: 'published-batch-1', publishedAt: '2026-10-01T01:01:00Z' }],
    records: [{ item: item(), evidence: { resultId: 'result-1', observationId: 'observation-1',
      baselineDefinitionId: 'producer-baseline-7d-v1', observationWindow: window,
      baselineAppliesToWindow: window, sourceIds: [sourceId] } }],
    completeness: 'complete', totalMatching: 1, unresolvedCount: 0 };
}
function consume(value: unknown, snapshot = coverage()) {
  return consumeVerifiedAnomalyBatch(value, { request, coverage: snapshot, ...limits });
}
function errorCode(code: MapQueryError['code']) {
  return (error: unknown) => error instanceof MapQueryError && error.code === code;
}

test('no configured producer means unavailable even with healthy source registry metadata', async () => {
  const result = await createAnomalyLayerLoader()(request, 'anomaly', coverage(), limits);
  assert.equal(result.result.state, 'unavailable');
  assert.equal(result.result.totalMatching, null);
  assert.equal(result.result.unresolvedCount, null);
  assert.equal(result.result.observedWindow, null);
  assert.equal(result.result.coverage.state, 'unknown');
  assert.deepEqual(result.result.items, []);
  assert.deepEqual(result.result.sourceIds, []);
  const catalog = anomalyCatalogAssessment({ coverage: coverage(), producerConfigured: false });
  assert.equal(catalog.availability, 'unavailable');
  assert.equal(catalog.freshness, 'unknown');
});

test('verified public producer values are consumed exactly with no threshold or delta recomputation', async () => {
  const supplied = batch();
  const row = supplied.records[0]!;
  if (row.item.kind !== 'anomaly') throw new Error('Test type');
  row.item.details.baselineValue = 20.123456789;
  row.item.details.observedValue = 30.000000001;
  row.item.details.delta = 4.7654321;
  row.item.details.direction = 'lower';
  const result = await createAnomalyLayerLoader({ producer: { async read() { return supplied; } } })(
    request, 'anomaly', coverage(), limits);
  assert.equal(result.result.state, 'available');
  assert.deepEqual(result.result.items[0], row.item);
  assert.deepEqual(result.result.observedWindow, window);
  assert.equal(result.result.totalMatching, 1);
});

test('malformed producer, missing baseline and classified missing observation fail safely', () => {
  assert.throws(() => consume({ records: [] }), errorCode('serviceUnavailable'));
  for (const field of ['baselineDefinitionId', 'baselineValue', 'observedValue', 'delta', 'observationId'] as const) {
    const supplied = batch();
    const row = supplied.records[0]!;
    if (row.item.kind !== 'anomaly') throw new Error('Test type');
    row.item.details[field] = null;
    assert.throws(() => consume(supplied), errorCode('serviceUnavailable'));
  }
});

test('unknown and ineligible values remain unclassified, never zero or normal activity', () => {
  const supplied = batch();
  const row = supplied.records[0]!;
  if (row.item.kind !== 'anomaly') throw new Error('Test type');
  Object.assign(row.item.details, { observationId: null, baselineDefinitionId: null,
    baselineValue: null, observedValue: null, delta: null, direction: 'unknown',
    eligibility: 'ineligible', classification: 'unclassified' });
  Object.assign(row.evidence, { observationId: null, baselineDefinitionId: null,
    observationWindow: null, baselineAppliesToWindow: null });
  const result = consume(supplied).items[0]!;
  assert.equal(result.details.observedValue, null);
  assert.equal(result.details.classification, 'unclassified');
  assert.equal(result.details.eligibility, 'ineligible');
});

test('sample, unverified and mismatched query contexts are rejected', () => {
  for (const patch of [{ dataMode: 'sample' }, { verification: 'unverified' },
    { queryIdentity: '0'.repeat(64) }]) {
    assert.throws(() => consume({ ...batch(), ...patch }), errorCode('serviceUnavailable'));
  }
  const historical = { ...request, mode: 'historical' as const };
  assert.throws(() => consumeVerifiedAnomalyBatch(batch(), {
    request: historical, coverage: coverage(), ...limits,
  }), errorCode('serviceUnavailable'));
});

test('result, observation and baseline must share the exact evaluation window', () => {
  for (const field of ['observationWindow', 'baselineAppliesToWindow'] as const) {
    const supplied = batch();
    supplied.records[0]!.evidence[field] = { ...window, from: '2026-10-01T00:59:00.000001Z' };
    assert.throws(() => consume(supplied), errorCode('serviceUnavailable'));
  }
  const supplied = batch();
  const row = supplied.records[0]!;
  if (row.item.kind !== 'anomaly') throw new Error('Test type');
  row.item.time.validTo = '2026-10-01T01:00:00.000001Z';
  assert.throws(() => consume(supplied), errorCode('serviceUnavailable'));
  row.item.time.validTo = window.to;
  row.item.details.window = { ...window, to: '2026-10-01T01:00:00.000001Z' };
  assert.throws(() => consume(supplied), errorCode('serviceUnavailable'));
});

test('baseline and result identifiers cannot be mismatched by a producer wrapper', () => {
  for (const field of ['resultId', 'observationId', 'baselineDefinitionId'] as const) {
    const supplied = batch();
    supplied.records[0]!.evidence[field] = 'wrong-identity';
    assert.throws(() => consume(supplied), errorCode('serviceUnavailable'));
  }
});

test('equivalent UTC fractions compare exactly and observation time remains linked', () => {
  const supplied = batch();
  supplied.records[0]!.evidence.observationWindow = {
    from: `${window.from.slice(0, -1)}.000000Z`, to: `${window.to.slice(0, -1)}.000Z`,
  };
  assert.equal(consume(supplied).items.length, 1);
  supplied.records[0]!.item.time.observedAt = '2026-10-01T00:59:00.000001Z';
  assert.throws(() => consume(supplied), errorCode('serviceUnavailable'));
});

test('a publication cannot certify an observation window ending after it was published', () => {
  const supplied = batch();
  supplied.publicationProofs[0]!.publishedAt = '2026-10-01T00:59:30Z';
  const snapshot = coverage();
  assert.throws(() => consume(supplied, { ...snapshot,
    sources: [{ ...snapshot.sources[0]!, publishedAt: '2026-10-01T00:59:30Z' }],
  }), errorCode('serviceUnavailable'));
});

test('withdrawn item, withdrawn source and changed publication are not publicly available', () => {
  const supplied = batch();
  supplied.records[0]!.item.lifecycle = 'withdrawn';
  assert.throws(() => consume(supplied), errorCode('notAvailable'));
  const denied = coverage();
  const deniedSource = denied.sources[0]!;
  assert.throws(() => consume(batch(), { ...denied,
    sources: [{ ...deniedSource, admitted: false, accessStatus: 'paused' }] }), errorCode('notAvailable'));
  assert.throws(() => consume(batch(), { ...denied,
    sources: [{ ...deniedSource, publishedBatchId: 'new-publication' }] }), errorCode('notAvailable'));
});

test('every output source requires a current public publication and version reference', () => {
  const supplied = batch();
  supplied.records[0]!.item.sources[0]!.versionRef = null;
  assert.throws(() => consume(supplied), errorCode('notAvailable'));
  const unknown = batch();
  unknown.records[0]!.evidence.sourceIds = ['private.unknown'];
  assert.throws(() => consume(unknown), errorCode('notAvailable'));
  const snapshot = coverage();
  assert.throws(() => consume(batch(), { ...snapshot,
    sources: [{ ...snapshot.sources[0]!, topic: 'pedestrian' }] }), errorCode('notAvailable'));
});

test('out-of-bounds coordinates are rejected; null geometry remains unlocated', () => {
  const supplied = batch();
  supplied.records[0]!.item.geometry = { type: 'Point', coordinates: [145.9, -37.818] };
  assert.throws(() => consume(supplied), errorCode('serviceUnavailable'));
  supplied.records[0]!.item.geometry = null;
  supplied.records[0]!.item.location = { precision: 'unlocated', role: 'sensor', evidence: null };
  supplied.totalMatching = 0;
  supplied.unresolvedCount = 1;
  const result = consume(supplied);
  assert.equal(result.items.length, 0);
  assert.equal(result.unlocatedItems.length, 1);
  assert.equal(result.verifiedUnresolvedCount, 1);
});

test('empty verified results remain unknown until T011 verifies whole request coverage', async () => {
  const supplied = { ...batch(), records: [], totalMatching: 0 };
  const producer = { async read() { return supplied; } };
  const unknown = await createAnomalyLayerLoader({ producer })(request, 'anomaly', coverage(), limits);
  assert.equal(unknown.result.state, 'unknown');
  assert.equal(unknown.result.totalMatching, null);
  const verified = await createAnomalyLayerLoader({ producer, resolveArea: () => 'contains' })(
    request, 'anomaly', coverage(), limits);
  assert.equal(verified.result.state, 'noMatching');
  const unresolved = await createAnomalyLayerLoader({
    producer: { async read() { return { ...supplied, unresolvedCount: null }; } }, resolveArea: () => 'contains',
  })(request, 'anomaly', coverage(), limits);
  assert.equal(unresolved.result.state, 'unknown');
});

test('partial batches cannot claim exact totals or satisfy noMatching', async () => {
  const supplied = { ...batch(), completeness: 'partial' as const };
  assert.throws(() => consume(supplied), errorCode('serviceUnavailable'));
  supplied.totalMatching = null;
  const result = consume(supplied);
  assert.equal(result.completeness, 'partial');
  assert.equal(result.totalMatching, null);
  const empty = await createAnomalyLayerLoader({
    producer: { async read() { return { ...supplied, records: [] }; } }, resolveArea: () => 'contains',
  })(request, 'anomaly', coverage(), limits);
  assert.equal(empty.result.state, 'unknown');
});

test('producer output obeys service row and byte bounds instead of silently truncating', () => {
  assert.throws(() => consumeVerifiedAnomalyBatch(batch(), {
    request, coverage: coverage(), ...limits, rowLimit: 0,
  }), errorCode('budgetExceeded'));
  assert.throws(() => consumeVerifiedAnomalyBatch(batch(), {
    request, coverage: coverage(), ...limits, resultBudgetBytes: 100,
  }), errorCode('budgetExceeded'));
});

test('the canonical output drops private extra item fields while proof metadata is strict', () => {
  const supplied = batch();
  const value = {
    ...supplied,
    records: [{ ...supplied.records[0]!, item: { ...supplied.records[0]!.item,
      providerPayload: { privateThreshold: 900 }, internalJobId: 'private-job' } }],
  };
  const encoded = JSON.stringify(consume(value).items);
  assert.equal(encoded.includes('providerPayload'), false);
  assert.equal(encoded.includes('private-job'), false);
  assert.throws(() => consume({ ...supplied, privateToken: 'private' }), errorCode('serviceUnavailable'));
});

test('reader failures use canonical errors without exposing producer payloads or raw exceptions', async () => {
  const loader = createAnomalyLayerLoader({ producer: { async read() {
    throw new Error('Private provider evidence, SQL, credentials');
  } } });
  await assert.rejects(loader(request, 'anomaly', coverage(), limits), (error: unknown) => {
    assert.ok(error instanceof MapQueryError);
    assert.equal(error.code, 'serviceUnavailable');
    assert.equal(error.message.includes('Private'), false);
    return true;
  });
});

test('T014 snapshot service returns default unavailable anomaly without a rights bypass', async () => {
  const service = createViewportService({ store: createSnapshotStore(),
    readCoverage: async () => coverage(), loadLayer: createAnomalyLayerLoader() });
  const response = await service.query(request);
  assert.equal(response.dataMode, 'live');
  assert.equal(response.layers[0]!.state, 'unavailable');
  assert.equal(response.layers[0]!.items.length, 0);
});

test('T014 verified anomaly snapshots require an independent current record-rights checker', async () => {
  const loadLayer = createAnomalyLayerLoader({ producer: { async read() { return batch(); } } });
  const denied = createViewportService({ store: createSnapshotStore(),
    readCoverage: async () => coverage(), loadLayer });
  await assert.rejects(denied.query(request), (error: unknown) =>
    error instanceof MapServiceError && error.code === 'notAvailable');
  let recordPublic = true;
  const shared = { store: createSnapshotStore(), readCoverage: async () => coverage(),
    checkPublicRecords: async () => recordPublic };
  const accepted = await createViewportService({ ...shared, loadLayer }).query(request);
  assert.equal(accepted.layers[0]!.items.length, 1);
  const details = createDetailService(shared);
  const context = { requestId: 'anomaly-detail', snapshotId: accepted.snapshotId };
  const detail = await details.item('anomaly-result-1', context);
  assert.equal(detail.item.kind, 'anomaly');
  recordPublic = false;
  await assert.rejects(details.item('anomaly-result-1', context), (error: unknown) =>
    error instanceof MapServiceError && error.code === 'notAvailable');
});
