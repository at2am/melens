import type { MapConfig } from './config.js';
import { createBigQueryViewAdapter, type BigQueryViewAdapter } from './query/bigquery-adapter.js';
import { createViewQueryRunner, type ViewQueryResult, type ViewRow } from './query/query-runner.js';
import { findPublicSource, createSourceCoverageReader, assessLayerCoverage, finalizeLayerResult,
  sourceBelongsToLayer, type CoverageAreaResolver, type SourceCoverageSnapshot } from './query/source-coverage.js';
import { type LayerId, type MapItem, sourceReferenceSchema, parseMapLayerCatalog } from './contracts/map-contract.js';
import { adaptPlanningRows } from './query/planning.js';
import { adaptBoundaryRows } from './query/boundaries.js';
import { adaptPedestrianRows } from './query/pedestrian.js';
import { adaptDisruptionRows } from './query/disruptions.js';
import { adaptEventRows } from './query/events.js';
import { MapAdapterError, type PublishedItemBatch, type PublicSourceReference, type PublicSourceResolver } from './query/adapter-common.js';
import { createLayerCatalogService } from './services/layer-catalog.js';
import { createViewportService, coverageRequest, type SnapshotAccess, type ViewportLayerLoader,
  type ViewportLayerAggregator } from './services/viewport.js';
import { aggregateLayer } from './services/aggregation.js';
import { createDetailService } from './services/details.js';
import { createUnlocatedService } from './services/unlocated.js';
import { createSnapshotStore, MapServiceError, type SnapshotStore } from './services/snapshot-store.js';

