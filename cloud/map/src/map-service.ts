import type { MapConfig } from '@melens/shared/config';
import { SERVICE_BBOX, parseMapLayerCatalog, parseViewportQuery, sourceReferenceSchema } from '@melens/shared/contracts/map-contract';
import type { PublicSourceReference, PublicSourceResolver } from '@melens/shared/query/adapter-common';
import { createBigQueryViewAdapter, type BigQueryViewAdapter } from '@melens/shared/query/bigquery-adapter';
import { CACHED_LAYERS, createCurrentLayerCache } from '@melens/shared/query/current-layer-cache';
import { createAnomalyLayerLoader, failSoftAnomalyLayerLoader } from '@melens/shared/query/anomalies';
import { createViewAnomalyProducer } from '@melens/shared/query/anomaly-producer';
import { createUnlocatedLayerLoader, createViewportLayerLoader } from '@melens/shared/query/layer-loaders';
import { createNewsAreaLoader } from '@melens/shared/query/news-areas';
import { createViewQueryRunner } from '@melens/shared/query/query-runner';
import { cacheSourceCoverage, createSourceCoverageReader, findPublicSource, type CoverageAreaResolver, type SourceCoverageSnapshot }
  from '@melens/shared/query/source-coverage';
import { aggregateLayer } from './services/aggregation.js';
import { createDetailService } from './services/details.js';
import { createLayerCatalogService } from './services/layer-catalog.js';
import { createUnlocatedService } from './services/unlocated.js';
import { createViewportService, type ViewportLayerAggregator, type ViewportLayerLoader } from './services/viewport.js';

/** The source registry changes per ingest batch, minutes apart; one read serves the requests of this window. */
export const COVERAGE_CACHE_TTL_MS = 30_000;
/**
 * An expired registry read is served for this long while one background read replaces it, so no request waits on
 * the registry. A source that is paused or withdrawn leaves the map within ttl + stale (map-serving-stateless.md).
 */
export const COVERAGE_STALE_MS = 90_000;

