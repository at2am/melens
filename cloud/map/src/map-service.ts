import type { MapConfig } from './config.js';
import { parseMapLayerCatalog, sourceReferenceSchema } from './contracts/map-contract.js';
import type { PublicSourceReference, PublicSourceResolver } from './query/adapter-common.js';
import { createBigQueryViewAdapter, type BigQueryViewAdapter } from './query/bigquery-adapter.js';
import { createViewQueryRunner } from './query/query-runner.js';
import { createSourceCoverageReader, findPublicSource, type CoverageAreaResolver, type SourceCoverageSnapshot }
  from './query/source-coverage.js';
import { aggregateLayer } from './services/aggregation.js';
import { createDetailService } from './services/details.js';
import { createLayerCatalogService } from './services/layer-catalog.js';
import { createUnlocatedLayerLoader, createViewportLayerLoader } from './services/layer-loaders.js';
import { createPublicRecordChecker, type PublicRecordChecker } from './services/public-records.js';
import { createSnapshotStore, type SnapshotStore } from './services/snapshot-store.js';
import { createUnlocatedService } from './services/unlocated.js';
import { createViewportService, type ViewportLayerAggregator, type ViewportLayerLoader } from './services/viewport.js';

/** Composition root: wires the query runner, layer loaders, rights checker and page services. */
export function createMapService(options: {
  readonly config: MapConfig; readonly adapter?: BigQueryViewAdapter;
  /** Reviewed attribution/URL metadata; admission alone never invents a public reference. */
  readonly publicSources?: readonly PublicSourceReference[];
  readonly resolveArea?: CoverageAreaResolver; readonly clock?: () => Date;
  readonly snapshotStore?: SnapshotStore;
  readonly loadAnomalyLayer?: ViewportLayerLoader;
  readonly anomalyProducerConfigured?: boolean;
  readonly checkPublicRecords?: PublicRecordChecker;
  readonly aggregateLayer?: ViewportLayerAggregator;
}) {
  const clock = options.clock ?? (() => new Date());
  const references = new Map((options.publicSources ?? []).map((source) => {
    const reference = sourceReferenceSchema.parse(source);
    return [reference.sourceId, reference] as const;
  }));
  const runner = createViewQueryRunner({ config: options.config,
    adapter: options.adapter ?? createBigQueryViewAdapter(options.config) });
  const runQuery = (input: unknown, execution: { readonly signal?: AbortSignal }) => runner.run(input, execution);
  const readCoverage = createSourceCoverageReader({ runner }).read;
  const store = options.snapshotStore ?? createSnapshotStore({ clock });
  // A source is public only while it is admitted and published and has a reviewed reference.
  const resolveSource = (coverage: SourceCoverageSnapshot): PublicSourceResolver => (id) =>
    findPublicSource(coverage, id) === null ? null : references.get(id) ?? null;

  const checkPublicRecords = createPublicRecordChecker({ runQuery, resolveSource, external: options.checkPublicRecords });
  const loaders = { runQuery, resolveSource, clock, externalVerifier: options.checkPublicRecords !== undefined,
    resolveArea: options.resolveArea, loadAnomalyLayer: options.loadAnomalyLayer };
  const shared = { store, readCoverage, clock, checkPublicRecords, maxResponseBytes: options.config.maxResponseBytes };
  const viewport = createViewportService({ ...shared,
    resultEnvelopeReserveBytes: options.config.responseEnvelopeReserveBytes,
    aggregateLayer: options.aggregateLayer ?? aggregateLayer,
    loadLayer: createViewportLayerLoader(loaders) });
  const unlocated = createUnlocatedService({ ...shared,
    resultEnvelopeReserveBytes: options.config.responseEnvelopeReserveBytes,
    loadLayer: createUnlocatedLayerLoader(loaders) });
  const details = createDetailService(shared);
  const catalog = createLayerCatalogService({ readCoverage, clock });

  // Registry metadata alone cannot establish that a reviewed anomaly producer is wired.
  const anomalyServed = options.anomalyProducerConfigured === true && options.loadAnomalyLayer !== undefined
    && options.checkPublicRecords !== undefined;
  async function getCatalog(execution: { readonly signal?: AbortSignal } = {}) {
    const result = await catalog.getCatalog(execution);
    if (anomalyServed) return result;
    return parseMapLayerCatalog({ ...result, layers: result.layers.map((layer) => layer.id === 'anomaly'
      ? { ...layer, availability: 'unavailable', freshness: 'unknown', sourceIds: [], updatedAt: null,
        coverage: { state: 'unknown', areaRefs: [], window: null, evidenceSourceIds: [] } } : layer) }, { production: true });
  }

  return { getCatalog, queryViewport: viewport.query, getItem: details.item,
    queryUnlocated: unlocated.query, getMembers: details.members };
}
export type MapService = ReturnType<typeof createMapService>;
