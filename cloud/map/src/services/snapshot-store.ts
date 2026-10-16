import { randomBytes } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

import { SNAPSHOT_TTL_MS, type LayerId, type LayerResult, type MapItem,
  type MapItemPage, type UnlocatedQuery, type ViewportQuery } from '@melens/shared/contracts/map-contract';
import { MapServiceError } from '@melens/shared/errors';
import { deepFreeze, jsonBytes } from '../util.js';

export { MapServiceError, type MapServiceErrorCode } from '@melens/shared/errors';
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
type SnapshotInput = Omit<StoredSnapshot, 'id' | 'createdAt' | 'expiresAt'>;
interface SnapshotEntry {
  readonly snapshot: StoredSnapshot;
  readonly bytes: number;
  pendingUses: number;
  retained: boolean;
}

function reusableInput(input: SnapshotInput): SnapshotInput {
  const { requestId: _requestId, ...request } = input.request;
  return { ...input, request: { ...request, requestId: '' } };
}

const TOKEN_BYTES = 24;
const token = () => randomBytes(TOKEN_BYTES).toString('base64url');
/** Same length as a real token, so a page can be measured before its cursor is issued. */
export const CURSOR_PLACEHOLDER = 'x'.repeat(Buffer.alloc(TOKEN_BYTES).toString('base64url').length);

/** Bounded in-process immutable pages; tokens contain no source or query contents. */
export function createSnapshotStore(options: {
  readonly clock?: () => Date; readonly maxSnapshots?: number; readonly maxBytes?: number;
  readonly maxCursors?: number;
} = {}) {
  const maxSnapshots = options.maxSnapshots ?? 32;
  const maxBytes = options.maxBytes ?? 16 * 1024 * 1024;
  const maxCursors = options.maxCursors ?? 4_096;
  if (![maxSnapshots, maxBytes, maxCursors].every((n) => Number.isSafeInteger(n) && n > 0)) throw new TypeError('Invalid snapshot bounds');
  const snapshots = new Map<string, SnapshotEntry>();
  const cursors = new Map<string, { cursor: StoredCursor; bytes: number }>();
  // Identical bindings share one token, and a snapshot releases its cursors without a scan.
  const cursorIdsByBinding = new Map<string, string>();
  const cursorIdsBySnapshot = new Map<string, Set<string>>();
  const expired = new Set<string>();
  let memoryBytes = 0;
  const now = () => (options.clock?.() ?? new Date()).getTime();
  const bindingKey = (input: Omit<StoredCursor, 'id'>) => JSON.stringify([input.snapshotId, input.family,
    input.identity, input.layerId, input.aggregateId, input.offset, input.pageSize]);
  function remove(id: string, markExpired: boolean) {
    const entry = snapshots.get(id);
    if (entry !== undefined) { memoryBytes -= entry.bytes; snapshots.delete(id); }
    for (const cursorId of cursorIdsBySnapshot.get(id) ?? []) {
      const stored = cursors.get(cursorId);
      if (stored === undefined) continue;
      memoryBytes -= stored.bytes; cursors.delete(cursorId); cursorIdsByBinding.delete(bindingKey(stored.cursor));
    }
    cursorIdsBySnapshot.delete(id);
    if (markExpired) {
      expired.add(id);
      while (expired.size > maxSnapshots * 2) expired.delete(expired.values().next().value!);
    }
  }
  function prune() {
    const time = now();
    for (const [id, entry] of snapshots) if (time >= entry.snapshot.expiresAt) remove(id, true);
  }
  function storeSnapshot(input: SnapshotInput, ownership: 'retained' | 'pending'): StoredSnapshot {
    prune();
    const createdAt = now();
    const snapshot = deepFreeze(structuredClone({ ...input, id: token(), createdAt, expiresAt: createdAt + SNAPSHOT_TTL_MS }));
    const size = jsonBytes(snapshot);
    if (size > maxBytes || snapshots.size >= maxSnapshots || memoryBytes + size > maxBytes) {
      process.stderr.write(`${JSON.stringify({ severity: 'WARNING', event: 'mapRateLimited',
        reason: size > maxBytes || memoryBytes + size > maxBytes ? 'snapshotBytes' : 'snapshotCount',
        snapshots: snapshots.size, cursors: cursors.size, memoryBytes, requestedBytes: size, maxSnapshots, maxBytes })}\n`);
      throw new MapServiceError('rateLimited');
    }
    snapshots.set(snapshot.id, { snapshot, bytes: size, pendingUses: ownership === 'pending' ? 1 : 0,
      retained: ownership === 'retained' });
    memoryBytes += size;
    return snapshot;
  }
  return {
    create(input: SnapshotInput): StoredSnapshot {
      return storeSnapshot(input, 'retained');
    },
    /** Exact immutable inputs share a token. Each use must finish after its own rights check. */
    createOrReuse(input: SnapshotInput): { snapshot: StoredSnapshot; created: boolean } {
      prune();
      const comparable = reusableInput(input);
      const time = now();
      for (const entry of snapshots.values()) {
        const { id: _id, createdAt, expiresAt: _expiresAt, ...stored } = entry.snapshot;
        if (time < createdAt || stored.identity !== input.identity || stored.family !== input.family) continue;
        if (!isDeepStrictEqual(comparable, reusableInput(stored))) continue;
        entry.pendingUses += 1;
        return { snapshot: entry.snapshot, created: false };
      }
      return { snapshot: storeSnapshot(input, 'pending'), created: true };
    },
    /** Failed concurrent users cannot remove a token another request has successfully issued. */
    finishReuse(id: string, outcome: { readonly retained: boolean }): void {
      if (outcome.retained) this.read(id);
      const entry = snapshots.get(id);
      if (entry === undefined) return;
      if (entry.pendingUses < 1) throw new TypeError('Snapshot has no pending use');
      entry.pendingUses -= 1;
      if (outcome.retained) entry.retained = true;
      if (entry.pendingUses === 0 && !entry.retained) remove(id, false);
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
      const key = bindingKey(input);
      const existing = cursorIdsByBinding.get(key);
      if (existing !== undefined) return existing;
      const cursor = deepFreeze({ ...input, id: token() });
      const bytes = jsonBytes(cursor);
      if (cursors.size >= maxCursors || memoryBytes + bytes > maxBytes) {
        process.stderr.write(`${JSON.stringify({ severity: 'WARNING', event: 'mapRateLimited',
          reason: cursors.size >= maxCursors ? 'cursorCount' : 'cursorBytes',
          snapshots: snapshots.size, cursors: cursors.size, memoryBytes, requestedBytes: bytes, maxCursors, maxBytes })}\n`);
        throw new MapServiceError('rateLimited');
      }
      // Cursor overhead is separately bounded by maxCursors; reserve it against total memory too.
      cursors.set(cursor.id, { cursor, bytes }); memoryBytes += bytes;
      cursorIdsByBinding.set(key, cursor.id);
      let ids = cursorIdsBySnapshot.get(input.snapshotId);
      if (ids === undefined) { ids = new Set(); cursorIdsBySnapshot.set(input.snapshotId, ids); }
      ids.add(cursor.id);
      return cursor.id;
    },
    readCursor(id: string): StoredCursor {
      prune();
      const stored = cursors.get(id);
      if (stored === undefined) throw new MapServiceError('cursorMismatch');
      this.read(stored.cursor.snapshotId);
      return stored.cursor;
    },
    discard(id: string) { remove(id, false); },
    stats() { prune(); return { snapshots: snapshots.size, cursors: cursors.size, memoryBytes }; },
  };
}
export type SnapshotStore = ReturnType<typeof createSnapshotStore>;
