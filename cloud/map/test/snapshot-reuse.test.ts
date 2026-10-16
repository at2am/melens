import assert from 'node:assert/strict';
import test from 'node:test';

import { SNAPSHOT_TTL_MS, normalizedViewportIdentity, parseMapItem, parseViewportQuery,
  type LayerResult, type MapItem } from '@melens/shared/contracts/map-contract';
import { parseSourceCoverage } from '@melens/shared/query/source-coverage';
import { aggregateLayer } from '../src/services/aggregation.js';
import { createDetailService } from '../src/services/details.js';
import { createSnapshotStore, MapServiceError, type SnapshotStore } from '../src/services/snapshot-store.js';
import { createViewportService, type SnapshotAccess } from '../src/services/viewport.js';

const time = '2026-10-01T01:00:00Z';
const request = parseViewportQuery({ requestId: 'first', bbox: [144.95, -37.83, 144.99, -37.8],
  zoom: 14, layers: ['planning'], mode: 'current', pageSize: 1,
  window: { from: '2026-10-01T00:00:00Z', to: time } });
const source = { sourceId: 'test.planning', url: 'https://example.org/planning', attribution: 'Public source', versionRef: 'v1' };
function item(id: string): MapItem {
  return parseMapItem({ id, versionId: 'v1', layerId: 'planning', kind: 'planning', title: id,
    geometry: { type: 'Point', coordinates: [144.97, -37.81] },
    location: { precision: 'point', role: 'eventSite', evidence: 'Published coordinates' },
    assertionKind: 'plan', lifecycle: 'planned', sources: [source],
    time: { observedAt: null, reportedAt: null, validFrom: request.window.from, validTo: null,
      fetchedAt: time, periodLabel: null, sourceTimeText: null, sourceTimezone: null },
    details: { summary: 'Published plan', projectStatus: null, permitId: null } });
}
function layer(): LayerResult {
  return { layerId: 'planning', state: 'available', freshness: 'current', completeness: 'complete',
    sourceIds: [source.sourceId], coverage: { state: 'unknown', areaRefs: [], window: null, evidenceSourceIds: [] },
    observedWindow: null, updatedAt: time, items: [item('planning:one'), item('planning:two')],
    unresolvedCount: null, totalMatching: 2, nextCursor: null };
}
function input(): Parameters<SnapshotStore['create']>[0] {
  return { family: 'viewport', identity: normalizedViewportIdentity(request), request,
    selectedLayers: request.layers, sourceWatermarks: [{ sourceId: source.sourceId, batchId: 'batch1', publishedAt: time }],
    layers: [layer()], listItems: [], listCompleteness: 'complete', listTotal: null, listScope: null, groups: [] };
}
const coverage = parseSourceCoverage({ kind: 'complete', totalMatching: 1, resultBytes: 0, rows: [{
  source_id: source.sourceId, topic: 'planning', scope: 'city', coverage_area_refs: ['com:municipal'],
  coverage_from: request.window.from, coverage_to: null, license_status: 'verified_open', access_status: 'active',
  health_state: 'current', latest_published_batch_id: 'batch1', latest_published_at: time,
  latest_published_window_from: request.window.from, latest_published_window_to: time,
  latest_published_output_count: 2, coverage_evidence_state: 'verified',
}] });
function fixture(check: NonNullable<SnapshotAccess['checkPublicRecords']> = async () => true) {
  const clock = () => new Date(time);
  const store = createSnapshotStore({ clock });
  let rightsReads = 0;
  const access = { store, clock, readCoverage: async () => coverage,
    checkPublicRecords: async (...args: Parameters<typeof check>) => { rightsReads += 1; return check(...args); } };
  return { store, details: createDetailService(access), rightsReads: () => rightsReads,
    viewport: createViewportService({ ...access, loadLayer: async () => ({ result: layer() }) }) };
}
function deferred<T>() {
  let resolve: (value: T) => void = () => { throw new Error('Deferred result not initialized'); };
  let reject: (error: unknown) => void = () => { throw new Error('Deferred result not initialized'); };
  const promise = new Promise<T>((done, failed) => { resolve = done; reject = failed; });
  return { promise, resolve, reject };
}
const errorCode = (expected: string) => (error: unknown) => error instanceof MapServiceError && error.code === expected;

