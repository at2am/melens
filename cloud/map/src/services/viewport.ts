import { MAX_PAGE_ITEMS, parseViewportQuery, parseViewportResponse, normalizedViewportIdentity,
  type LayerId, type LayerResult, type MapItem, type ViewportQuery, type ViewportResponse }
  from '@melens/shared/contracts/map-contract';
import { findPublicSource, type SourceCoverageReader, type SourceCoverageSnapshot } from '@melens/shared/query/source-coverage';
import { fitPage, layerBudgets } from './page-budget.js';
import { CURSOR_PLACEHOLDER, MapServiceError, type SnapshotStore, type SourceWatermark, type StoredSnapshot,
  type StoredMemberGroup } from './snapshot-store.js';
import type { LoadedViewportLayer, ViewportLayerLoader } from '@melens/shared/query/layer-loaders';

export type { LoadedViewportLayer, ViewportLayerLoader } from '@melens/shared/query/layer-loaders';
export type ViewportLayerAggregator = (layer: LayerResult, options: {
  readonly zoom: number; readonly bounds: [number, number, number, number];
}) => { readonly items: readonly MapItem[]; readonly groups: ReadonlyMap<string, StoredMemberGroup> };
export interface SnapshotAccess {
  readonly store: SnapshotStore; readonly readCoverage: SourceCoverageReader;
  readonly clock?: () => Date;
  readonly checkPublicRecords?: (items: readonly MapItem[], snapshot: StoredSnapshot,
    coverage: SourceCoverageSnapshot, execution: { readonly signal?: AbortSignal }) => Promise<boolean>;
}
export function sourceWatermarks(coverage: SourceCoverageSnapshot, ids: readonly string[]): SourceWatermark[] {
  return [...new Set(ids)].sort().map((sourceId) => {
    const source = findPublicSource(coverage, sourceId);
    if (source === null || source.publishedBatchId === null || source.publishedAt === null) throw new MapServiceError('notAvailable');
    return { sourceId, batchId: source.publishedBatchId, publishedAt: source.publishedAt };
  });
}
export function coverageRequest(snapshot: StoredSnapshot): ViewportQuery {
  if ('bbox' in snapshot.request) return snapshot.request;
  const { scope: _scope, cursor: _cursor, snapshotId: _snapshotId, ...request } = snapshot.request;
  return parseViewportQuery({ ...request, bbox: [144, -39, 146.5, -37], zoom: 0 });
}
/**
 * Sources that publish a new complete snapshot every few minutes as routine (UC-15 parking, every 2 minutes).
 * A newer batch of these is not a withdrawal: their records are rechecked one by one against the current public
 * view instead, so a request or a detail read that spans a routine publication still succeeds. Requiring the same
 * batch failed about 1 in 14 viewport requests and every detail read made after the next publication (2026-10-15).
 */
export const ROUTINELY_REPUBLISHED_SOURCES: ReadonlySet<string> = new Set(['melbourne.parking.sensors']);

export async function assertSnapshotPublic(snapshot: StoredSnapshot, access: SnapshotAccess,
  execution: { readonly signal?: AbortSignal } = {}): Promise<void> {
  const coverage = await access.readCoverage(coverageRequest(snapshot), execution);
  if (coverage.completeness !== 'complete') throw new MapServiceError('serviceUnavailable');
  // A publication change cannot prove that a stored old version remains public.
  for (const mark of snapshot.sourceWatermarks) {
    const current = findPublicSource(coverage, mark.sourceId);
    if (current === null) throw new MapServiceError('notAvailable');
    if (ROUTINELY_REPUBLISHED_SOURCES.has(mark.sourceId)) continue;
    if (current.publishedBatchId !== mark.batchId || current.publishedAt !== mark.publishedAt) throw new MapServiceError('notAvailable');
  }
  const records = [...snapshot.layers.flatMap((layer) => layer.items), ...snapshot.listItems,
    ...snapshot.groups.flatMap((group) => [...group.members])].filter((item) => item.kind !== 'aggregate');
  if (records.length > 0 && (access.checkPublicRecords === undefined
    || !await access.checkPublicRecords(records, snapshot, coverage, execution))) throw new MapServiceError('notAvailable');
}
function layerPage(layer: LayerResult, items: readonly MapItem[], more: boolean, cursor: string | null): LayerResult {
  const state = items.length > 0 ? 'available' : layer.state === 'available' ? 'unknown' : layer.state;
  return { ...layer, state, items: [...items], completeness: more ? 'partial' : layer.completeness,
    totalMatching: state === 'unknown' ? null : layer.totalMatching, nextCursor: cursor };
}

