import type { LayerId, LayerResult, MapItem, ViewportQuery } from '@melens/shared/contracts/map-contract';
import { SERVICE_BBOX, parseViewportQuery, sourceReferenceSchema } from '@melens/shared/contracts/map-contract';
import type { MapConfig } from '@melens/shared/config';
import type { PublicSourceReference, PublicSourceResolver } from '@melens/shared/query/adapter-common';
import { createBigQueryViewAdapter, type BigQueryViewAdapter } from '@melens/shared/query/bigquery-adapter';
import { createAnomalyLayerLoader, failSoftAnomalyLayerLoader } from '@melens/shared/query/anomalies';
import { createViewAnomalyProducer } from '@melens/shared/query/anomaly-producer';
import { createViewportLayerLoader } from '@melens/shared/query/layer-loaders';
import { CACHED_LAYERS, createCurrentLayerCache } from '@melens/shared/query/current-layer-cache';
import { createViewQueryRunner } from '@melens/shared/query/query-runner';
import { cacheSourceCoverage, createSourceCoverageReader, findPublicSource, type SourceCoverageSnapshot }
  from '@melens/shared/query/source-coverage';

export interface FeatureSearch {
  readonly requestId: string;
  /** West, south, east, north. */
  readonly bbox: readonly [number, number, number, number];
  readonly layers: readonly LayerId[];
  /** UTC instants. */
  readonly window: { readonly from: string; readonly to: string };
  readonly mode: 'current' | 'historical';
  readonly signal: AbortSignal;
}

export interface LayerFeatures {
  readonly layerId: LayerId;
  readonly state: LayerResult['state'];
  readonly completeness: LayerResult['completeness'];
  readonly items: readonly MapItem[];
}

/** Located features of the published views for a box, layer by layer, under the shared query rules. */
export interface FeatureReader {
  search(query: FeatureSearch): Promise<LayerFeatures[]>;
  /** Loads the in-memory layers once, so the first turn on a new instance does not wait for them. Never rejects. */
  warm?(): Promise<void>;
}

/** How long searches share one source registry read, and how long an expired one still answers while it is replaced (as the map service). */
const COVERAGE_CACHE_TTL_MS = 30_000;
const COVERAGE_STALE_MS = 90_000;

/**
 * The same loaders, coverage, admission and in-memory current layers the map service uses
 * (system-design/map-serving-stateless.md, phase 2), without its snapshots and pages. Current
 * planning, disruption, event, news, parking and anomaly searches are answered from a copy that
 * is reloaded when a source publishes or after two minutes, so a withdrawal reaches the agent
 * as it reaches the map. Reading the authoritative current view per search instead rebuilt
 * "current" from the whole history and outgrew the scan ceiling (budgetExceeded, 2026-10-17).
 */
export function createSharedFeatureReader(options: {
  readonly config: MapConfig;
  readonly adapter?: BigQueryViewAdapter;
  readonly publicSources: readonly PublicSourceReference[];
  readonly clock?: () => Date;
}): FeatureReader {
  const clock = options.clock ?? (() => new Date());
  const references = new Map(options.publicSources.map((source) => {
    const reference = sourceReferenceSchema.parse(source);
    return [reference.sourceId, reference] as const;
  }));
  const runner = createViewQueryRunner({ config: options.config, adapter: options.adapter ?? createBigQueryViewAdapter(options.config) });
  const readCoverage = cacheSourceCoverage(createSourceCoverageReader({ runner }).read,
    { ttlMs: COVERAGE_CACHE_TTL_MS, staleMs: COVERAGE_STALE_MS, clock });
  const layerCache = createCurrentLayerCache({ config: options.config, runner, readCoverage, clock });
  const resolveSource = (coverage: SourceCoverageSnapshot): PublicSourceResolver => (id) =>
    findPublicSource(coverage, id) === null ? null : references.get(id) ?? null;
  const runQuery = (input: unknown, execution: { readonly signal?: AbortSignal }) => layerCache.runQuery(input, execution);
  // The same published anomaly results as the map's anomaly layer: the detector's, or the labelled replay of a historical day.
  const loadAnomalyLayer = failSoftAnomalyLayerLoader(createAnomalyLayerLoader({ producer: createViewAnomalyProducer({ runQuery, references }) }));
  const loadLayer = createViewportLayerLoader({ runQuery, resolveSource, clock,
    externalVerifier: false, resolveArea: undefined, loadAnomalyLayer });
  const rowLimit = options.config.maxPageItems;
  const resultBudgetBytes = options.config.maxResponseBytes - options.config.responseEnvelopeReserveBytes;

  const search: FeatureReader['search'] = async (query) => {
    const request: ViewportQuery = parseViewportQuery({ requestId: query.requestId, bbox: [...query.bbox], zoom: 15,
      layers: [...query.layers], mode: query.mode, window: { ...query.window } });
    const coverage = await readCoverage(request, { signal: query.signal });
    return Promise.all(query.layers.map(async (layerId): Promise<LayerFeatures> => {
      const loaded = await loadLayer(request, layerId, coverage, { signal: query.signal, rowLimit, resultBudgetBytes });
      return { layerId, state: loaded.result.state, completeness: loaded.result.completeness, items: loaded.result.items };
    }));
  };
  return {
    search,
    // As the map service does at start: a cold first search took about 12 s on 2026-10-17.
    async warm() {
      const end = new Date(clock().getTime());
      end.setUTCSeconds(0, 0);
      const iso = (date: Date) => date.toISOString().replace('.000Z', 'Z');
      try {
        await search({ requestId: 'agent-layer-warm', bbox: SERVICE_BBOX, layers: [...CACHED_LAYERS], mode: 'current',
          window: { from: iso(new Date(end.getTime() - 15 * 60_000)), to: iso(end) }, signal: new AbortController().signal });
      } catch { /* A later search loads what this could not. */ }
    },
  };
}
