import { compareMapItems, type LayerId, type LayerResult, type MapItem, type UnlocatedQuery, type ViewportQuery }
  from '../contracts/map-contract.js';
import { MapServiceError } from '../errors.js';
import { MapAdapterError, type PublicSourceResolver } from './adapter-common.js';
import { ADAPTED_LAYERS, EXTERNALLY_VERIFIED_LAYERS, UNLOCATED_LAYERS, adaptContext, adaptLayerRows }
  from './layer-adapters.js';
import type { NewsAreaLoader } from './news-areas.js';
import type { ViewQueryResult } from './query-runner.js';
import { assessLayerCoverage, compareSourceInstants, finalizeLayerResult, sourceBelongsToLayer,
  type CoverageAreaResolver, type SourceCoverageSnapshot } from './source-coverage.js';
import type { ApprovedUnlocatedScope } from './unlocated-queries.js';

/** Members of one aggregate, kept with the layer so a detail read can list them without a second query. */
export interface LoadedMemberGroup {
  readonly aggregate: Extract<MapItem, { kind: 'aggregate' }>; readonly members: readonly MapItem[];
}
export interface LoadedViewportLayer {
  readonly result: LayerResult; readonly groups?: readonly LoadedMemberGroup[];
}
/** Bounds every caller passes to a layer load: cancellation plus the row and byte budget it may spend. */
export interface LayerExecution {
  readonly signal?: AbortSignal; readonly rowLimit: number; readonly resultBudgetBytes: number;
}
export type ViewportLayerLoader = (request: ViewportQuery, layerId: LayerId,
  coverage: SourceCoverageSnapshot, execution: LayerExecution) => Promise<LoadedViewportLayer>;
export interface LoadedUnlocatedLayer {
  readonly items: readonly MapItem[]; readonly completeness: 'complete' | 'partial'; readonly totalMatching: number | null;
}
export type UnlocatedLayerLoader = (query: UnlocatedQuery, layerId: LayerId,
  coverage: SourceCoverageSnapshot, scope: ApprovedUnlocatedScope, execution: LayerExecution) => Promise<LoadedUnlocatedLayer>;

export interface LayerLoaderDependencies {
  readonly runQuery: (input: unknown, execution: { readonly signal?: AbortSignal }) => Promise<ViewQueryResult>;
  readonly resolveSource: (coverage: SourceCoverageSnapshot) => PublicSourceResolver;
  readonly clock: () => Date;
  /** Without a trusted verifier the externally verified layers are not served. */
  readonly externalVerifier: boolean;
  readonly resolveArea: CoverageAreaResolver | undefined;
  readonly loadAnomalyLayer: ViewportLayerLoader | undefined;
  /** UC-06: current news drawn as the official areas the articles name. */
  readonly loadNewsAreas?: NewsAreaLoader | undefined;
}

/** Admitted, published sources of one layer that also carry a reviewed public reference. */
export function publicSourceIds(coverage: SourceCoverageSnapshot, layerId: LayerId,
  resolveSource: PublicSourceResolver): string[] {
  return coverage.sources
    .filter((source) => sourceBelongsToLayer(source, layerId) && resolveSource(source.sourceId) !== null)
    .map((source) => source.sourceId);
}

/** Layers whose sources publish well after the moment they describe. */
const LATE_LAYERS: ReadonlySet<LayerId> = new Set(['pedestrian']);

/**
 * A current read of a late layer: the window of the same length that ends at its latest published
 * window. City of Melbourne pedestrian minutes are published 35 to 45 minutes after they are counted,
 * so "the last 15 minutes" holds no count yet; the latest counts are shown with their own times.
 */
export function latestPublishedRequest(request: ViewportQuery, layerId: LayerId,
  coverage: SourceCoverageSnapshot): ViewportQuery {
  if (request.mode !== 'current' || !LATE_LAYERS.has(layerId)) return request;
  const ends = coverage.sources.filter((source) => source.admitted && sourceBelongsToLayer(source, layerId))
    .flatMap((source) => source.publishedWindow === null ? [] : [source.publishedWindow.to]);
  const end = ends.sort(compareSourceInstants).at(-1);
  if (end === undefined || compareSourceInstants(end, request.window.to) >= 0) return request;
  const length = Date.parse(request.window.to) - Date.parse(request.window.from);
  const from = new Date(Date.parse(end) - length).toISOString().replace('.000Z', 'Z');
  return { ...request, window: { from, to: end } };
}

