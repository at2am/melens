import { createHash } from 'node:crypto';
import { MAX_PAGE_ITEMS, SERVICE_BBOX, compareMapItems, normalizedViewportIdentity, parseMapItemPage,
  parseUnlocatedQuery, parseViewportQuery, type LayerId, type MapItem, type MapItemPage, type UnlocatedQuery,
  type ViewportQuery } from '@melens/shared/contracts/map-contract';
import { MapServiceError } from '@melens/shared/errors';
import { findPublicSource, sourceBelongsToLayer, type SourceCoverageReader, type SourceCoverageSnapshot }
  from '@melens/shared/query/source-coverage';
import { fitPage, layerBudgets } from './page-budget.js';
import { CURSOR_PLACEHOLDER, cursorOffset, cursorToken, readContext, unlocatedToken } from './read-token.js';

import type { ApprovedUnlocatedScope } from '@melens/shared/query/unlocated-queries';
import type { LoadedUnlocatedLayer, UnlocatedLayerLoader } from '@melens/shared/query/layer-loaders';

export type { ApprovedUnlocatedScope } from '@melens/shared/query/unlocated-queries';
export type { LoadedUnlocatedLayer, UnlocatedLayerLoader } from '@melens/shared/query/layer-loaders';
interface UnlocatedList {
  readonly items: readonly MapItem[]; readonly completeness: 'complete' | 'partial'; readonly totalMatching: number | null;
}
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
/** Unlocated lists, recomputed from the query alone: a continuation repeats the read and continues at its offset. */
export function createUnlocatedService(options: {
  readonly readCoverage: SourceCoverageReader; readonly clock?: () => Date;
  readonly loadLayer: UnlocatedLayerLoader; readonly maxResponseBytes?: number;
  readonly resultEnvelopeReserveBytes?: number;
}) {
  const maxBytes = options.maxResponseBytes ?? 2 * 1024 * 1024;
  async function load(query: UnlocatedQuery, execution: { readonly signal?: AbortSignal } = {}): Promise<UnlocatedList> {
    const coverage = await options.readCoverage(unlocatedCoverageRequest(query), execution);
    const loaded: LoadedUnlocatedLayer[] = [];
    const { rowLimit, resultBudgetBytes } = layerBudgets(query.layers.length, maxBytes,
      options.resultEnvelopeReserveBytes ?? 64 * 1024);
    for (const layerId of query.layers) {
      const approved = approveUnlocatedScope(query, layerId, coverage);
      loaded.push(await options.loadLayer(query, layerId, coverage, approved,
        { ...execution, rowLimit, resultBudgetBytes }));
    }
    const allComplete = loaded.every((entry) => entry.completeness === 'complete' && entry.totalMatching !== null);
    return { items: loaded.flatMap((entry) => [...entry.items]).sort(compareMapItems),
      completeness: allComplete ? 'complete' : 'partial',
      totalMatching: allComplete ? loaded.reduce((n, entry) => n + entry.totalMatching!, 0) : null };
  }
  function page(snapshotId: string, list: UnlocatedList, query: UnlocatedQuery, offset: number): MapItemPage {
    const pageSize = query.pageSize ?? MAX_PAGE_ITEMS;
    const scope: MapItemPage['scope'] = 'areaRefs' in query.scope
      ? { kind: 'unlocated', areaRefs: [...query.scope.areaRefs].sort(), sourceJurisdiction: null }
      : { kind: 'unlocated', areaRefs: [], sourceJurisdiction: query.scope.sourceJurisdiction };
    const draft = (selected: readonly MapItem[], more: boolean, nextCursor: string | null) => ({
      schemaVersion: 1, requestId: query.requestId, snapshotId, mode: query.mode,
      generatedAt: (options.clock?.() ?? new Date()).toISOString(), dataMode: 'live', items: selected,
      scope, completeness: more ? 'partial' : list.completeness, totalMatching: list.totalMatching, nextCursor });
    const { slice, more } = fitPage({ items: list.items, offset, limit: pageSize, maxBytes,
      build: (selected, continues) => draft(selected, continues, continues ? CURSOR_PLACEHOLDER : null) });
    if (slice.length === 0 && more) throw new MapServiceError('budgetExceeded');
    // Contract continuations select exactly one layer; cross-layer first pages need no ambiguous cursor.
    const nextCursor = more && query.layers.length === 1 ? cursorToken(offset + slice.length,
      { snapshotId, family: 'unlocated', layerId: query.layers[0]!, aggregateId: null, pageSize }) : null;
    return parseMapItemPage(draft(slice, more, nextCursor), { production: true });
  }
  return {
    load,
    async query(value: unknown, execution: { readonly signal?: AbortSignal } = {}): Promise<MapItemPage> {
      let query: UnlocatedQuery;
      try { query = parseUnlocatedQuery(value); } catch { throw new MapServiceError('invalidRequest'); }
      if (query.cursor !== undefined && query.snapshotId !== undefined) {
        const context = readContext(query.snapshotId, query.requestId);
        if (context.family !== 'unlocated' || normalizedUnlocatedIdentity(context.query) !== normalizedUnlocatedIdentity(query)
          || context.query.layers.length !== 1 || context.query.layers[0] !== query.layers[0]) throw new MapServiceError('cursorMismatch');
        const offset = cursorOffset(query.cursor, { snapshotId: query.snapshotId, family: 'unlocated',
          layerId: query.layers[0]!, aggregateId: null, pageSize: query.pageSize ?? MAX_PAGE_ITEMS });
        return page(query.snapshotId, await load(context.query, execution), query, offset);
      }
      return page(unlocatedToken(query), await load(query, execution), query, 0);
    },
  };
}
export type UnlocatedService = ReturnType<typeof createUnlocatedService>;
