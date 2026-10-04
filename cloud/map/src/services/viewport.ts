import { MAX_PAGE_ITEMS, parseViewportQuery, parseViewportResponse, normalizedViewportIdentity,
  type LayerId, type LayerResult, type MapItem, type ViewportQuery, type ViewportResponse }
  from '../contracts/map-contract.js';
import { findPublicSource, type SourceCoverageReader, type SourceCoverageSnapshot } from '../query/source-coverage.js';
import { MapServiceError, type SnapshotStore, type SourceWatermark, type StoredSnapshot,
  type StoredMemberGroup } from './snapshot-store.js';

export interface LoadedViewportLayer {
  readonly result: LayerResult; readonly groups?: readonly StoredMemberGroup[];
}
export type ViewportLayerLoader = (request: ViewportQuery, layerId: LayerId,
  coverage: SourceCoverageSnapshot, execution: { readonly signal?: AbortSignal;
    readonly rowLimit: number; readonly resultBudgetBytes: number }) => Promise<LoadedViewportLayer>;
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
export async function assertSnapshotPublic(snapshot: StoredSnapshot, access: SnapshotAccess,
  execution: { readonly signal?: AbortSignal } = {}): Promise<void> {
  const coverage = await access.readCoverage(coverageRequest(snapshot), execution);
  if (coverage.completeness !== 'complete') throw new MapServiceError('serviceUnavailable');
  // A publication change cannot prove that a stored old version remains public.
  for (const mark of snapshot.sourceWatermarks) {
    const current = findPublicSource(coverage, mark.sourceId);
    if (current === null || current.publishedBatchId !== mark.batchId || current.publishedAt !== mark.publishedAt) throw new MapServiceError('notAvailable');
  }
  const records = [...snapshot.layers.flatMap((layer) => layer.items), ...snapshot.listItems,
    ...snapshot.groups.flatMap((group) => [...group.members])].filter((item) => item.kind !== 'aggregate');
  if (records.length > 0 && (access.checkPublicRecords === undefined
    || !await access.checkPublicRecords(records, snapshot, coverage, execution))) throw new MapServiceError('notAvailable');
}
const encodedBytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value), 'utf8');
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
    const results: LayerResult[] = [];
    let remaining = MAX_PAGE_ITEMS;
    for (const layerId of request.layers) {
      const layer = snapshot.layers.find((candidate) => candidate.layerId === layerId);
      if (layer === undefined) throw new MapServiceError('cursorMismatch');
      const start = request.cursor === undefined ? 0 : offset;
      let count = Math.min(layer.items.length - start, request.pageSize ?? MAX_PAGE_ITEMS, remaining);
      while (true) {
        const items = layer.items.slice(start, start + count);
        const more = start + count < layer.items.length;
        const cursorPlaceholder = more ? 'x'.repeat(32) : null;
        const draft = { schemaVersion: 1, requestId: request.requestId, snapshotId: snapshot.id,
          generatedAt: now(), dataMode: 'live', mode: snapshot.request.mode,
          layers: [...results, layerPage(layer, items, more, cursorPlaceholder)] };
        if (encodedBytes(draft) <= maxBytes) {
          if (count === 0 && more && results.length === 0) throw new MapServiceError('budgetExceeded');
          const cursor = more ? options.store.cursor({ snapshotId: snapshot.id, family: 'viewport',
            identity: snapshot.identity, layerId, aggregateId: null, offset: start + count,
            pageSize: request.pageSize ?? MAX_PAGE_ITEMS }) : null;
          results.push(layerPage(layer, items, more, cursor)); remaining -= count; break;
        }
        if (count === 0) throw new MapServiceError('budgetExceeded');
        count -= 1;
      }
    }
    return parseViewportResponse({ schemaVersion: 1, requestId: request.requestId, snapshotId: snapshot.id,
      generatedAt: now(), dataMode: 'live', mode: snapshot.request.mode, layers: results },
    { production: true, expectedRequest: request });
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
      const loaded: LoadedViewportLayer[] = [];
      const rowLimit = Math.max(1, Math.floor(MAX_PAGE_ITEMS / request.layers.length));
      const resultBudgetBytes = Math.max(2, Math.floor((maxBytes - (options.resultEnvelopeReserveBytes ?? 64 * 1024)) / request.layers.length));
      // Sequential bounded queries avoid multiplying the per-request concurrency/scan allowance.
      for (const layerId of request.layers) {
        const entry = await options.loadLayer(request, layerId, coverage,
          { ...execution, rowLimit, resultBudgetBytes });
        const originalIds = new Set([...entry.result.items.filter((item) => item.kind !== 'aggregate'),
          ...(entry.groups ?? []).flatMap((group) => [...group.members])]
          .map((item) => JSON.stringify([item.layerId, item.id, item.versionId])));
        if (originalIds.size > rowLimit) throw new MapServiceError('budgetExceeded');
        if (options.aggregateLayer === undefined) { loaded.push(entry); continue; }
        // Group only after the original-row and result-byte budgets were applied.
        // Keep original versioned members for details and current public-rights checks.
        try {
          const grouped = options.aggregateLayer(entry.result, { zoom: request.zoom, bounds: request.bbox });
          loaded.push({ result: { ...entry.result, items: [...grouped.items] },
            groups: [...(entry.groups ?? []), ...grouped.groups.values()] });
        } catch (error) {
          throw new MapServiceError(error instanceof RangeError ? 'budgetExceeded' : 'serviceUnavailable');
        }
      }
      const layers = loaded.map((entry) => entry.result);
      const groups = loaded.flatMap((entry) => entry.groups ?? []);
      const sourceIds = [...layers.flatMap((layer) => layer.sourceIds), ...layers.flatMap((layer) => layer.items.flatMap((item) => item.sources.map((source) => source.sourceId))),
        ...groups.flatMap((group) => group.members.flatMap((item) => item.sources.map((source) => source.sourceId)))];
      const actualSourceIds = [...layers.flatMap((layer) => layer.items.flatMap((item) => item.sources.map((source) => source.sourceId))),
        ...groups.flatMap((group) => group.members.flatMap((item) => item.sources.map((source) => source.sourceId)))];
      sourceWatermarks(coverage, actualSourceIds);
      // Sources without a publication may contribute unknown status, never stored public rows.
      const publishedIds = sourceIds.filter((id) => findPublicSource(coverage, id) !== null);
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
