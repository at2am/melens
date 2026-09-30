import assert from 'node:assert/strict';
import test from 'node:test';

import type { Storage } from '@google-cloud/storage';

import { GcsStore } from '../../src/core/gcs.js';
import { cleanupStaging } from '../../src/jobs/cleanup-staging.js';

type ObjectRecord = {
  generation: string;
  expiresAt?: string;
  timeCreated: string;
};

class MemoryStorage {
  readonly objects = new Map<string, ObjectRecord>();
  readonly deleted: string[] = [];
  readonly lists: Array<{ prefix: string; maxResults: number }> = [];

  bucket() {
    return {
      getFiles: async ({ prefix, maxResults }: { prefix: string; maxResults: number }) => {
        this.lists.push({ prefix, maxResults });
        return [[...this.objects.keys()].filter(name => name.startsWith(prefix))
          .sort().slice(0, maxResults).map(name => this.file(name))];
      },
      file: (name: string, options?: { generation?: string }) => this.file(name, options),
    };
  }

  private file(name: string, options?: { generation?: string }) {
    return {
      name,
      getMetadata: async () => {
        const object = this.objects.get(name);
        if (!object) throw Object.assign(new Error('Gone'), { code: 404 });
        return [{ generation: object.generation,
          timeCreated: object.timeCreated,
          metadata: { expiresAt: object.expiresAt } }];
      },
      delete: async () => {
        const object = this.objects.get(name);
        if (object?.generation === options?.generation) {
          this.objects.delete(name);
          this.deleted.push(name);
        }
      },
    };
  }
}

const clock = new Date('2026-10-01T00:00:00.000Z');

test('scheduled cleanup deletes only expired staging generations', async () => {
  const storage = new MemoryStorage();
  storage.objects.set('staging/expired', {
    generation: '9007199254740993', expiresAt: clock.toISOString(), timeCreated: '2026-09-29T00:00:00Z',
  });
  storage.objects.set('staging/future', {
    generation: '2', expiresAt: '2026-10-01T01:00:00Z', timeCreated: '2026-09-30T00:00:00Z',
  });
  storage.objects.set('staging/legacy', { generation: '3', timeCreated: '2026-09-29T00:00:00Z' });
  storage.objects.set('staging/malformed', {
    generation: '5', expiresAt: 'not-a-date', timeCreated: '2026-09-29T00:00:00Z',
  });
  storage.objects.set('raw/expired', {
    generation: '4', expiresAt: clock.toISOString(), timeCreated: '2026-09-29T00:00:00Z',
  });
  const deleted = await cleanupStaging({ GOOGLE_CLOUD_PROJECT: 'melens-510012', GCS_BUCKET: 'fixture' },
    storage as unknown as Storage, clock);
  assert.equal(deleted, 3);
  assert.deepEqual(storage.deleted, ['staging/expired', 'staging/legacy', 'staging/malformed']);
  assert.deepEqual(storage.lists, [{ prefix: 'staging/', maxResults: 1001 }]);
  assert.equal(storage.objects.has('raw/expired'), true);
});

test('bounded cleanup signals an incomplete scan after processing at most 1000 objects', async () => {
  const storage = new MemoryStorage();
  for (let index = 0; index < 1001; index += 1) {
    storage.objects.set(`staging/${String(index).padStart(4, '0')}`, {
      generation: String(index + 1), expiresAt: clock.toISOString(), timeCreated: '2026-09-29T00:00:00Z',
    });
  }
  const store = new GcsStore(storage as unknown as Storage, 'fixture');
  await assert.rejects(store.cleanupExpired('staging', clock), /Cleanup scan limit reached/);
  assert.equal(storage.deleted.length, 1000);
  assert.equal(storage.objects.size, 1);
});
