import { MAX_PAGE_ITEMS, layerIdSchema, parseMapItemPage, parseMapItemResponse, parseMapReadContext,
  type LayerId, type MapItem, type MapItemPage, type MapItemResponse, type MapReadContext }
  from '@melens/shared/contracts/map-contract';
import { MapServiceError } from '@melens/shared/errors';
import { jsonBytes } from '../util.js';
import { fitPage } from './page-budget.js';
import { CURSOR_PLACEHOLDER, cursorOffset, cursorToken, readContext } from './read-token.js';
import type { UnlocatedService } from './unlocated.js';
import type { StoredMemberGroup, ViewportService } from './viewport.js';

function originalMembers(group: StoredMemberGroup): readonly MapItem[] {
  if (group.members.length !== group.aggregate.details.memberIds.length
    || group.members.some((item, i) => item.id !== group.aggregate.details.memberIds[i]
      || item.layerId !== group.aggregate.layerId)) throw new MapServiceError('cursorMismatch');
  return group.members;
}

/** `aggregate.<layer>.…` ids name the one layer that has to be recomputed. */
function aggregateLayer(id: string): LayerId | null {
  const parsed = layerIdSchema.safeParse(/^aggregate\.([a-z]+)\./.exec(id)?.[1]);
  return parsed.success ? parsed.data : null;
}

/**
 * Detail and member reads recompute what the token's request returned, from the layer cache
 * (system-design/map-serving-stateless.md). An aggregate keeps its grid-cell id across reloads, so its
 * members are the cell's current members; a cell that no longer has a group reads as `snapshotExpired`.
 */
export function createDetailService(options: {
  readonly viewport: Pick<ViewportService, 'loadLayers'>; readonly unlocated: Pick<UnlocatedService, 'load'>;
  readonly clock?: () => Date; readonly maxResponseBytes?: number;
}) {
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
      const context = readContext(request.snapshotId, request.requestId);
      let items: readonly MapItem[];
      let mode: 'current' | 'historical';
      if (context.family === 'viewport') {
        const layer = aggregateLayer(id);
        const loaded = await options.viewport.loadLayers(context.request,
          layer !== null && context.request.layers.includes(layer) ? [layer] : context.request.layers, execution);
        items = loaded.flatMap((entry) => [...entry.result.items,
          ...(entry.groups ?? []).flatMap((group) => [group.aggregate, ...group.members])]);
        mode = context.request.mode;
      } else {
        items = (await options.unlocated.load(context.query, execution)).items;
        mode = context.query.mode;
      }
      const matches = items.filter((item) => item.id === id);
      if (matches.length === 0) throw new MapServiceError('notFound');
      if (new Set(matches.map((item) => item.versionId)).size !== 1) throw new MapServiceError('cursorMismatch');
      const response = { ...base(request, mode), item: matches[0]! };
      if (jsonBytes(response) > maxBytes) throw new MapServiceError('budgetExceeded');
      return parseMapItemResponse(response, { production: true });
    },
    async members(id: string, value: unknown, execution: { readonly signal?: AbortSignal } = {}): Promise<MapItemPage> {
      let request: MapReadContext;
      try { request = parseMapReadContext(value); } catch { throw new MapServiceError('invalidRequest'); }
      const context = readContext(request.snapshotId, request.requestId);
      const layer = aggregateLayer(id);
      if (context.family !== 'viewport' || layer === null || !context.request.layers.includes(layer)) {
        throw new MapServiceError('cursorMismatch');
      }
      const pageSize = request.pageSize ?? MAX_PAGE_ITEMS;
      const binding = { snapshotId: request.snapshotId, family: 'aggregateMembers' as const, layerId: layer,
        aggregateId: id, pageSize };
      const offset = request.cursor === undefined ? 0 : cursorOffset(request.cursor, binding);
      const loaded = await options.viewport.loadLayers(context.request, [layer], execution);
      const group = loaded.flatMap((entry) => entry.groups ?? []).find((entry) => entry.aggregate.id === id);
      if (group === undefined) throw new MapServiceError('snapshotExpired');
      const members = originalMembers(group);
      const details = group.aggregate.details;
      const scope: MapItemPage['scope'] = { kind: 'aggregateMembers', aggregateId: id,
        bounds: details.bounds, window: details.window, unit: details.metric.unit };
      const page = (items: readonly MapItem[], more: boolean, nextCursor: string | null) => ({
        ...base(request, context.request.mode), items, scope,
        completeness: !more && details.resultRange.totalMatching !== null ? 'complete' as const : 'partial' as const,
        totalMatching: details.resultRange.totalMatching, nextCursor });
      const { slice, more } = fitPage({ items: members, offset, limit: pageSize, maxBytes,
        build: (items, continues) => page(items, continues, continues ? CURSOR_PLACEHOLDER : null) });
      if (slice.length === 0 && more) throw new MapServiceError('budgetExceeded');
      const nextCursor = more ? cursorToken(offset + slice.length, binding) : null;
      return parseMapItemPage(page(slice, more, nextCursor), { production: true });
    },
  };
}