export function createMapService(options: {
  readonly config: MapConfig; readonly adapter?: BigQueryViewAdapter;
  /** Reviewed attribution/URL metadata; admission alone never invents a public reference. */
  readonly publicSources?: readonly PublicSourceReference[];
  readonly resolveArea?: CoverageAreaResolver; readonly clock?: () => Date;
  readonly snapshotStore?: SnapshotStore;
  readonly loadAnomalyLayer?: ViewportLayerLoader;
  readonly anomalyProducerConfigured?: boolean;
  readonly checkPublicRecords?: SnapshotAccess['checkPublicRecords'];
  readonly aggregateLayer?: ViewportLayerAggregator;
}) {
  const references = new Map((options.publicSources ?? []).map((source) => {
    const reference = sourceReferenceSchema.parse(source);
    return [reference.sourceId, reference] as const;
  }));
  const runner = createViewQueryRunner({ config: options.config,
    adapter: options.adapter ?? createBigQueryViewAdapter(options.config) });
  const readCoverage = createSourceCoverageReader({ runner }).read;
  const store = options.snapshotStore ?? createSnapshotStore(options.clock === undefined ? {} : { clock: options.clock });
  const shared = { store, readCoverage, ...(options.clock === undefined ? {} : { clock: options.clock }),
    maxResponseBytes: options.config.maxResponseBytes,
    async checkPublicRecords(items: readonly MapItem[], snapshot: import('./services/snapshot-store.js').StoredSnapshot,
      coverage: SourceCoverageSnapshot, execution: { readonly signal?: AbortSignal }): Promise<boolean> {
      const unique = [...new Map(items.map((item) => [JSON.stringify([item.layerId, item.id, item.versionId]), item])).values()];
      const ordinaryLayers = ['planning', 'boundary', 'pedestrian', 'disruption', 'event'];
      // Existing boundary/pedestrian views do not yet prove latest record-level rights
      // withdrawal. They require a trusted supplemental verifier until that view gate is repaired.
      const externalItems = unique.filter((item) => !ordinaryLayers.includes(item.layerId)
        || item.layerId === 'boundary' || item.layerId === 'pedestrian');
      if (externalItems.length > 0 && (options.checkPublicRecords === undefined
        || !await options.checkPublicRecords(externalItems, snapshot, coverage, execution))) return false;
      const request = coverageRequest(snapshot);
      const { cursor: _cursor, snapshotId: _snapshotId, ...context } = request;
      try {
        for (const layerId of [...new Set(unique.filter((item) => ordinaryLayers.includes(item.layerId)).map((item) => item.layerId))]) {
          const expected = unique.filter((item) => item.layerId === layerId);
          const result = await runner.run({ family: 'publicRecords', queryId: layerId, request: { ...context, pageSize: 1_000 },
            recordKeys: expected.map((item) => ({ id: item.id, versionId: item.versionId, sourceId: item.sources[0]!.sourceId,
              ...(item.kind === 'pedestrian' ? { sensorId: item.details.sensorId, observedAt: item.time.observedAt } : {}) })) }, execution);
          const actual = adapt(result.rows, layerId, snapshot.request, coverage, new Date(snapshot.createdAt).toISOString());
          const publicItems = [...actual.items, ...actual.unlocatedItems];
          const publicIdentities = new Set(publicItems.map((item) => JSON.stringify(item)));
          if (!expected.every((item) => publicIdentities.has(JSON.stringify(item)))) return false;
        }
        return true;
      } catch { return false; }
    } };
  const resolver = (coverage: SourceCoverageSnapshot): PublicSourceResolver => (id) =>
    findPublicSource(coverage, id) === null ? null : references.get(id) ?? null;
  function sources(coverage: SourceCoverageSnapshot, layer: LayerId) {
    return coverage.sources.filter((source) => sourceBelongsToLayer(source, layer)
      && resolver(coverage)(source.sourceId) !== null).map((source) => source.sourceId);
  }
  function adapt(rows: readonly ViewRow[], layerId: LayerId, request: {
    mode: 'current' | 'historical'; boundaryFilter?: { level: 'GCCSA' | 'LGA' | 'SA2' | 'STE' | 'CLUE_BLOCK' | 'MUNICIPAL'; vintage: string } | null | undefined;
  }, coverage: SourceCoverageSnapshot, asOf = (options.clock?.() ?? new Date()).toISOString()): PublishedItemBatch {
    const resolveSource = resolver(coverage);
    // Public reference URLs come from reviewed source metadata rather than provider rows.
    rows = rows.map((row) => Object.hasOwn(row, 'original_url') ? { ...row, original_url: resolveSource(String(row.source_id))?.url ?? null } : row);
    switch (layerId) {
      case 'planning': return adaptPlanningRows(rows, { resolveSource, mode: request.mode });
      case 'boundary': {
        if (request.boundaryFilter == null) throw new MapServiceError('invalidRequest');
        return adaptBoundaryRows(rows, { resolveSource, selection: request.boundaryFilter });
      }
      case 'pedestrian': return adaptPedestrianRows(rows, { resolveSource, mode: request.mode });
      case 'disruption': return adaptDisruptionRows(rows, { resolveSource, mode: request.mode, asOf });
      case 'event': return adaptEventRows(rows, { resolveSource, mode: request.mode, asOf });
      default: throw new MapServiceError('notAvailable');
    }
  }
  const viewport = createViewportService({ ...shared,
    resultEnvelopeReserveBytes: options.config.responseEnvelopeReserveBytes,
    aggregateLayer: options.aggregateLayer ?? aggregateLayer,
    async loadLayer(request, layerId, coverage, execution) {
      if (layerId === 'anomaly' && options.loadAnomalyLayer !== undefined) return options.loadAnomalyLayer(request, layerId, coverage, execution);
      const assessment = assessLayerCoverage({ snapshot: coverage, layerId, request,
        ...(options.resolveArea === undefined ? {} : { resolveArea: options.resolveArea }) });
      const denied = () => ({ result: finalizeLayerResult({ layerId, assessment, items: [], completeness: 'partial',
        unresolvedCount: null, totalMatching: null, querySucceeded: false }) });
      const publicSourceIds = sources(coverage, layerId);
      if (publicSourceIds.length === 0) {
        if (assessment.sourceIds.length !== 0) return denied();
        return { result: finalizeLayerResult({ layerId, assessment, items: [], completeness: 'complete',
          unresolvedCount: null, totalMatching: null }) };
      }
      if (!['planning', 'boundary', 'pedestrian', 'disruption', 'event'].includes(layerId)) return denied();
      if ((layerId === 'boundary' || layerId === 'pedestrian') && options.checkPublicRecords === undefined) return denied();
      try {
        const result = await runner.run({ queryId: layerId, request: { ...request, pageSize: execution.rowLimit },
          publicSourceIds, resultBudgetBytes: execution.resultBudgetBytes }, execution);
        const batch = adapt(result.rows, layerId, request, coverage);
        // Geometry eligibility can tighten in the adapter; complete drawable count is
        // exact only after every bounded matching row was successfully converted.
        const layer = finalizeLayerResult({ layerId, assessment, items: batch.items,
          completeness: result.kind, unresolvedCount: null,
          totalMatching: result.kind === 'complete' ? batch.items.length : null });
        return { result: layer };
      } catch (error) {
        if (execution.signal?.aborted) throw new MapServiceError('queryTimeout');
        return denied();
      }
    },
  });
  const unlocated = createUnlocatedService({ ...shared,
    resultEnvelopeReserveBytes: options.config.responseEnvelopeReserveBytes,
    async loadLayer(query, layerId, coverage, scope, execution) {
      if (!['planning', 'pedestrian', 'disruption', 'event'].includes(layerId)) throw new MapServiceError('notAvailable');
      if (layerId === 'pedestrian' && options.checkPublicRecords === undefined) throw new MapServiceError('notAvailable');
      if (scope.sourceIds.some((id) => resolver(coverage)(id) === null)) throw new MapServiceError('notAvailable');
      let result: ViewQueryResult;
      try {
        result = await runner.run({ family: 'unlocated', queryId: layerId,
          request: { ...query, pageSize: execution.rowLimit }, approvedScope: scope,
          resultBudgetBytes: execution.resultBudgetBytes }, execution);
        const batch = adapt(result.rows, layerId, query, coverage);
        if (batch.items.length !== 0 || batch.unlocatedItems.length !== result.rows.length) throw new MapAdapterError();
        return { items: batch.unlocatedItems, completeness: result.kind,
          totalMatching: result.kind === 'complete' ? batch.unlocatedItems.length : null };
      } catch (error) {
        if (error instanceof MapAdapterError) throw new MapServiceError(error.code === 'notPublic' ? 'notAvailable' : 'serviceUnavailable');
        throw error;
      }
    },
  });
  const details = createDetailService(shared);
  const catalog = createLayerCatalogService({ readCoverage,
    ...(options.clock === undefined ? {} : { clock: options.clock }) });
  const getCatalog = async (execution: { readonly signal?: AbortSignal } = {}) => {
    const result = await catalog.getCatalog(execution);
    if (options.anomalyProducerConfigured === true && options.loadAnomalyLayer !== undefined && options.checkPublicRecords !== undefined) return result;
    return parseMapLayerCatalog({ ...result, layers: result.layers.map((layer) => layer.id === 'anomaly'
      ? { ...layer, availability: 'unavailable', freshness: 'unknown', sourceIds: [], updatedAt: null,
        coverage: { state: 'unknown', areaRefs: [], window: null, evidenceSourceIds: [] } } : layer) }, { production: true });
  };
  return { getCatalog, queryViewport: viewport.query, getItem: details.item,
    queryUnlocated: unlocated.query, getMembers: details.members };
}
export type MapService = ReturnType<typeof createMapService>;
