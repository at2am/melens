import type { Firestore, Timestamp } from 'firebase-admin/firestore';

import { MEMORY_LIMITS, memoryRecordSchema, type MemoryRecord } from './schemas.js';
import type { MemoryStore } from './store.js';

const DAY_MS = 24 * 60 * 60 * 1_000;

/**
 * Memory in the project's Firestore database: one document `userMemory/{uid}`. Only the agent service reads or writes
 * it; client rules deny all access. `expiresAtTs` carries the TTL policy: `MEMORY_LIMITS.retentionDays` after the
 * last change.
 */
export function createFirestoreMemoryStore(options: { readonly projectId: string; readonly databaseId: string }): MemoryStore {
  let firestore: Promise<{ db: Firestore; timestamp: (date: Date) => Timestamp }> | null = null;
  const load = () => firestore ??= (async () => {
    const [{ getApps, initializeApp }, { getFirestore, Timestamp: TimestampClass }] =
      await Promise.all([import('firebase-admin/app'), import('firebase-admin/firestore')]);
    const app = getApps()[0] ?? initializeApp({ projectId: options.projectId });
    const db = options.databaseId === '(default)' ? getFirestore(app) : getFirestore(app, options.databaseId);
    return { db, timestamp: (date: Date) => TimestampClass.fromDate(date) };
  })();

  const doc = (db: Firestore, uid: string) => db.collection('userMemory').doc(uid);

  // A record another writer left malformed reads as none, so the next change starts it again.
  const parse = (data: Record<string, unknown> | undefined): MemoryRecord | null => {
    if (data === undefined) return null;
    const { expiresAtTs: _ttl, ...record } = data;
    const parsed = memoryRecordSchema.safeParse(record);
    return parsed.success ? parsed.data : null;
  };

  return {
    async get(uid) {
      const { db } = await load();
      return parse((await doc(db, uid).get()).data());
    },
    async update(uid, change) {
      const { db, timestamp } = await load();
      const ref = doc(db, uid);
      return db.runTransaction(async (transaction) => {
        const next = change(parse((await transaction.get(ref)).data()));
        const expiresAt = new Date(Date.parse(next.updatedAt) + MEMORY_LIMITS.retentionDays * DAY_MS);
        transaction.set(ref, { ...next, facts: next.facts.map((fact) => ({ ...fact })), expiresAtTs: timestamp(expiresAt) });
        return next;
      });
    },
  };
}