test('40 simultaneous identical nonparking viewports share one immutable token and still check rights every time', async () => {
  const f = fixture();
  const replies = await Promise.all(Array.from({ length: 40 }, (_, index) =>
    f.viewport.query({ ...request, requestId: `request-${index}` })));
  assert.equal(new Set(replies.map((reply) => reply.snapshotId)).size, 1);
  assert.equal(new Set(replies.map((reply) => reply.layers[0]?.nextCursor)).size, 1);
  assert.deepEqual(replies.map((reply) => reply.requestId), Array.from({ length: 40 }, (_, index) => `request-${index}`));
  assert.equal(f.rightsReads(), 40);
  assert.equal(f.store.stats().snapshots, 1);
  assert.equal(f.store.stats().cursors, 1);
  const stored = f.store.read(replies[0]!.snapshotId);
  assert.ok(Object.isFrozen(stored));
  assert.ok(Object.isFrozen(stored.layers[0]?.items));
});

test('snapshot reuse compares complete context, source watermarks, results and member payloads', () => {
  const store = createSnapshotStore({ clock: () => new Date(time) });
  const original = input();
  const first = store.createOrReuse(original);
  store.finishReuse(first.snapshot.id, { retained: true });
  const duplicate = store.createOrReuse({ ...original, request: { ...request, requestId: 'another' } });
  assert.equal(duplicate.created, false);
  assert.equal(duplicate.snapshot.id, first.snapshot.id);
  store.finishReuse(duplicate.snapshot.id, { retained: true });
  const grouped = aggregateLayer(layer(), { zoom: request.zoom, bounds: request.bbox });
  const group = [...grouped.groups.values()][0];
  assert.ok(group);
  const changed: Parameters<SnapshotStore['create']>[0][] = [
    { ...input(), identity: 'different-identity' },
    { ...input(), request: { ...request, bbox: [144.96, -37.83, 144.99, -37.8] } },
    { ...input(), request: { ...request, window: { ...request.window, from: '2026-10-01T00:01:00Z' } } },
    { ...input(), request: { ...request, mode: 'historical' } },
    { ...input(), request: { ...request, zoom: 15 } },
    { ...input(), request: { ...request, pageSize: 2 } },
    { ...input(), request: { ...request, layers: ['planning', 'event'] } },
    { ...input(), request: { ...request, boundaryFilter: { level: 'LGA', vintage: '2021' } } },
    { ...input(), selectedLayers: ['planning', 'event'] },
    { ...input(), sourceWatermarks: [{ sourceId: source.sourceId, batchId: 'batch2', publishedAt: time }] },
    { ...input(), layers: [{ ...layer(), freshness: 'late' }] },
    { ...input(), layers: [{ ...layer(), items: [{ ...item('planning:one'), versionId: 'v2' }, item('planning:two')] }] },
    { ...input(), layers: [{ ...layer(), items: [{ ...item('planning:one'), title: 'Changed content' }, item('planning:two')] }] },
    { ...input(), groups: [group] },
    { ...input(), groups: [{ ...group, members: [{ ...group.members[0]!, title: 'Changed group member' }, ...group.members.slice(1)] }] },
    { ...input(), listItems: [item('planning:list')] },
    { ...input(), listCompleteness: 'partial' },
    { ...input(), listTotal: 2 },
  ];
  const ids = new Set([first.snapshot.id]);
  for (const value of changed) {
    const next = store.createOrReuse(value);
    assert.equal(next.created, true);
    assert.equal(ids.has(next.snapshot.id), false);
    ids.add(next.snapshot.id);
    store.finishReuse(next.snapshot.id, { retained: true });
  }
  assert.equal(store.stats().snapshots, changed.length + 1);
});

test('reuse never extends expiry, and expiry prunes the original snapshot and its cursors', () => {
  let now = Date.parse(time);
  const store = createSnapshotStore({ clock: () => new Date(now) });
  const first = store.createOrReuse(input());
  store.finishReuse(first.snapshot.id, { retained: true });
  const cursor = store.cursor({ snapshotId: first.snapshot.id, family: 'viewport', identity: first.snapshot.identity,
    layerId: 'planning', aggregateId: null, offset: 1, pageSize: 1 });
  now += SNAPSHOT_TTL_MS - 1;
  const again = store.createOrReuse(input());
  assert.equal(again.snapshot.id, first.snapshot.id);
  assert.equal(again.snapshot.expiresAt, first.snapshot.expiresAt);
  store.finishReuse(again.snapshot.id, { retained: true });
  now += 1;
  assert.throws(() => store.read(first.snapshot.id), errorCode('snapshotExpired'));
  assert.throws(() => store.readCursor(cursor), errorCode('cursorMismatch'));
  assert.deepEqual(store.stats(), { snapshots: 0, cursors: 0, memoryBytes: 0 });
  const next = store.createOrReuse(input());
  assert.equal(next.created, true);
  assert.notEqual(next.snapshot.id, first.snapshot.id);
  store.finishReuse(next.snapshot.id, { retained: true });
});

