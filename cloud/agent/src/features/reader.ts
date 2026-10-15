import type { LayerId, LayerResult, MapItem, ViewportQuery } from '@melens/shared/contracts/map-contract';
import { parseViewportQuery, sourceReferenceSchema } from '@melens/shared/contracts/map-contract';
import type { MapConfig } from '@melens/shared/config';
import type { PublicSourceReference, PublicSourceResolver } from '@melens/shared/query/adapter-common';
import { createBigQueryViewAdapter, type BigQueryViewAdapter } from '@melens/shared/query/bigquery-adapter';
import { createAnomalyLayerLoader, failSoftAnomalyLayerLoader } from '@melens/shared/query/anomalies';
import { createViewAnomalyProducer } from '@melens/shared/query/anomaly-producer';
import { createViewportLayerLoader } from '@melens/shared/query/layer-loaders';
import { createViewQueryRunner } from '@melens/shared/query/query-runner';
import { createSourceCoverageReader, findPublicSource, type SourceCoverageSnapshot } from '@melens/shared/query/source-coverage';

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
}

/** The same loaders, coverage and admission the map service uses, without its snapshots and pages. */
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
  const readCoverage = createSourceCoverageReader({ runner }).read;
  const resolveSource = (coverage: SourceCoverageSnapshot): PublicSourceResolver => (id) =>
    findPublicSource(coverage, id) === null ? null : references.get(id) ?? null;
  const runQuery = (input: unknown, execution: { readonly signal?: AbortSignal }) => runner.run(input, execution);
  // The same published anomaly results as the map's anomaly layer: the detector's, or the labelled replay of a historical day.
  const loadAnomalyLayer = failSoftAnomalyLayerLoader(createAnomalyLayerLoader({ producer: createViewAnomalyProducer({ runQuery, references }) }));
  const loadLayer = createViewportLayerLoader({ runQuery, resolveSource, clock,
    externalVerifier: false, resolveArea: undefined, loadAnomalyLayer });
  const rowLimit = options.config.maxPageItems;
  const resultBudgetBytes = options.config.maxResponseBytes - options.config.responseEnvelopeReserveBytes;

  return {
    async search(query) {
      const request: ViewportQuery = parseViewportQuery({ requestId: query.requestId, bbox: [...query.bbox], zoom: 15,
        layers: [...query.layers], mode: query.mode, window: { ...query.window } });
      const coverage = await readCoverage(request, { signal: query.signal });
      return Promise.all(query.layers.map(async (layerId): Promise<LayerFeatures> => {
        const loaded = await loadLayer(request, layerId, coverage, { signal: query.signal, rowLimit, resultBudgetBytes });
        return { layerId, state: loaded.result.state, completeness: loaded.result.completeness, items: loaded.result.items };
      }));
    },
  };
}
