import type { LayerId, LayerResult, MapItem, UnlocatedQuery, ViewportQuery } from '../contracts/map-contract.js';
import { MapServiceError } from '../errors.js';
import { MapAdapterError, type PublicSourceResolver } from './adapter-common.js';
import { ADAPTED_LAYERS, EXTERNALLY_VERIFIED_LAYERS, UNLOCATED_LAYERS, adaptContext, adaptLayerRows }
  from './layer-adapters.js';
import type { ViewQueryResult } from './query-runner.js';
import { assessLayerCoverage, finalizeLayerResult, sourceBelongsToLayer, type CoverageAreaResolver,
  type SourceCoverageSnapshot } from './source-coverage.js';
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
}

/** Admitted, published sources of one layer that also carry a reviewed public reference. */
export function publicSourceIds(coverage: SourceCoverageSnapshot, layerId: LayerId,
  resolveSource: PublicSourceResolver): string[] {
  return coverage.sources
    .filter((source) => sourceBelongsToLayer(source, layerId) && resolveSource(source.sourceId) !== null)
    .map((source) => source.sourceId);
}

/** Bounded viewport reads: one fixed query per layer, denied rather than guessed when anything is unproven. */
export function createViewportLayerLoader(deps: LayerLoaderDependencies): ViewportLayerLoader {
  return async (request, layerId, coverage, execution) => {
    if (layerId === 'anomaly' && deps.loadAnomalyLayer !== undefined) {
      return deps.loadAnomalyLayer(request, layerId, coverage, execution);
    }
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
      // Geometry eligibility can tighten in the adapter; the complete drawable count is
      // exact only after every bounded matching row was successfully converted.
      return { result: finalizeLayerResult({ layerId, assessment, items: batch.items,
        completeness: result.kind, unresolvedCount: null,
        totalMatching: result.kind === 'complete' ? batch.items.length : null }) };
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