/** Bounded viewport reads: one fixed query per layer, denied rather than guessed when anything is unproven. */
export function createViewportLayerLoader(deps: LayerLoaderDependencies): ViewportLayerLoader {
  return async (originalRequest, layerId, coverage, execution) => {
    if (layerId === 'anomaly' && deps.loadAnomalyLayer !== undefined) {
      return deps.loadAnomalyLayer(originalRequest, layerId, coverage, execution);
    }
    const request = latestPublishedRequest(originalRequest, layerId, coverage);
    const assessment = assessLayerCoverage({ snapshot: coverage, layerId, request,
      ...(deps.resolveArea === undefined ? {} : { resolveArea: deps.resolveArea }) });
    const denied = () => ({ result: finalizeLayerResult({ layerId, assessment, items: [], completeness: 'partial',
      unresolvedCount: null, totalMatching: null, querySucceeded: false }) });
    const resolveSource = deps.resolveSource(coverage);
    const sourceIds = publicSourceIds(coverage, layerId, resolveSource);
    if (sourceIds.length === 0) {
      if (assessment.sourceIds.length !== 0) return denied();
      return { result: finalizeLayerResult({ layerId, assessment, items: [], completeness: 'complete',
        unresolvedCount: null, totalMatching: null }) };
    }
    if (!ADAPTED_LAYERS.has(layerId)) return denied();
    if (EXTERNALLY_VERIFIED_LAYERS.has(layerId) && !deps.externalVerifier) return denied();
    // Only the latest sensor snapshot is kept, so there is nothing to read in historical mode.
    if (layerId === 'parking' && request.mode === 'historical') return denied();
    try {
      const result = await deps.runQuery({ queryId: layerId, request: { ...request, pageSize: execution.rowLimit },
        publicSourceIds: sourceIds, resultBudgetBytes: execution.resultBudgetBytes }, execution);
      const batch = adaptLayerRows(layerId, result.rows, adaptContext(request, resolveSource, deps.clock().toISOString()));
      // News articles name places but never prove an event site, so they reach the map as the
      // areas they name. Each area keeps its latest articles as members within the row limit.
      const groups = layerId === 'news' && deps.loadNewsAreas !== undefined
        ? await deps.loadNewsAreas(request, { coverage, layerCoverage: assessment.coverage, publicSourceIds: sourceIds,
          resolveSource, rowLimit: execution.rowLimit - batch.items.length,
          ...(execution.signal === undefined ? {} : { signal: execution.signal }) })
        : [];
      const items = [...batch.items, ...groups.map((group) => group.aggregate)].sort(compareMapItems);
      // Geometry eligibility can tighten in the adapter; the complete drawable count is
      // exact only after every bounded matching row was successfully converted.
      return { result: finalizeLayerResult({ layerId, assessment, items,
        completeness: result.kind, unresolvedCount: null,
        totalMatching: result.kind === 'complete' ? items.length : null }),
      ...(groups.length === 0 ? {} : { groups }) };
    } catch {
      if (execution.signal?.aborted) throw new MapServiceError('queryTimeout');
      return denied();
    }
  };
}

/** Null-geometry reads within an approved scope; every row must come back unlocated. */
export function createUnlocatedLayerLoader(deps: LayerLoaderDependencies): UnlocatedLayerLoader {
  return async (query, layerId, coverage, scope, execution) => {
    if (!UNLOCATED_LAYERS.has(layerId)) throw new MapServiceError('notAvailable');
    if (EXTERNALLY_VERIFIED_LAYERS.has(layerId) && !deps.externalVerifier) throw new MapServiceError('notAvailable');
    const resolveSource = deps.resolveSource(coverage);
    if (scope.sourceIds.some((id) => resolveSource(id) === null)) throw new MapServiceError('notAvailable');
    try {
      const result = await deps.runQuery({ family: 'unlocated', queryId: layerId,
        request: { ...query, pageSize: execution.rowLimit }, approvedScope: scope,
        resultBudgetBytes: execution.resultBudgetBytes }, execution);
      const batch = adaptLayerRows(layerId, result.rows, adaptContext(query, resolveSource, deps.clock().toISOString()));
      if (batch.items.length !== 0 || batch.unlocatedItems.length !== result.rows.length) throw new MapAdapterError();
      return { items: batch.unlocatedItems, completeness: result.kind,
        totalMatching: result.kind === 'complete' ? batch.unlocatedItems.length : null };
    } catch (error) {
      if (error instanceof MapAdapterError) {
        throw new MapServiceError(error.code === 'notPublic' ? 'notAvailable' : 'serviceUnavailable');
      }
      throw error;
    }
  };
}