test('the unchanged count and byte bounds still reject distinct snapshots while allowing an exact reuse at capacity', () => {
  const store = createSnapshotStore({ clock: () => new Date(time) });
  const ids: string[] = [];
  for (let index = 0; index < 32; index += 1) {
    const next = store.createOrReuse({ ...input(), identity: `different-${index}` });
    ids.push(next.snapshot.id);
    store.finishReuse(next.snapshot.id, { retained: true });
  }
  const duplicate = store.createOrReuse({ ...input(), identity: 'different-0' });
  assert.equal(duplicate.snapshot.id, ids[0]);
  store.finishReuse(duplicate.snapshot.id, { retained: true });
  assert.throws(() => store.createOrReuse(input()), errorCode('rateLimited'));
  assert.equal(store.stats().snapshots, 32);
  for (const id of ids) assert.equal(store.read(id).id, id);
  const measured = createSnapshotStore({ clock: () => new Date(time) }).create(input());
  const bytes = Buffer.byteLength(JSON.stringify(measured));
  const limited = createSnapshotStore({ clock: () => new Date(time), maxBytes: bytes });
  const one = limited.createOrReuse(input());
  limited.finishReuse(one.snapshot.id, { retained: true });
  assert.throws(() => limited.createOrReuse({ ...input(), identity: 'new-content' }), errorCode('rateLimited'));
  assert.equal(limited.stats().memoryBytes, bytes);
});

test('a reused request still rejects revoked rights and leaves the existing token intact', async () => {
  let allowed = true;
  const f = fixture(async () => allowed);
  const first = await f.viewport.query(request);
  allowed = false;
  await assert.rejects(f.viewport.query({ ...request, requestId: 'revoked' }), errorCode('notAvailable'));
  assert.equal(f.rightsReads(), 2);
  assert.equal(f.store.stats().snapshots, 1);
  assert.equal(f.store.read(first.snapshotId).id, first.snapshotId);
});

test('creator timeout cannot remove a token and cursor already issued to a concurrent successful request', async () => {
  const entered = deferred<void>();
  const firstCheck = deferred<boolean>();
  let calls = 0;
  const f = fixture(async () => {
    if (++calls === 1) { entered.resolve(); return firstCheck.promise; }
    return true;
  });
  const first = f.viewport.query(request);
  const failed = assert.rejects(first, errorCode('queryTimeout'));
  await entered.promise;
  const second = await f.viewport.query({ ...request, requestId: 'successful-owner' });
  firstCheck.reject(new MapServiceError('queryTimeout'));
  await failed;
  assert.equal(f.store.stats().snapshots, 1);
  const cursor = second.layers[0]?.nextCursor;
  assert.ok(cursor);
  assert.equal(f.store.readCursor(cursor).snapshotId, second.snapshotId);
  assert.equal((await f.details.item('planning:one', { requestId: 'detail', snapshotId: second.snapshotId })).item.id, 'planning:one');
  const next = await f.viewport.query({ ...request, requestId: 'continue', snapshotId: second.snapshotId, cursor });
  assert.equal(next.layers[0]?.items[0]?.id, 'planning:two');
});

test('two failed concurrent users release a never-issued snapshot after the final pending check', async () => {
  const checks = [deferred<boolean>(), deferred<boolean>()];
  const entered = [deferred<void>(), deferred<void>()];
  let calls = 0;
  const f = fixture(async () => { const index = calls++; entered[index]!.resolve(); return checks[index]!.promise; });
  const first = assert.rejects(f.viewport.query(request), errorCode('queryTimeout'));
  await entered[0]!.promise;
  const second = assert.rejects(f.viewport.query({ ...request, requestId: 'second-failure' }), errorCode('notAvailable'));
  await entered[1]!.promise;
  checks[0]!.reject(new MapServiceError('queryTimeout'));
  await first;
  assert.equal(f.store.stats().snapshots, 1);
  checks[1]!.resolve(false);
  await second;
  assert.deepEqual(f.store.stats(), { snapshots: 0, cursors: 0, memoryBytes: 0 });
});

test('parking viewport requests keep creating separate snapshots', async () => {
  const f = fixture();
  const parkingRequest = parseViewportQuery({ ...request, layers: ['parking'] });
  const viewport = createViewportService({ store: f.store, clock: () => new Date(time),
    readCoverage: async () => coverage, checkPublicRecords: async () => true,
    loadLayer: async () => ({ result: { ...layer(), layerId: 'parking', sourceIds: [], items: [], totalMatching: 0 } }) });
  const first = await viewport.query(parkingRequest);
  const second = await viewport.query({ ...parkingRequest, requestId: 'parking-again' });
  assert.notEqual(first.snapshotId, second.snapshotId);
  assert.equal(f.store.stats().snapshots, 2);
});
