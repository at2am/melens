import { randomBytes } from 'node:crypto';

import { SNAPSHOT_TTL_MS, type LayerId, type LayerResult, type MapItem,
  type MapItemPage, type UnlocatedQuery, type ViewportQuery } from '../contracts/map-contract.js';
import { MapServiceError } from '../errors.js';
import { deepFreeze, jsonBytes } from '../util.js';

export { MapServiceError, type MapServiceErrorCode } from '../errors.js';
export interface SourceWatermark { readonly sourceId: string; readonly batchId: string; readonly publishedAt: string }
export interface StoredMemberGroup { readonly aggregate: Extract<MapItem, { kind: 'aggregate' }>; readonly members: readonly MapItem[] }
export interface StoredSnapshot {
  readonly id: string;
  readonly family: 'viewport' | 'unlocated';
  readonly identity: string;
  readonly request: ViewportQuery | UnlocatedQuery;
  readonly selectedLayers: readonly LayerId[];
  readonly sourceWatermarks: readonly SourceWatermark[];
  readonly createdAt: number;
  readonly expiresAt: number;
  readonly layers: readonly LayerResult[];
  readonly listItems: readonly MapItem[];
  readonly listCompleteness: 'complete' | 'partial';
  readonly listTotal: number | null;
  readonly listScope: MapItemPage['scope'] | null;
  readonly groups: readonly StoredMemberGroup[];
}
export interface StoredCursor {
  readonly id: string; readonly snapshotId: string;
  readonly family: 'viewport' | 'unlocated' | 'aggregateMembers';
  readonly identity: string; readonly layerId: LayerId | null;
  readonly aggregateId: string | null; readonly offset: number; readonly pageSize: number;
}

const token = () => randomBytes(24).toString('base64url');

/** Bounded in-process immutable pages; tokens contain no source or query contents. */
export function createSnapshotStore(options: {
  readonly clock?: () => Date; readonly maxSnapshots?: number; readonly maxBytes?: number;
  readonly maxCursors?: number;
} = {}) {
  const maxSnapshots = options.maxSnapshots ?? 32;
  const maxBytes = options.maxBytes ?? 16 * 1024 * 1024;
  const maxCursors = options.maxCursors ?? 4_096;
  if (![maxSnapshots, maxBytes, maxCursors].every((n) => Number.isSafeInteger(n) && n > 0)) throw new TypeError('Invalid snapshot bounds');
  const snapshots = new Map<string, { snapshot: StoredSnapshot; bytes: number }>();
  const cursors = new Map<string, StoredCursor>();
  const expired = new Set<string>();
  let memoryBytes = 0;
  const now = () => (options.clock?.() ?? new Date()).getTime();
  function remove(id: string, markExpired: boolean) {
    const entry = snapshots.get(id);
    if (entry !== undefined) { memoryBytes -= entry.bytes; snapshots.delete(id); }
    for (const [key, cursor] of cursors) if (cursor.snapshotId === id) { memoryBytes -= jsonBytes(cursor); cursors.delete(key); }
    if (markExpired) {
      expired.add(id);
      while (expired.size > maxSnapshots * 2) expired.delete(expired.values().next().value!);
    }
  }
  function prune() {
    const time = now();
    for (const [id, entry] of snapshots) if (time >= entry.snapshot.expiresAt) remove(id, true);
  }
  return {
    create(input: Omit<StoredSnapshot, 'id' | 'createdAt' | 'expiresAt'>): StoredSnapshot {
      prune();
      const createdAt = now();
      const snapshot = deepFreeze(structuredClone({ ...input, id: token(), createdAt, expiresAt: createdAt + SNAPSHOT_TTL_MS }));
      const size = jsonBytes(snapshot);
      if (size > maxBytes || snapshots.size >= maxSnapshots || memoryBytes + size > maxBytes) throw new MapServiceError('rateLimited');
      snapshots.set(snapshot.id, { snapshot, bytes: size }); memoryBytes += size;
      return snapshot;
    },
    read(id: string): StoredSnapshot {
      prune();
      const entry = snapshots.get(id);
      if (entry === undefined) throw new MapServiceError(expired.has(id) ? 'snapshotExpired' : 'cursorMismatch');
      if (now() < entry.snapshot.createdAt) throw new MapServiceError('snapshotExpired');
      return entry.snapshot;
    },
    cursor(input: Omit<StoredCursor, 'id'>): string {
      prune();
      this.read(input.snapshotId);
      // Repeated identical reads share one token and cannot exhaust memory.
      for (const cursor of cursors.values()) {
        const { id: _id, ...binding } = cursor;
        if (JSON.stringify(binding) === JSON.stringify(input)) return cursor.id;
      }
      const cursor = deepFreeze({ ...input, id: token() });
      if (cursors.size >= maxCursors || memoryBytes + jsonBytes(cursor) > maxBytes) throw new MapServiceError('rateLimited');
      // Cursor overhead is separately bounded by maxCursors; reserve it against total memory too.
      cursors.set(cursor.id, cursor); memoryBytes += jsonBytes(cursor);
      return cursor.id;
    },
    readCursor(id: string): StoredCursor {
      prune();
      const cursor = cursors.get(id);
      if (cursor === undefined) throw new MapServiceError('cursorMismatch');
      this.read(cursor.snapshotId);
      return cursor;
    },
    discard(id: string) { remove(id, false); },
    stats() { prune(); return { snapshots: snapshots.size, cursors: cursors.size, memoryBytes }; },
  };
}
export type SnapshotStore = ReturnType<typeof createSnapshotStore>;
