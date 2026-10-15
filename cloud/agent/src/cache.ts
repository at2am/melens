import { createHash } from 'node:crypto';

/**
 * Results worth sharing between users and instances: grounded answers and workflow cards. A miss or a failing
 * store never fails a turn; callers treat any error as a miss.
 */
export interface ToolCache {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown, ttlMs: number): Promise<void>;
}

export const MAX_MEMORY_CACHE_ENTRIES = 500;

export function createMemoryCache(clock: () => Date = () => new Date()): ToolCache {
  const entries = new Map<string, { readonly value: unknown; readonly expiresAt: number }>();
  return {
    async get(key) {
      const entry = entries.get(key);
      if (entry === undefined) return undefined;
      if (entry.expiresAt <= clock().getTime()) { entries.delete(key); return undefined; }
      return entry.value;
    },
    async set(key, value, ttlMs) {
      if (entries.size >= MAX_MEMORY_CACHE_ENTRIES) entries.delete(entries.keys().next().value!);
      entries.set(key, { value, expiresAt: clock().getTime() + ttlMs });
    },
  };
}

/** A key as a Firestore document id: tool, normalised arguments and date hashed together. */
export function cacheDocumentId(key: string): string { return createHash('sha256').update(key).digest('hex'); }

/**
 * `agentCache/{sha256(key)}` in the agent's Firestore database: `key`, `value` (JSON text, so nothing nested or
 * undefined reaches Firestore) and `expiresAtTs` for the TTL policy. Only this service reads or writes it.
 */
export function createFirestoreCache(options: { readonly projectId: string; readonly databaseId: string; readonly clock?: () => Date }): ToolCache {
  const clock = options.clock ?? (() => new Date());
  let firestore: Promise<{ db: import('firebase-admin/firestore').Firestore; timestamp: (date: Date) => import('firebase-admin/firestore').Timestamp }> | null = null;
  const load = () => firestore ??= (async () => {
    const [{ getApps, initializeApp }, { getFirestore, Timestamp }] = await Promise.all([import('firebase-admin/app'), import('firebase-admin/firestore')]);
    const app = getApps()[0] ?? initializeApp({ projectId: options.projectId });
    const db = options.databaseId === '(default)' ? getFirestore(app) : getFirestore(app, options.databaseId);
    return { db, timestamp: (date: Date) => Timestamp.fromDate(date) };
  })();
  return {
    async get(key) {
      const { db } = await load();
      const snapshot = await db.collection('agentCache').doc(cacheDocumentId(key)).get();
      const data = snapshot.data();
      if (data === undefined || data.key !== key || typeof data.value !== 'string') return undefined;
      const expires = data.expiresAtTs as { toMillis(): number } | undefined;
      if (expires === undefined || expires.toMillis() <= clock().getTime()) return undefined;
      return JSON.parse(data.value) as unknown;
    },
    async set(key, value, ttlMs) {
      const { db, timestamp } = await load();
      await db.collection('agentCache').doc(cacheDocumentId(key)).set({ key, value: JSON.stringify(value), expiresAtTs: timestamp(new Date(clock().getTime() + ttlMs)) });
    },
  };
}

/** Reads through the cache; any store failure is a miss. */
export async function cached<T>(cache: ToolCache | undefined, key: string, ttlMs: number, produce: () => Promise<T>,
  accept: (value: T) => boolean = () => true): Promise<{ readonly value: T; readonly hit: boolean }> {
  if (cache !== undefined) {
    try {
      const hit = await cache.get(key);
      if (hit !== undefined) return { value: hit as T, hit: true };
    } catch { /* a cache failure is a miss */ }
  }
  const value = await produce();
  if (cache !== undefined && accept(value)) await cache.set(key, value, ttlMs).catch(() => undefined);
  return { value, hit: false };
}
