import type { MapConfig } from '@melens/shared/config';
import { parseMapLayerCatalog, sourceReferenceSchema } from '@melens/shared/contracts/map-contract';
import type { PublicSourceReference, PublicSourceResolver } from '@melens/shared/query/adapter-common';
import { createBigQueryViewAdapter, type BigQueryViewAdapter } from '@melens/shared/query/bigquery-adapter';
import { createAnomalyLayerLoader, consumeVerifiedAnomalyBatch, failSoftAnomalyLayerLoader } from '@melens/shared/query/anomalies';
import { createViewAnomalyProducer } from '@melens/shared/query/anomaly-producer';
import { createUnlocatedLayerLoader, createViewportLayerLoader } from '@melens/shared/query/layer-loaders';
import { createViewQueryRunner } from '@melens/shared/query/query-runner';
import { createSourceCoverageReader, findPublicSource, type CoverageAreaResolver, type SourceCoverageSnapshot }
  from '@melens/shared/query/source-coverage';
import { aggregateLayer } from './services/aggregation.js';
import { createDetailService } from './services/details.js';
import { createLayerCatalogService } from './services/layer-catalog.js';
import { createPublicRecordChecker, type PublicRecordChecker } from './services/public-records.js';
import { coverageRequest } from './services/viewport.js';
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

  // The anomaly layer reads the published results (the detector's, or the labelled replay of a historical day) through
  // its own producer, unless a caller injects one. A stored anomaly stays readable only while the same version still
  // comes back from the published view, so its record check re-reads the view and compares item for item.
  const anomalyProducer = createViewAnomalyProducer({ runQuery, references });
  const loadAnomalyLayer = options.loadAnomalyLayer ?? failSoftAnomalyLayerLoader(createAnomalyLayerLoader({ producer: anomalyProducer,
    ...(options.resolveArea === undefined ? {} : { resolveArea: options.resolveArea }) }));
  const anomalyConfigured = options.loadAnomalyLayer === undefined ? options.anomalyProducerConfigured !== false
    : options.anomalyProducerConfigured === true;
  const checkAnomalyRecords: PublicRecordChecker = async (items, snapshot, coverage, execution) => {
    try {
      const request = { ...coverageRequest(snapshot), layers: ['anomaly' as const] };
      const batch = consumeVerifiedAnomalyBatch(await anomalyProducer.read(request, { ...execution, rowLimit: options.config.maxPageItems,
        resultBudgetBytes: options.config.maxResponseBytes - options.config.responseEnvelopeReserveBytes }),
      { request, coverage, rowLimit: options.config.maxPageItems, resultBudgetBytes: options.config.maxResponseBytes - options.config.responseEnvelopeReserveBytes });
      const published = new Set(batch.items.map((item) => JSON.stringify(item)));
      return items.every((item) => published.has(JSON.stringify(item)));
    } catch { return false; }
  };
  const externalChecker: PublicRecordChecker | undefined = (options.checkPublicRecords === undefined && !anomalyConfigured) ? undefined
    : async (items, snapshot, coverage, execution) => {
      const anomalies = items.filter((item) => item.layerId === 'anomaly');
      const others = items.filter((item) => item.layerId !== 'anomaly');
      if (others.length > 0 && (options.checkPublicRecords === undefined || !await options.checkPublicRecords(others, snapshot, coverage, execution))) return false;
      return anomalies.length === 0 || (anomalyConfigured && await checkAnomalyRecords(anomalies, snapshot, coverage, execution));
    };
  const checkPublicRecords = createPublicRecordChecker({ runQuery, resolveSource, external: externalChecker });
  const loaders = { runQuery, resolveSource, clock, externalVerifier: options.checkPublicRecords !== undefined,
    resolveArea: options.resolveArea, loadAnomalyLayer };
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
  const anomalyServed = anomalyConfigured;
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
