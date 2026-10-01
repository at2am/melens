import assert from 'node:assert/strict';
import test from 'node:test';

import { manualRun, type ManualRunDependencies } from '../../src/jobs/manual.js';
import { RequestCapReached, type ScheduledRequestStore } from '../../src/jobs/scheduled-guard.js';

class MemoryRequestStore implements ScheduledRequestStore {
  leases = 0;
  active = false;
  requests = 0;
  async withSourceLease<T>(_source: string, work: () => Promise<T>): Promise<T> {
    this.leases += 1;
    assert.equal(this.active, false);
    this.active = true;
    try { return await work(); }
    finally { this.active = false; }
  }
  async charge(_source: string, _day: string, dailyCap: number): Promise<void> {
    if (this.requests >= dailyCap) throw new RequestCapReached('fixture quota reached');
    this.requests += 1;
  }
}

const env: NodeJS.ProcessEnv = {
  GOOGLE_CLOUD_PROJECT: 'melens-fixture', GCP_REGION: 'australia-southeast2',
  GCS_BUCKET: 'melens-fixture', BQ_INGEST_DATASET: 'melens_ingest', BQ_QUERY_DATASET: 'melens_query',
  BQ_MAXIMUM_BYTES_BILLED: '500000000', MELENS_SCHEDULE_MODE: 'time', MELENS_SOURCE_ID: 'gdelt.news',
  MELENS_INTERVAL_SECONDS: '900', MELENS_OVERLAP_SECONDS: '0',
  MELENS_REQUEST_CAP_PER_DAY: '160', MELENS_MAX_REQUESTS_PER_EXECUTION: '1',
};
const window = ['--source', 'gdelt.news', '--from', '2026-09-29T10:30:00Z',
  '--to', '2026-09-29T10:45:00Z'];

test('manual first collection and backfill retain the source lease and charge only collection', async () => {
  const store = new MemoryRequestStore();
  const originalFetch = globalThis.fetch;
  let sent = 0;
  globalThis.fetch = async () => { sent += 1; return new Response('ok'); };
  const replacementFetch = globalThis.fetch;
  let storeCreated = 0;
  const received: string[][] = [];
  const runtime: ManualRunDependencies = {
    createRequestStore: config => {
      assert.equal(config.maxBytesBilled, '500000000'); storeCreated += 1; return store;
    },
    ingest: async (args, collect, passedEnv) => {
      assert.equal(passedEnv, env);
      assert.ok(collect);
      assert.equal(store.active, true);
      received.push([...args]);
      await fetch('https://example.org/cloud-history');
      await collect(() => fetch('https://example.org/gdelt-archive'));
      assert.equal(store.active, true);
      assert.equal(globalThis.fetch, replacementFetch);
      await fetch('https://example.org/cloud-publication');
    },
  };
  try {
    const first = [...window, '--initial-cursor', '2026-09-29T10:30:00Z'];
    const backfill = [...window, '--backfill'];
    await manualRun(first, env, runtime);
    await manualRun(backfill, env, runtime);
    assert.deepEqual(received, [first, backfill]);
    assert.equal(storeCreated, 2);
    assert.equal(store.leases, 2);
    assert.equal(store.requests, 2);
    assert.equal(sent, 6);
    assert.equal(store.active, false);
    assert.equal(globalThis.fetch, replacementFetch);
  } finally { globalThis.fetch = originalFetch; }
});

test('invalid windows, cursor, mode and source cannot acquire a lease or invoke ingestion', async () => {
  let created = 0;
  let invoked = 0;
  const runtime: ManualRunDependencies = {
    createRequestStore: () => { created += 1; return new MemoryRequestStore(); },
    ingest: async () => { invoked += 1; },
  };
  const invalid = [
    ['--source', 'ticketmaster.events', ...window.slice(2)],
    [...window, '--source', 'gdelt.news'],
    [...window, '--unknown', 'value'],
    [...window.slice(0, 4)],
    ['--source', 'gdelt.news', '--from', '2026-02-30T10:30:00Z', '--to', '2026-03-02T10:45:00Z'],
    ['--source', 'gdelt.news', '--from', '2026-09-29T10:30:00+10:00', '--to', '2026-09-29T10:45:00Z'],
    ['--source', 'gdelt.news', '--from', '2026-09-29T10:45:00Z', '--to', '2026-09-29T10:30:00Z'],
    ['--source', 'gdelt.news', '--from', '2026-09-29T10:31:00Z', '--to', '2026-09-29T10:45:00Z'],
    ['--source', 'gdelt.news', '--from', '2026-09-29T10:30:00Z', '--to', '2026-09-29T11:00:00Z'],
    [...window, '--revision', 'latest'],
    [...window, '--initial-cursor', '2026-09-29T10:45:00Z'],
    [...window, '--initial-cursor', 'not-a-date'],
    ['--source', 'gdelt.news', '--revision', 'latest', '--backfill'],
  ];
  for (const args of invalid) await assert.rejects(manualRun(args, env, runtime),
    /Manual source must equal the deployed source|Invalid manual ingestion arguments/);
  assert.equal(created, 0);
  assert.equal(invoked, 0);
});

test('reviewed source admission and both request ceilings are checked before a lease', async () => {
  let created = 0;
  const runtime: ManualRunDependencies = {
    createRequestStore: () => { created += 1; return new MemoryRequestStore(); },
    ingest: async () => { assert.fail('must not ingest'); },
  };
  await assert.rejects(manualRun(window, { ...env, MELENS_REQUEST_CAP_PER_DAY: '161' }, runtime),
    { message: 'Manual request cap exceeds reviewed source quota' });
  await assert.rejects(manualRun(window, { ...env, MELENS_MAX_REQUESTS_PER_EXECUTION: '161' }, runtime),
    { message: 'Invalid manual job configuration' });
  await assert.rejects(manualRun(window, { ...env, BQ_MAXIMUM_BYTES_BILLED: undefined }, runtime),
    { message: 'Manual BigQuery query ceiling is missing' });
  await assert.rejects(manualRun(['--source', 'victoria.transport.gtfs_static', '--revision', 'latest'], {
    ...env, MELENS_SOURCE_ID: 'victoria.transport.gtfs_static', MELENS_SCHEDULE_MODE: 'snapshot',
    MELENS_SNAPSHOT_REVISION: 'latest',
  }, runtime), { message: 'Manual source admission is incomplete' });
  assert.equal(created, 0);
});

test('manual quota enforcement stops provider traffic across executions and sanitizes failures', async () => {
  const store = new MemoryRequestStore();
  const originalFetch = globalThis.fetch;
  let sent = 0;
  globalThis.fetch = async () => { sent += 1; return new Response('ok'); };
  const replacementFetch = globalThis.fetch;
  const runtime: ManualRunDependencies = {
    createRequestStore: () => store,
    ingest: async (_args, collect) => { assert.ok(collect); await collect(() => fetch('https://example.org/provider')); },
  };
  try {
    const oneRequest = { ...env, MELENS_REQUEST_CAP_PER_DAY: '1' };
    await manualRun(window, oneRequest, runtime);
    await assert.rejects(manualRun(window, oneRequest, runtime), { message: 'Manual request quota reached' });
    assert.equal(sent, 1);
    assert.equal(store.requests, 1);
    assert.equal(store.active, false);
    assert.equal(globalThis.fetch, replacementFetch);
    await assert.rejects(manualRun(window, env, { ...runtime,
      ingest: async () => { throw new Error('raw SDK credential value must never escape'); },
    }), { message: 'Manual ingestion failed' });
    assert.equal(store.active, false);
  } finally { globalThis.fetch = originalFetch; }
});