export function createViewportService(options: SnapshotAccess & {
  readonly loadLayer: ViewportLayerLoader; readonly maxResponseBytes?: number;
  readonly resultEnvelopeReserveBytes?: number;
  readonly aggregateLayer?: ViewportLayerAggregator;
}) {
  const maxBytes = options.maxResponseBytes ?? 2 * 1024 * 1024;
  const now = () => (options.clock?.() ?? new Date()).toISOString();
  function responsePage(snapshot: StoredSnapshot, request: ViewportQuery, offset = 0): ViewportResponse {
    const envelope = (layers: readonly LayerResult[]) => ({ schemaVersion: 1, requestId: request.requestId,
      snapshotId: snapshot.id, generatedAt: now(), dataMode: 'live', mode: snapshot.request.mode, layers });
    const pageSize = request.pageSize ?? MAX_PAGE_ITEMS;
    const results: LayerResult[] = [];
    let remaining = MAX_PAGE_ITEMS;
    for (const layerId of request.layers) {
      const layer = snapshot.layers.find((candidate) => candidate.layerId === layerId);
      if (layer === undefined) throw new MapServiceError('cursorMismatch');
      const start = request.cursor === undefined ? 0 : offset;
      const { slice, more } = fitPage({ items: layer.items, offset: start, limit: Math.min(pageSize, remaining), maxBytes,
        build: (items, continues) => envelope([...results,
          layerPage(layer, items, continues, continues ? CURSOR_PLACEHOLDER : null)]) });
      // A later layer may defer all of its rows to a continuation; the first must deliver at least one.
      if (slice.length === 0 && more && results.length === 0) throw new MapServiceError('budgetExceeded');
      const cursor = more ? options.store.cursor({ snapshotId: snapshot.id, family: 'viewport',
        identity: snapshot.identity, layerId, aggregateId: null, offset: start + slice.length, pageSize }) : null;
      results.push(layerPage(layer, slice, more, cursor));
      remaining -= slice.length;
    }
    return parseViewportResponse(envelope(results), { production: true, expectedRequest: request });
  }
  return {
    async query(value: unknown, execution: { readonly signal?: AbortSignal } = {}): Promise<ViewportResponse> {
      let request: ViewportQuery;
      try { request = parseViewportQuery(value); } catch { throw new MapServiceError('invalidRequest'); }
      if (request.cursor !== undefined && request.snapshotId !== undefined) {
        const snapshot = options.store.read(request.snapshotId);
        const cursor = options.store.readCursor(request.cursor);
        if (snapshot.family !== 'viewport' || snapshot.identity !== normalizedViewportIdentity(request)
          || cursor.family !== 'viewport' || cursor.snapshotId !== snapshot.id || cursor.identity !== snapshot.identity
          || request.layers[0] !== cursor.layerId || !snapshot.selectedLayers.includes(request.layers[0]!)) throw new MapServiceError('cursorMismatch');
        await assertSnapshotPublic(snapshot, options, execution);
        return responsePage(snapshot, request, cursor.offset);
      }
      const coverage = await options.readCoverage(request, execution);
      if (coverage.completeness !== 'complete') throw new MapServiceError('serviceUnavailable');
      const { rowLimit, resultBudgetBytes } = layerBudgets(request.layers.length, maxBytes,
        options.resultEnvelopeReserveBytes ?? 64 * 1024);
      // Layers load together: each keeps its own row and byte allowance, and most are answered from the
      // in-memory current-layer cache, so waiting for them one after another only added their latencies.
      const loaded: LoadedViewportLayer[] = await Promise.all(request.layers.map(async (layerId) => {
        const entry = await options.loadLayer(request, layerId, coverage,
          { ...execution, rowLimit, resultBudgetBytes });
        const originalIds = new Set([...entry.result.items.filter((item) => item.kind !== 'aggregate'),
          ...(entry.groups ?? []).flatMap((group) => [...group.members])]
          .map((item) => JSON.stringify([item.layerId, item.id, item.versionId])));
        if (originalIds.size > rowLimit) throw new MapServiceError('budgetExceeded');
        if (options.aggregateLayer === undefined) return entry;
        // Group only after the original-row and result-byte budgets were applied.
        // Keep original versioned members for details and current public-rights checks.
        try {
          const grouped = options.aggregateLayer(entry.result, { zoom: request.zoom, bounds: request.bbox });
          return { result: { ...entry.result, items: [...grouped.items] },
            groups: [...(entry.groups ?? []), ...grouped.groups.values()] };
        } catch (error) {
          throw new MapServiceError(error instanceof RangeError ? 'budgetExceeded' : 'serviceUnavailable');
        }
      }));
      const layers = loaded.map((entry) => entry.result);
      const groups = loaded.flatMap((entry) => entry.groups ?? []);
      const rowSourceIds = [...layers.flatMap((layer) => layer.items), ...groups.flatMap((group) => group.members)]
        .flatMap((item) => item.sources.map((source) => source.sourceId));
      // Every stored row must come from a published source. Coverage-only sources may
      // contribute an unknown status, never stored public rows, so only they are filtered.
      sourceWatermarks(coverage, rowSourceIds);
      const publishedIds = [...layers.flatMap((layer) => layer.sourceIds), ...rowSourceIds]
        .filter((id) => findPublicSource(coverage, id) !== null);
      const snapshot = options.store.create({ family: 'viewport', identity: normalizedViewportIdentity(request),
        request, selectedLayers: request.layers, sourceWatermarks: sourceWatermarks(coverage, publishedIds),
        layers, listItems: [], listCompleteness: 'complete', listTotal: null, listScope: null, groups });
      try {
        await assertSnapshotPublic(snapshot, options, execution);
        return responsePage(snapshot, request);
      } catch (error) { options.store.discard(snapshot.id); throw error; }
    },
  };
}
