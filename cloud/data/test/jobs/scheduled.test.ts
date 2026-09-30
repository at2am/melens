import assert from 'node:assert/strict';
import test from 'node:test';

import { RequestCapReached, withScheduledRequestGuard,
  type ScheduledRequestStore } from '../../src/jobs/scheduled-guard.js';
import { parseScheduledJobConfig, scheduledRun, scheduledWindow } from '../../src/jobs/scheduled.js';

class MemoryRequestStore implements ScheduledRequestStore {
  readonly counts = new Map<string, number>();
  active = false;
  unavailable = false;

  async withSourceLease<T>(_id: string, work: () => Promise<T>): Promise<T> {
    if (this.active) throw new Error('lease already held');
    this.active = true;
    try {
      return await work();
    } finally {
      this.active = false;
    }
  }

  async charge(id: string, day: string, dailyCap: number): Promise<void> {
    if (this.unavailable) throw new Error('request ledger unavailable');
    const key = `${id}/${day}`;
    const count = this.counts.get(key) ?? 0;
    if (count >= dailyCap) throw new RequestCapReached('daily cap reached');
    this.counts.set(key, count + 1);
  }
}

const caps = { MELENS_REQUEST_CAP_PER_DAY: '10', MELENS_MAX_REQUESTS_PER_EXECUTION: '3' };

test('scheduler retries share the same aligned UTC window', () => {
  const first = scheduledWindow(new Date('2026-09-29T10:15:02Z'), 900, 60);
  const retry = scheduledWindow(new Date('2026-09-29T10:29:59Z'), 900, 60);
  assert.deepEqual(first, { from: '2026-09-29T09:59:00.000Z', to: '2026-09-29T10:15:00.000Z' });
  assert.deepEqual(retry, first);
});

test('invalid schedule and source identifiers fail before ingestion', () => {
  assert.throws(() => parseScheduledJobConfig({
    MELENS_SCHEDULE_MODE: 'time', MELENS_SOURCE_ID: 'other;echo injected',
    MELENS_INTERVAL_SECONDS: '60',
  }));
  assert.throws(() => parseScheduledJobConfig({
    MELENS_SCHEDULE_MODE: 'time', MELENS_SOURCE_ID: 'gdelt.news',
    MELENS_INTERVAL_SECONDS: '0', ...caps,
  }));
  assert.throws(() => scheduledWindow(new Date('invalid'), 900, 0));
  assert.throws(() => parseScheduledJobConfig({
    MELENS_SCHEDULE_MODE: 'time', MELENS_SOURCE_ID: 'gdelt.news',
    MELENS_INTERVAL_SECONDS: '900', MELENS_MAX_REQUESTS_PER_EXECUTION: '3',
  }), /dailyRequestCap/);
  assert.throws(() => parseScheduledJobConfig({
    MELENS_SCHEDULE_MODE: 'time', MELENS_SOURCE_ID: 'gdelt.news',
    MELENS_INTERVAL_SECONDS: '900', MELENS_REQUEST_CAP_PER_DAY: '10',
    MELENS_MAX_REQUESTS_PER_EXECUTION: '0',
  }), /executionRequestCap/);
});

test('snapshot revision is explicit', () => {
  assert.deepEqual(parseScheduledJobConfig({
    MELENS_SCHEDULE_MODE: 'snapshot', MELENS_SOURCE_ID: 'victoria.transport.gtfs_static',
    MELENS_SNAPSHOT_REVISION: 'latest', ...caps,
  }), { mode: 'snapshot', sourceId: 'victoria.transport.gtfs_static', revision: 'latest',
    dailyRequestCap: 10, executionRequestCap: 3 });
  assert.throws(() => parseScheduledJobConfig({
    MELENS_SCHEDULE_MODE: 'snapshot', MELENS_SOURCE_ID: 'victoria.transport.gtfs_static',
    ...caps,
  }));
});