/** Composition root: wires the query runner, layer cache, layer loaders and the stateless page services. */
export function createMapService(options: {
  readonly config: MapConfig; readonly adapter?: BigQueryViewAdapter;
  /** Reviewed attribution/URL metadata; admission alone never invents a public reference. */
  readonly publicSources?: readonly PublicSourceReference[];
  readonly resolveArea?: CoverageAreaResolver; readonly clock?: () => Date;
  readonly loadAnomalyLayer?: ViewportLayerLoader;
  readonly anomalyProducerConfigured?: boolean;
  readonly aggregateLayer?: ViewportLayerAggregator;
  /** How long requests share one source registry read; 0 reads it on every use. */
  readonly coverageCacheTtlMs?: number;
  /** How long an expired registry read is still served while a background read replaces it. */
  readonly coverageStaleMs?: number;
  /** Serve current planning, disruption, event, news, parking and anomaly reads from memory per publication (default on). */
  readonly currentLayerCache?: boolean;
  /** Draw current news as the official areas the articles name (UC-06, default on). */
  readonly newsAreas?: boolean;
  /** Load each new news publication's area copy in the background, started by any request (the server sets it). */
  readonly prewarmNewsAreas?: boolean;
}) {
  const clock = options.clock ?? (() => new Date());
  const references = new Map((options.publicSources ?? []).map((source) => {
    const reference = sourceReferenceSchema.parse(source);
    return [reference.sourceId, reference] as const;
  }));
  const adapter = options.adapter ?? createBigQueryViewAdapter(options.config);
  const runner = createViewQueryRunner({ config: options.config, adapter });
  const readCoverage = cacheSourceCoverage(createSourceCoverageReader({ runner }).read, {
    ttlMs: options.coverageCacheTtlMs ?? COVERAGE_CACHE_TTL_MS, staleMs: options.coverageStaleMs ?? COVERAGE_STALE_MS, clock });
  // Current layer rows are shared across every request for the same publication.
  const layerCache = options.currentLayerCache === false ? null
    : createCurrentLayerCache({ config: options.config, runner, readCoverage, clock });
  const runQuery = (input: unknown, execution: { readonly signal?: AbortSignal }) =>
    layerCache === null ? runner.run(input, execution) : layerCache.runQuery(input, execution);
  // A source is public only while it is admitted and published and has a reviewed reference.
  const resolveSource = (coverage: SourceCoverageSnapshot): PublicSourceResolver => (id) =>
    findPublicSource(coverage, id) === null ? null : references.get(id) ?? null;

  // The anomaly layer reads the published results (the detector's, or the labelled replay of a historical day)
  // through its own producer, unless a caller injects one.
  const anomalyProducer = createViewAnomalyProducer({ runQuery, references });
  const loadAnomalyLayer = options.loadAnomalyLayer ?? failSoftAnomalyLayerLoader(createAnomalyLayerLoader({ producer: anomalyProducer,
    ...(options.resolveArea === undefined ? {} : { resolveArea: options.resolveArea }) }));
  const anomalyConfigured = options.loadAnomalyLayer === undefined ? options.anomalyProducerConfigured !== false
    : options.anomalyProducerConfigured === true;
  // The news area copy loads in the background with the longest query time allowed (about 10 s at
  // 7,000 articles); requests read it from memory.
  const newsAreas = options.newsAreas === false ? undefined : createNewsAreaLoader({ config: options.config, clock,
    runner: createViewQueryRunner({ config: { ...options.config, queryTimeoutMs: 30_000 }, adapter }) });
  // With prewarming, every request (and the server start) checks the registry, which is cached for 30 s,
  // and starts loading the copy of a new news publication in the background, so news requests rarely
  // wait for one. Cloud Run gives CPU only while it serves requests, so a timer would not do this.
  const warmNewsAreas = () => {
    if (newsAreas === undefined || options.prewarmNewsAreas !== true) return;
    const end = new Date(clock().getTime());
    end.setUTCSeconds(0, 0);
    const iso = (date: Date) => date.toISOString().replace('.000Z', 'Z');
    let request;
    try {
      request = parseViewportQuery({ requestId: 'news-area-warm', bbox: SERVICE_BBOX, zoom: 10, layers: ['news'],
        mode: 'current', window: { from: iso(new Date(end.getTime() - 15 * 60_000)), to: iso(end) } });
    } catch { return; }
    readCoverage(request).then((coverage) => {
      if (coverage.completeness === 'complete') newsAreas.warm(coverage);
    }, () => {});
  };
  // No layer needs an external record verifier: EXTERNALLY_VERIFIED_LAYERS is empty.
  const loaders = { runQuery, resolveSource, clock, externalVerifier: false,
    resolveArea: options.resolveArea, loadAnomalyLayer, loadNewsAreas: newsAreas?.load };
  const shared = { readCoverage, clock, maxResponseBytes: options.config.maxResponseBytes,
    resultEnvelopeReserveBytes: options.config.responseEnvelopeReserveBytes };
  const viewport = createViewportService({ ...shared,
    aggregateLayer: options.aggregateLayer ?? aggregateLayer,
    loadLayer: createViewportLayerLoader(loaders) });
  const unlocated = createUnlocatedService({ ...shared, loadLayer: createUnlocatedLayerLoader(loaders) });
  const details = createDetailService({ viewport, unlocated, clock, maxResponseBytes: options.config.maxResponseBytes });
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

  /** Loads every cached layer once, so a new instance answers its first requests from memory. Never rejects. */
  const warmLayers = (): Promise<void> => {
    const end = new Date(clock().getTime());
    end.setUTCSeconds(0, 0);
    const iso = (date: Date) => date.toISOString().replace('.000Z', 'Z');
    let request;
    try {
      request = parseViewportQuery({ requestId: 'layer-warm', bbox: SERVICE_BBOX, zoom: 10, layers: [...CACHED_LAYERS],
        mode: 'current', window: { from: iso(new Date(end.getTime() - 15 * 60_000)), to: iso(end) } });
    } catch { return Promise.resolve(); }
    return viewport.loadLayers(request, request.layers).then(() => {}, () => {});
  };

  const warmed = <A extends unknown[], R>(read: (...args: A) => R) => (...args: A): R => { warmNewsAreas(); return read(...args); };
  return { getCatalog: warmed(getCatalog), queryViewport: warmed(viewport.query), getItem: warmed(details.item),
    queryUnlocated: warmed(unlocated.query), getMembers: warmed(details.members), warmNewsAreas, warmLayers };
}
export type MapService = ReturnType<typeof createMapService>;
