import { createHash } from 'node:crypto';
import { MAX_PAGE_ITEMS, SERVICE_BBOX, compareMapItems, normalizedViewportIdentity, parseMapItemPage,
  parseUnlocatedQuery, parseViewportQuery, type LayerId, type MapItem, type MapItemPage, type UnlocatedQuery,
  type ViewportQuery } from '@melens/shared/contracts/map-contract';
import { findPublicSource, sourceBelongsToLayer, type SourceCoverageSnapshot } from '@melens/shared/query/source-coverage';
import { fitPage, layerBudgets } from './page-budget.js';
import { assertSnapshotPublic, sourceWatermarks, type SnapshotAccess } from './viewport.js';
import { CURSOR_PLACEHOLDER, MapServiceError, type StoredSnapshot } from './snapshot-store.js';

import type { ApprovedUnlocatedScope } from '@melens/shared/query/unlocated-queries';
import type { LoadedUnlocatedLayer, UnlocatedLayerLoader } from '@melens/shared/query/layer-loaders';

export type { ApprovedUnlocatedScope } from '@melens/shared/query/unlocated-queries';
export type { LoadedUnlocatedLayer, UnlocatedLayerLoader } from '@melens/shared/query/layer-loaders';
export function unlocatedCoverageRequest(query: UnlocatedQuery): ViewportQuery {
  const { scope: _scope, cursor: _cursor, snapshotId: _snapshotId, ...context } = query;
  return parseViewportQuery({ ...context, bbox: [...SERVICE_BBOX], zoom: 0 });
}
export function normalizedUnlocatedIdentity(query: UnlocatedQuery): string {
  const scope = 'areaRefs' in query.scope ? { areaRefs: [...query.scope.areaRefs].sort() }
    : { sourceJurisdiction: query.scope.sourceJurisdiction };
  return createHash('sha256').update(`unlocated:v1:${normalizedViewportIdentity(unlocatedCoverageRequest(query))}:${JSON.stringify(scope)}`).digest('hex');
}
/** Scope labels are only accepted from current admitted published source evidence. */
export function approveUnlocatedScope(query: UnlocatedQuery, layerId: LayerId,
  coverage: SourceCoverageSnapshot): ApprovedUnlocatedScope {
  if (coverage.completeness !== 'complete') throw new MapServiceError('serviceUnavailable');
  const candidates = coverage.sources.filter((source) => sourceBelongsToLayer(source, layerId)
    && findPublicSource(coverage, source.sourceId) !== null && source.evidenceState === 'verified');
  if ('areaRefs' in query.scope) {
    const refs = [...query.scope.areaRefs].sort();
    if (!refs.every((ref) => candidates.some((source) => source.coverageAreaRefs.includes(ref)))) throw new MapServiceError('notAvailable');
    const sourceIds = candidates.filter((source) => source.coverageAreaRefs.some((ref) => refs.includes(ref))).map((source) => source.sourceId).sort();
    return { sourceIds, areaRefs: refs, sourceJurisdiction: null };
  }
  const jurisdiction = query.scope.sourceJurisdiction;
  const sourceIds = candidates.filter((source) => source.scope === jurisdiction).map((source) => source.sourceId).sort();
  if (sourceIds.length === 0) throw new MapServiceError('notAvailable');
  return { sourceIds, areaRefs: [], sourceJurisdiction: jurisdiction };
}
export function createUnlocatedService(options: SnapshotAccess & {
  readonly loadLayer: UnlocatedLayerLoader; readonly maxResponseBytes?: number;
  readonly resultEnvelopeReserveBytes?: number;
}) {
  const maxBytes = options.maxResponseBytes ?? 2 * 1024 * 1024;
  function page(snapshot: StoredSnapshot, query: UnlocatedQuery, offset = 0): MapItemPage {
    const layer = query.cursor === undefined ? null : query.layers[0]!;
    const items = layer === null ? snapshot.listItems : snapshot.listItems.filter((item) => item.layerId === layer);
    const pageSize = query.pageSize ?? MAX_PAGE_ITEMS;
    const draft = (selected: readonly MapItem[], more: boolean, nextCursor: string | null) => ({
      schemaVersion: 1, requestId: query.requestId, snapshotId: snapshot.id, mode: snapshot.request.mode,
      generatedAt: (options.clock?.() ?? new Date()).toISOString(), dataMode: 'live', items: selected,
      scope: snapshot.listScope, completeness: more ? 'partial' : snapshot.listCompleteness,
      totalMatching: snapshot.listTotal, nextCursor });
    const { slice, more } = fitPage({ items, offset, limit: pageSize, maxBytes,
      build: (selected, continues) => draft(selected, continues, continues ? CURSOR_PLACEHOLDER : null) });
    if (slice.length === 0 && more) throw new MapServiceError('budgetExceeded');
    // Contract continuations select exactly one layer; cross-layer first pages need
    // no ambiguous cursor. Loaded rows remain accessible through snapshot details.
    const nextCursor = more && snapshot.selectedLayers.length === 1 ? options.store.cursor({
      snapshotId: snapshot.id, family: 'unlocated', identity: snapshot.identity,
      layerId: snapshot.selectedLayers[0]!, aggregateId: null, offset: offset + slice.length, pageSize }) : null;
    return parseMapItemPage(draft(slice, more, nextCursor), { production: true });
  }
  return {
    async query(value: unknown, execution: { readonly signal?: AbortSignal } = {}): Promise<MapItemPage> {
      let query: UnlocatedQuery;
      try { query = parseUnlocatedQuery(value); } catch { throw new MapServiceError('invalidRequest'); }
      if (query.cursor !== undefined && query.snapshotId !== undefined) {
        const snapshot = options.store.read(query.snapshotId);
        const cursor = options.store.readCursor(query.cursor);
        if (snapshot.family !== 'unlocated' || cursor.family !== 'unlocated'
          || cursor.snapshotId !== snapshot.id || snapshot.identity !== normalizedUnlocatedIdentity(query)
          || cursor.identity !== snapshot.identity || cursor.layerId !== query.layers[0]
          || !snapshot.selectedLayers.includes(query.layers[0]!)) throw new MapServiceError('cursorMismatch');
        await assertSnapshotPublic(snapshot, options, execution);
        return page(snapshot, query, cursor.offset);
      }
      const coverage = await options.readCoverage(unlocatedCoverageRequest(query), execution);
      const loaded: LoadedUnlocatedLayer[] = [];
      const approvedSourceIds: string[] = [];
      const { rowLimit, resultBudgetBytes } = layerBudgets(query.layers.length, maxBytes,
        options.resultEnvelopeReserveBytes ?? 64 * 1024);
      for (const layerId of query.layers) {
        const approved = approveUnlocatedScope(query, layerId, coverage);
        approvedSourceIds.push(...approved.sourceIds);
        loaded.push(await options.loadLayer(query, layerId, coverage, approved,
          { ...execution, rowLimit, resultBudgetBytes }));
      }
      const items = loaded.flatMap((entry) => [...entry.items]).sort(compareMapItems);
      const scope: MapItemPage['scope'] = 'areaRefs' in query.scope
        ? { kind: 'unlocated', areaRefs: [...query.scope.areaRefs].sort(), sourceJurisdiction: null }
        : { kind: 'unlocated', areaRefs: [], sourceJurisdiction: query.scope.sourceJurisdiction };
      const allComplete = loaded.every((entry) => entry.completeness === 'complete' && entry.totalMatching !== null);
      const snapshot = options.store.create({ family: 'unlocated', identity: normalizedUnlocatedIdentity(query), request: query,
        selectedLayers: query.layers, sourceWatermarks: sourceWatermarks(coverage,
          [...approvedSourceIds, ...items.flatMap((item) => item.sources.map((source) => source.sourceId))]), layers: [], listItems: items,
        listCompleteness: allComplete ? 'complete' : 'partial', listTotal: allComplete ? loaded.reduce((n, entry) => n + entry.totalMatching!, 0) : null,
        listScope: scope, groups: [] });
      try { await assertSnapshotPublic(snapshot, options, execution); return page(snapshot, query); }
      catch (error) { options.store.discard(snapshot.id); throw error; }
    },
  };
}
