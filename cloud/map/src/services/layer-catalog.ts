import {
  MAP_SCHEMA_VERSION, SERVICE_BBOX, parseMapLayerCatalog, parseViewportQuery,
  type MapLayerCatalog,
} from '@melens/shared/contracts/map-contract';
import { MapQueryError } from '@melens/shared/query/query-runner';
import { assessLayerCoverage, type SourceCoverageReader } from '@melens/shared/query/source-coverage';

type Registration = Pick<MapLayerCatalog['layers'][number],
  'id' | 'titleKey' | 'topic' | 'defaultEnabled' | 'supportedModes' | 'timeSemantics'>;

export const LAYER_REGISTRATIONS: readonly Registration[] = [
  { id: 'pedestrian', titleKey: 'mapLayerPedestrian', topic: 'cityActivity', defaultEnabled: true,
    supportedModes: ['current', 'historical'], timeSemantics: 'observationWindow' },
  { id: 'anomaly', titleKey: 'mapLayerAnomaly', topic: 'cityActivity', defaultEnabled: true,
    supportedModes: ['current', 'historical'], timeSemantics: 'observationWindow' },
  { id: 'disruption', titleKey: 'mapLayerDisruption', topic: 'cityActivity', defaultEnabled: true,
    supportedModes: ['current', 'historical'], timeSemantics: 'effectiveInterval' },
  { id: 'event', titleKey: 'mapLayerEvent', topic: 'cityActivity', defaultEnabled: false,
    supportedModes: ['current', 'historical'], timeSemantics: 'effectiveInterval' },
  { id: 'planning', titleKey: 'mapLayerPlanning', topic: 'cityActivity', defaultEnabled: false,
    supportedModes: ['current', 'historical'], timeSemantics: 'effectiveInterval' },
  // UC-15. Off by default and current-only: the warehouse keeps just the latest sensor snapshot,
  // so there is no historical parking read. The reading's own report time is its observation window.
  { id: 'parking', titleKey: 'mapLayerParking', topic: 'cityActivity', defaultEnabled: false,
    supportedModes: ['current'], timeSemantics: 'observationWindow' },
  { id: 'boundary', titleKey: 'mapLayerBoundary', topic: 'context', defaultEnabled: false,
    supportedModes: ['current', 'historical'], timeSemantics: 'boundaryVintage' },
  { id: 'news', titleKey: 'mapLayerNews', topic: 'nearbyNews', defaultEnabled: false,
    supportedModes: ['current', 'historical'], timeSemantics: 'reportedAt' },
  { id: 'rent', titleKey: 'mapLayerRent', topic: 'areaComparison', defaultEnabled: false,
    supportedModes: ['current', 'historical'], timeSemantics: 'statisticalPeriod' },
  { id: 'census', titleKey: 'mapLayerCensus', topic: 'areaComparison', defaultEnabled: false,
    supportedModes: ['current', 'historical'], timeSemantics: 'statisticalPeriod' },
];

export function createLayerCatalogService(options: {
  readonly readCoverage: SourceCoverageReader;
  readonly clock?: () => Date;
}) {
  return {
    async getCatalog(execution: { readonly signal?: AbortSignal } = {}): Promise<MapLayerCatalog> {
      try {
        const generatedAt = (options.clock?.() ?? new Date()).toISOString();
        const from = new Date(Date.parse(generatedAt) - 60_000).toISOString();
        // The fixed source query ignores area/time. This valid internal context
        // is only an execution input and is never presented as coverage proof.
        const request = parseViewportQuery({ requestId: 'catalog', bbox: [...SERVICE_BBOX], zoom: 0,
          layers: ['planning'], mode: 'current', window: { from, to: generatedAt } });
        const snapshot = await options.readCoverage(request, execution);
        const layers = LAYER_REGISTRATIONS.map((registration) => {
          const status = assessLayerCoverage({ snapshot, layerId: registration.id });
          return { ...registration, supportedModes: [...registration.supportedModes],
            sourceIds: [...status.sourceIds], availability: status.availability,
            freshness: status.freshness, coverage: status.coverage, updatedAt: status.updatedAt };
        });
        return parseMapLayerCatalog({ schemaVersion: MAP_SCHEMA_VERSION, generatedAt, dataMode: 'live',
          serviceBounds: [...SERVICE_BBOX], layers }, { production: true });
      } catch (error) {
        if (error instanceof MapQueryError) throw error;
        throw new MapQueryError('serviceUnavailable');
      }
    },
  };
}
