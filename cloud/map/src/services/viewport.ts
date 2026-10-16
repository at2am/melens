import { MAX_PAGE_ITEMS, parseViewportQuery, parseViewportResponse, normalizedViewportIdentity,
  type LayerId, type LayerResult, type MapItem, type ViewportQuery, type ViewportResponse }
  from '@melens/shared/contracts/map-contract';
import { MapServiceError } from '@melens/shared/errors';
import type { SourceCoverageReader } from '@melens/shared/query/source-coverage';
import { fitPage, layerBudgets } from './page-budget.js';
import { CURSOR_PLACEHOLDER, cursorOffset, cursorToken, readContext, viewportToken } from './read-token.js';
import type { LoadedMemberGroup, LoadedViewportLayer, ViewportLayerLoader } from '@melens/shared/query/layer-loaders';

export { MapServiceError } from '@melens/shared/errors';
export type { LoadedViewportLayer, ViewportLayerLoader } from '@melens/shared/query/layer-loaders';
export type StoredMemberGroup = LoadedMemberGroup;
export type ViewportLayerAggregator = (layer: LayerResult, options: {
  readonly zoom: number; readonly bounds: [number, number, number, number];
}) => { readonly items: readonly MapItem[]; readonly groups: ReadonlyMap<string, StoredMemberGroup> };

function layerPage(layer: LayerResult, items: readonly MapItem[], more: boolean, cursor: string | null): LayerResult {
  const state = items.length > 0 ? 'available' : layer.state === 'available' ? 'unknown' : layer.state;
  return { ...layer, state, items: [...items], completeness: more ? 'partial' : layer.completeness,
    totalMatching: state === 'unknown' ? null : layer.totalMatching, nextCursor: cursor };
}

/**
 * Viewport reads answered from the per-layer cache and the request alone (system-design/map-serving-stateless.md).
 * Nothing is stored: the `snapshotId` is the request context, so a continuation, a detail or a member read
 * recomputes the layers it needs. The published views already filter rights, so rows are not rechecked.
 */
export function createViewportService(options: {
  readonly readCoverage: SourceCoverageReader; readonly clock?: () => Date;
  readonly loadLayer: ViewportLayerLoader; readonly maxResponseBytes?: number;
  readonly resultEnvelopeReserveBytes?: number;
  readonly aggregateLayer?: ViewportLayerAggregator;
}) {
  const maxBytes = options.maxResponseBytes ?? 2 * 1024 * 1024;
  const now = () => (options.clock?.() ?? new Date()).toISOString();

  /** Loads [layerIds] as [request] would: each keeps the row and byte allowance of the request's full layer list. */
  async function loadLayers(request: ViewportQuery, layerIds: readonly LayerId[],
    execution: { readonly signal?: AbortSignal } = {}): Promise<LoadedViewportLayer[]> {
    const coverage = await options.readCoverage(request, execution);
    if (coverage.completeness !== 'complete') throw new MapServiceError('serviceUnavailable');
    const { rowLimit, resultBudgetBytes } = layerBudgets(request.layers.length, maxBytes,
      options.resultEnvelopeReserveBytes ?? 64 * 1024);
    // Layers load together: most are answered from the in-memory current-layer cache.
    return Promise.all(layerIds.map(async (layerId) => {
      const entry = await options.loadLayer(request, layerId, coverage, { ...execution, rowLimit, resultBudgetBytes });
      const originalIds = new Set([...entry.result.items.filter((item) => item.kind !== 'aggregate'),
        ...(entry.groups ?? []).flatMap((group) => [...group.members])]
        .map((item) => JSON.stringify([item.layerId, item.id, item.versionId])));
      if (originalIds.size > rowLimit) throw new MapServiceError('budgetExceeded');
      if (options.aggregateLayer === undefined) return entry;
      // Group only after the original-row and result-byte budgets were applied.
      try {
        const grouped = options.aggregateLayer(entry.result, { zoom: request.zoom, bounds: request.bbox });
        return { result: { ...entry.result, items: [...grouped.items] },
          groups: [...(entry.groups ?? []), ...grouped.groups.values()] };
      } catch (error) {
        throw new MapServiceError(error instanceof RangeError ? 'budgetExceeded' : 'serviceUnavailable');
      }
    }));
  }

  function responsePage(snapshotId: string, mode: ViewportQuery['mode'], layers: readonly LayerResult[],
    request: ViewportQuery, offset = 0): ViewportResponse {
    const envelope = (results: readonly LayerResult[]) => ({ schemaVersion: 1, requestId: request.requestId,
      snapshotId, generatedAt: now(), dataMode: 'live', mode, layers: results });
    const pageSize = request.pageSize ?? MAX_PAGE_ITEMS;
    const results: LayerResult[] = [];
    let remaining = MAX_PAGE_ITEMS;
    for (const layerId of request.layers) {
      const layer = layers.find((candidate) => candidate.layerId === layerId);
      if (layer === undefined) throw new MapServiceError('cursorMismatch');
      const { slice, more } = fitPage({ items: layer.items, offset, limit: Math.min(pageSize, remaining), maxBytes,
        build: (items, continues) => envelope([...results,
          layerPage(layer, items, continues, continues ? CURSOR_PLACEHOLDER : null)]) });
      // A later layer may defer all of its rows to a continuation; the first must deliver at least one.
      if (slice.length === 0 && more && results.length === 0) throw new MapServiceError('budgetExceeded');
      const cursor = more ? cursorToken(offset + slice.length,
        { snapshotId, family: 'viewport', layerId, aggregateId: null, pageSize }) : null;
      results.push(layerPage(layer, slice, more, cursor));
      remaining -= slice.length;
    }
    return parseViewportResponse(envelope(results), { production: true, expectedRequest: request });
  }

  return {
    loadLayers,
    async query(value: unknown, execution: { readonly signal?: AbortSignal } = {}): Promise<ViewportResponse> {
      let request: ViewportQuery;
      try { request = parseViewportQuery(value); } catch { throw new MapServiceError('invalidRequest'); }
      if (request.cursor !== undefined && request.snapshotId !== undefined) {
        const context = readContext(request.snapshotId, request.requestId);
        const layerId = request.layers[0]!;
        if (context.family !== 'viewport' || normalizedViewportIdentity(context.request) !== normalizedViewportIdentity(request)
          || !context.request.layers.includes(layerId)) throw new MapServiceError('cursorMismatch');
        const offset = cursorOffset(request.cursor, { snapshotId: request.snapshotId, family: 'viewport', layerId,
          aggregateId: null, pageSize: request.pageSize ?? MAX_PAGE_ITEMS });
        const loaded = await loadLayers(context.request, [layerId], execution);
        return responsePage(request.snapshotId, context.request.mode, loaded.map((entry) => entry.result), request, offset);
      }
      const loaded = await loadLayers(request, request.layers, execution);
      return responsePage(viewportToken(request), request.mode, loaded.map((entry) => entry.result), request);
    },
  };
}
export type ViewportService = ReturnType<typeof createViewportService>;
