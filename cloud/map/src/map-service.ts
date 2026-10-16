import type { MapConfig } from '@melens/shared/config';
import { SERVICE_BBOX, parseMapLayerCatalog, parseViewportQuery, sourceReferenceSchema } from '@melens/shared/contracts/map-contract';
import type { PublicSourceReference, PublicSourceResolver } from '@melens/shared/query/adapter-common';
import { createBigQueryViewAdapter, type BigQueryViewAdapter } from '@melens/shared/query/bigquery-adapter';
import { createCurrentLayerCache, prepareStateLoad } from '@melens/shared/query/current-layer-cache';
import { createAnomalyLayerLoader, consumeVerifiedAnomalyBatch, failSoftAnomalyLayerLoader } from '@melens/shared/query/anomalies';
import { createViewAnomalyProducer } from '@melens/shared/query/anomaly-producer';
import { createUnlocatedLayerLoader, createViewportLayerLoader } from '@melens/shared/query/layer-loaders';
import { createNewsAreaLoader } from '@melens/shared/query/news-areas';
import { createViewQueryRunner } from '@melens/shared/query/query-runner';
import { cacheSourceCoverage, createSourceCoverageReader, findPublicSource, type CoverageAreaResolver, type SourceCoverageSnapshot }
  from '@melens/shared/query/source-coverage';
import { aggregateLayer } from './services/aggregation.js';
import { createDetailService } from './services/details.js';
import { createLayerCatalogService } from './services/layer-catalog.js';
import { createPublicRecordChecker, type CopyStateReader, type PublicRecordChecker } from './services/public-records.js';
import { coverageRequest } from './services/viewport.js';
import { createSnapshotStore, type SnapshotStore } from './services/snapshot-store.js';
import { createUnlocatedService } from './services/unlocated.js';
import { createViewportService, type ViewportLayerAggregator, type ViewportLayerLoader } from './services/viewport.js';

/** The source registry changes per ingest batch, minutes apart; one read serves the requests of this window. */
export const COVERAGE_CACHE_TTL_MS = 30_000;
/** Expired coverage requires a new read before it can authorize access. */
export const COVERAGE_STALE_MS = 0;

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
  /** How long requests share one source registry read; 0 reads it on every use. */
  readonly coverageCacheTtlMs?: number;
  /** How long an expired registry read is still served while a background read replaces it. */
  readonly coverageStaleMs?: number;
  /** Serve current planning, disruption, event, news, parking and anomaly reads from memory per publication (default on). */
  readonly currentLayerCache?: boolean;
  /** Prove current geo rights from the refreshed copy while it reflects every source's latest batch (default on). */
  readonly copyRightsRead?: boolean;
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
  // Current layer rows are shared across viewport loads for the same publication.
  // Record rights can change within that publication and require a live query.
  const layerCache = options.currentLayerCache === false ? null
    : createCurrentLayerCache({ config: options.config, runner, readCoverage, clock });
  const runQuery = (input: unknown, execution: { readonly signal?: AbortSignal }) =>
    layerCache === null ? runner.run(input, execution) : layerCache.runQuery(input, execution);
  const store = options.snapshotStore ?? createSnapshotStore({ clock });
  // A source is public only while it is admitted and published and has a reviewed reference.
  const resolveSource = (coverage: SourceCoverageSnapshot): PublicSourceResolver => (id) =>
    findPublicSource(coverage, id) === null ? null : references.get(id) ?? null;

  // The anomaly layer reads the published results (the detector's, or the labelled replay of a historical day) through
  // its own producer, unless a caller injects one. A stored anomaly stays readable only while the same version still
  // comes back from the published view, so its record check re-reads the view and compares item for item.
  const anomalyProducer = createViewAnomalyProducer({ runQuery, references });
  const anomalyRightsProducer = createViewAnomalyProducer({
    runQuery: (input, execution) => runner.run(input, execution), references });
  const loadAnomalyLayer = options.loadAnomalyLayer ?? failSoftAnomalyLayerLoader(createAnomalyLayerLoader({ producer: anomalyProducer,
    ...(options.resolveArea === undefined ? {} : { resolveArea: options.resolveArea }) }));
  const anomalyConfigured = options.loadAnomalyLayer === undefined ? options.anomalyProducerConfigured !== false
    : options.anomalyProducerConfigured === true;
  const checkAnomalyRecords: PublicRecordChecker = async (items, snapshot, coverage, execution) => {
    try {
      const request = { ...coverageRequest(snapshot), layers: ['anomaly' as const] };
      const batch = consumeVerifiedAnomalyBatch(await anomalyRightsProducer.read(request, { ...execution, rowLimit: options.config.maxPageItems,
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
  // Which batch the refreshed geo copy reflects; shared by requests and read again when it may be behind.
  let copyState: { readonly at: number; readonly value: Promise<ReadonlyMap<string, string | null>> } | null = null;
  // Shared by concurrent requests, so one caller's cancellation does not end the read.
  const readCopyState: CopyStateReader = (_execution, maxAgeMs) => {
    const now = clock().getTime();
    if (copyState === null || now - copyState.at > maxAgeMs) {
      const value = runner.runPrepared(prepareStateLoad(options.config, 1_000), { pageSize: 1_000, byteBudget: 1024 * 1024 }, {})
        .then((result) => {
          if (result.kind !== 'complete') throw new Error('Incomplete copy state');
          return new Map(result.rows.map((row) => [String(row.source_id), typeof row.batch_id === 'string' ? row.batch_id : null]));
        });
      const entry = { at: now, value };
      copyState = entry;
      value.catch(() => { if (copyState === entry) copyState = null; });
    }
    return copyState.value;
  };
  const checkPublicRecords = createPublicRecordChecker({ runQuery, resolveSource, external: externalChecker,
    supplementalVerifier: options.checkPublicRecords !== undefined,
    ...(options.copyRightsRead === false ? {} : { readCopyState }), clock });
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
  const loaders = { runQuery, resolveSource, clock, externalVerifier: options.checkPublicRecords !== undefined,
    resolveArea: options.resolveArea, loadAnomalyLayer, loadNewsAreas: newsAreas?.load };
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

  const warmed = <A extends unknown[], R>(read: (...args: A) => R) => (...args: A): R => { warmNewsAreas(); return read(...args); };
  return { getCatalog: warmed(getCatalog), queryViewport: warmed(viewport.query), getItem: warmed(details.item),
    queryUnlocated: warmed(unlocated.query), getMembers: warmed(details.members), warmNewsAreas };
}
export type MapService = ReturnType<typeof createMapService>;