test('scheduled execution refuses a source still awaiting admission', async () => {
  await assert.rejects(scheduledRun({
    MELENS_SCHEDULE_MODE: 'snapshot', MELENS_SOURCE_ID: 'victoria.transport.gtfs_static',
    MELENS_SNAPSHOT_REVISION: 'latest', ...caps,
  }), /Source admission is incomplete/);
});

test('outbound attempts are charged before fetch and stop at the execution ceiling', async () => {
  const store = new MemoryRequestStore();
  const originalFetch = globalThis.fetch;
  let sent = 0;
  globalThis.fetch = async () => { sent += 1; return new Response('ok'); };
  const replacement = globalThis.fetch;
  try {
    await assert.rejects(withScheduledRequestGuard(store, { sourceId: 'gdelt.news', dailyCap: 10,
      executionCap: 2 }, async () => {
      await fetch('https://example.org/first');
      await fetch('https://example.org/second');
      await assert.rejects(fetch('https://example.org/third'), RequestCapReached);
    }, () => new Date('2026-09-30T23:59:00Z')), RequestCapReached);
    assert.equal(sent, 2);
    assert.equal(store.counts.get('gdelt.news/2026-09-30'), 2);
    assert.equal(store.active, false);
    assert.equal(globalThis.fetch, replacement);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('failed attempt remains charged across a retrying execution', async () => {
  const store = new MemoryRequestStore();
  const originalFetch = globalThis.fetch;
  let sent = 0;
  globalThis.fetch = async () => { sent += 1; throw new Error('network failed'); };
  try {
    await assert.rejects(withScheduledRequestGuard(store, {
      sourceId: 'gdelt.news', dailyCap: 1, executionCap: 1,
    }, () => fetch('https://example.org/first'), () => new Date('2026-09-30T10:00:00Z')),
    /network failed/);
    await assert.rejects(withScheduledRequestGuard(store, {
      sourceId: 'gdelt.news', dailyCap: 1, executionCap: 1,
    }, () => fetch('https://example.org/retry'), () => new Date('2026-09-30T10:01:00Z')),
    RequestCapReached);
    assert.equal(sent, 1);
    assert.equal(store.counts.get('gdelt.news/2026-09-30'), 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('request ledger failure stops outbound traffic and restores fetch', async () => {
  const store = new MemoryRequestStore();
  store.unavailable = true;
  const originalFetch = globalThis.fetch;
  let sent = 0;
  globalThis.fetch = async () => { sent += 1; return new Response('ok'); };
  const replacement = globalThis.fetch;
  try {
    await assert.rejects(withScheduledRequestGuard(store, {
      sourceId: 'gdelt.news', dailyCap: 10, executionCap: 2,
    }, () => fetch('https://example.org/first')), /request ledger unavailable/);
    assert.equal(sent, 0);
    assert.equal(globalThis.fetch, replacement);
    assert.equal(store.active, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('ledger storage requests do not recursively consume the source quota', async () => {
  class FetchingStore extends MemoryRequestStore {
    override async charge(id: string, day: string, dailyCap: number): Promise<void> {
      await fetch('https://storage.googleapis.com/test-ledger');
      await super.charge(id, day, dailyCap);
    }
  }
  const store = new FetchingStore();
  const originalFetch = globalThis.fetch;
  let sent = 0;
  globalThis.fetch = async () => { sent += 1; return new Response('ok'); };
  try {
    await withScheduledRequestGuard(store, { sourceId: 'gdelt.news', dailyCap: 1,
      executionCap: 1 }, () => fetch('https://example.org/source'),
    () => new Date('2026-09-30T10:00:00Z'));
    assert.equal(sent, 2);
    assert.equal(store.counts.get('gdelt.news/2026-09-30'), 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('overlapping runs in one process are rejected before sending', async () => {
  const store = new MemoryRequestStore();
  let release: (() => void) | undefined;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const first = withScheduledRequestGuard(store, { sourceId: 'gdelt.news', dailyCap: 10,
    executionCap: 1 }, () => pending);
  await assert.rejects(withScheduledRequestGuard(store, { sourceId: 'gdelt.news', dailyCap: 10,
    executionCap: 1 }, async () => {}), /already running in this process/);
  release?.();
  await first;
});
