import assert from 'node:assert/strict';
import test from 'node:test';

import type { Bucket } from '@google-cloud/storage';

import { acquireExpiringLease } from '../../src/core/gcs.js';

class LockBucket {
  readonly objects = new Map<string, { bytes: string; generation: string }>();
  private sequence = 100;

  put(name: string, bytes: string) {
    this.sequence += 1;
    this.objects.set(name, { bytes, generation: String(this.sequence) });
  }

  file(name: string, options?: { generation?: string }) {
    const read = () => {
      const object = this.objects.get(name);
      if (!object || (options?.generation !== undefined && options.generation !== object.generation)) {
        throw Object.assign(new Error('Not found'), { code: 404 });
      }
      return object;
    };
    return {
      name,
      getMetadata: async () => [{ generation: read().generation }],
      download: async () => [Buffer.from(read().bytes)],
      save: async (bytes: string, input: { preconditionOpts: { ifGenerationMatch: number | string } }) => {
        const actual = this.objects.get(name)?.generation ?? '0';
        if (String(input.preconditionOpts.ifGenerationMatch) !== actual) {
          throw Object.assign(new Error('Precondition failed'), { code: 412 });
        }
        this.put(name, bytes);
      },
      delete: async () => {
        try { read(); this.objects.delete(name); } catch { /* ignoreNotFound */ }
      },
    };
  }
}

const now = Date.parse('2026-10-15T00:00:00.000Z');
const busy = () => new Error('busy');
const acquire = (bucket: LockBucket, leaseMs = 300_000) =>
  acquireExpiringLease(bucket as unknown as Pick<Bucket, 'file'>, 'locks/x.json', leaseMs, busy, () => now);

test('a free lock is created with an explicit expiry', async () => {
  const bucket = new LockBucket();
  const generation = await acquire(bucket);
  const stored = bucket.objects.get('locks/x.json');
  assert.equal(stored?.generation, generation);
  assert.deepEqual(JSON.parse(stored?.bytes ?? '{}'), {
    startedAt: '2026-10-15T00:00:00.000Z', leaseUntil: '2026-10-15T00:05:00.000Z' });
});

test('a live lock is never taken over', async () => {
  const bucket = new LockBucket();
  bucket.put('locks/x.json', JSON.stringify({ leaseUntil: '2026-10-15T00:01:00.000Z' }));
  await assert.rejects(acquire(bucket), /busy/);
  bucket.put('locks/x.json', JSON.stringify({ startedAt: '2026-10-14T23:58:00.000Z' }));
  await assert.rejects(acquire(bucket), /busy/, 'A legacy lock is live until its start plus the lease');
  bucket.put('locks/x.json', 'not json');
  await assert.rejects(acquire(bucket), /busy/, 'A lock without any clock is never presumed dead');
});

test('a lock left by a task stopped at its timeout is recovered after the lease', async () => {
  const bucket = new LockBucket();
  bucket.put('locks/x.json', JSON.stringify({ leaseUntil: '2026-10-14T23:59:59.000Z' }));
  const stale = bucket.objects.get('locks/x.json')?.generation;
  const generation = await acquire(bucket);
  assert.notEqual(generation, stale);
  assert.equal(JSON.parse(bucket.objects.get('locks/x.json')?.bytes ?? '{}').leaseUntil,
    '2026-10-15T00:05:00.000Z');
  // Scheduled locks written before expiries existed carry only their start.
  bucket.put('locks/x.json', JSON.stringify({ startedAt: '2026-10-14T20:00:00.000Z' }));
  await acquire(bucket);
});
