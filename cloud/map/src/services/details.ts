import { MAX_PAGE_ITEMS, parseMapItemPage, parseMapItemResponse, parseMapReadContext,
  type MapItem, type MapItemPage, type MapItemResponse, type MapReadContext }
  from '@melens/shared/contracts/map-contract';
import { jsonBytes } from '../util.js';
import { fitPage } from './page-budget.js';
import { assertSnapshotPublic, assertSnapshotRecordsPublic, type SnapshotAccess } from './viewport.js';
import { CURSOR_PLACEHOLDER, MapServiceError, type StoredMemberGroup } from './snapshot-store.js';

function originalMembers(group: StoredMemberGroup): readonly MapItem[] {
  if (group.members.length !== group.aggregate.details.memberIds.length
    || group.members.some((item, i) => item.id !== group.aggregate.details.memberIds[i]
      || item.layerId !== group.aggregate.layerId)) throw new MapServiceError('cursorMismatch');
  return group.members;
}

export function createDetailService(options: SnapshotAccess & { readonly maxResponseBytes?: number }) {
  const maxBytes = options.maxResponseBytes ?? 2 * 1024 * 1024;
  const generatedAt = () => (options.clock?.() ?? new Date()).toISOString();
  const base = (request: MapReadContext, mode: 'current' | 'historical') => ({ schemaVersion: 1 as const,
    requestId: request.requestId, snapshotId: request.snapshotId, generatedAt: generatedAt(), mode,
    dataMode: 'live' as const });
  return {
    async item(id: string, value: unknown, execution: { readonly signal?: AbortSignal } = {}): Promise<MapItemResponse> {
      let request: MapReadContext;
      try {
        request = parseMapReadContext(value);
        if (request.cursor !== undefined || request.pageSize !== undefined) throw new Error();
      } catch { throw new MapServiceError('invalidRequest'); }
      const snapshot = options.store.read(request.snapshotId);
      const items: readonly MapItem[] = [...snapshot.layers.flatMap((layer) => layer.items),
        ...snapshot.listItems, ...snapshot.groups.flatMap((group) => [group.aggregate, ...group.members])];
      const matches = items.filter((item) => item.id === id);
      if (matches.length === 0) throw new MapServiceError('notFound');
      if (new Set(matches.map((item) => item.versionId)).size !== 1) throw new MapServiceError('cursorMismatch');
      const item = matches[0]!;
      if (item.layerId === 'parking') await assertSnapshotPublic(snapshot, options, execution);
      else {
        let records: readonly MapItem[] = [item];
        if (item.kind === 'aggregate') {
          const group = snapshot.groups.find((entry) => entry.aggregate.id === item.id
            && entry.aggregate.versionId === item.versionId && entry.aggregate.layerId === item.layerId);
          if (group === undefined) throw new MapServiceError('cursorMismatch');
          records = originalMembers(group);
        }
        await assertSnapshotRecordsPublic(snapshot, options, records, execution);
      }
      const response = { ...base(request, snapshot.request.mode), item };
      if (jsonBytes(response) > maxBytes) throw new MapServiceError('budgetExceeded');
      return parseMapItemResponse(response, { production: true });
    },
    async members(id: string, value: unknown, execution: { readonly signal?: AbortSignal } = {}): Promise<MapItemPage> {
      let request: MapReadContext;
      try { request = parseMapReadContext(value); } catch { throw new MapServiceError('invalidRequest'); }
      const snapshot = options.store.read(request.snapshotId);
      if (snapshot.family !== 'viewport') throw new MapServiceError('cursorMismatch');
      const group = snapshot.groups.find((entry) => entry.aggregate.id === id);
      if (group === undefined) throw new MapServiceError('cursorMismatch');
      const members = originalMembers(group);
      const pageSize = request.pageSize ?? MAX_PAGE_ITEMS;
      let offset = 0;
      if (request.cursor !== undefined) {
        const cursor = options.store.readCursor(request.cursor);
        if (cursor.family !== 'aggregateMembers' || cursor.snapshotId !== snapshot.id
          || cursor.aggregateId !== id || cursor.identity !== snapshot.identity || cursor.pageSize !== pageSize) throw new MapServiceError('cursorMismatch');
        offset = cursor.offset;
      }
      if (group.aggregate.layerId === 'parking') await assertSnapshotPublic(snapshot, options, execution);
      else await assertSnapshotRecordsPublic(snapshot, options, members, execution);
      const details = group.aggregate.details;
      const scope: MapItemPage['scope'] = { kind: 'aggregateMembers', aggregateId: id,
        bounds: details.bounds, window: details.window, unit: details.metric.unit };
      const page = (items: readonly MapItem[], more: boolean, nextCursor: string | null) => ({
        ...base(request, snapshot.request.mode), items, scope,
        completeness: !more && details.resultRange.totalMatching !== null ? 'complete' as const : 'partial' as const,
        totalMatching: details.resultRange.totalMatching, nextCursor });
      const { slice, more } = fitPage({ items: group.members, offset, limit: pageSize, maxBytes,
        build: (items, continues) => page(items, continues, continues ? CURSOR_PLACEHOLDER : null) });
      if (slice.length === 0 && more) throw new MapServiceError('budgetExceeded');
      const nextCursor = more ? options.store.cursor({ snapshotId: snapshot.id, family: 'aggregateMembers',
        identity: snapshot.identity, layerId: group.aggregate.layerId, aggregateId: id,
        offset: offset + slice.length, pageSize }) : null;
      return parseMapItemPage(page(slice, more, nextCursor), { production: true });
    },
  };
}
