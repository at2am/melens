import { z } from 'zod';

import type { MapConfig } from '../config.js';
import type { ViewportQuery } from '../contracts/map-contract.js';
import type { PreparedViewQuery } from './bigquery-adapter.js';

export const viewQueryIdSchema = z.enum([
  'planning', 'disruption', 'event', 'news', 'pedestrian', 'boundary', 'rent', 'census', 'sourceCoverage',
]);
export type ViewQueryId = z.infer<typeof viewQueryIdSchema>;
export type IndicatorFilter = NonNullable<ViewportQuery['areaFilter']>;

type ViewName = 'v_geo_records_current' | 'v_geo_records_history' | 'v_pedestrian_observations'
  | 'v_boundaries' | 'v_area_indicators' | 'v_source_coverage';

const geoFields = `g.geo_record_id, g.version_id, g.source_id, g.topic, g.assertion_kind,
  g.is_prediction, g.title, g.summary, g.original_url, g.geometry_geojson,
  g.location_role, g.location_confidence, g.area_refs, g.observed_at, g.published_at,
  g.valid_from, g.valid_to, g.fetched_at, g.freshness_state, g.record_status`;

const boundarySchemes = {
  GCCSA: 'ASGS_GCCSA', LGA: 'ASGS_LGA', SA2: 'ASGS_SA2', STE: 'ASGS_STE',
  CLUE_BLOCK: 'com_clue_block', MUNICIPAL: 'com_municipal',
};

/** Only this module composes SQL; every identifier is a server-owned literal. */
export function prepareViewQuery(options: {
  readonly queryId: ViewQueryId;
  readonly request: ViewportQuery;
  readonly config: MapConfig;
  readonly pageSize: number;
  readonly publicSourceIds?: readonly string[];
}): PreparedViewQuery {
  const { queryId, request, config, pageSize } = options;
  const path = (view: ViewName) => `\`${config.projectId}.melens_query.${view}\``;
  const [west, south, east, north] = request.bbox;
  const publicParams = options.publicSourceIds === undefined ? {} : { publicSourceIdsJson: JSON.stringify(options.publicSourceIds) };
  const publicTypes = options.publicSourceIds === undefined ? {} : { publicSourceIdsJson: 'STRING' } satisfies PreparedViewQuery['types'];
  const admitted = (column: string) => options.publicSourceIds === undefined ? '' : `AND ${column} IN UNNEST(JSON_VALUE_ARRAY(@publicSourceIdsJson))`;
  const baseParams = { west, south, east, north, resultLimit: pageSize + 1, ...publicParams };
  const baseTypes = { west: 'FLOAT64', south: 'FLOAT64', east: 'FLOAT64', north: 'FLOAT64',
    resultLimit: 'INT64', ...publicTypes } satisfies PreparedViewQuery['types'];
  const spatial = (column: string) => `${column} IS NOT NULL
    AND ST_INTERSECTSBOX(${column}, @west, @south, @east, @north)`;
  const defaults = {
    location: config.location,
    maximumBytesBilled: String(request.mode === 'historical'
      || queryId === 'boundary' || queryId === 'rent' || queryId === 'census'
      ? config.historicalScanBytes : config.dynamicScanBytes),
    jobTimeoutMs: config.queryTimeoutMs,
  };

  switch (queryId) {
    case 'planning':
    case 'disruption':
    case 'event':
    case 'news': {
      const topic = { planning: 'planning', disruption: 'transport', event: 'event', news: 'news' }[queryId];
      const topicCondition = queryId === 'disruption' ? 'g.topic IN (@topic, @roadTopic)' : 'g.topic = @topic';
      const timeStart = queryId === 'news' ? 'COALESCE(g.published_at, g.observed_at)'
        : 'COALESCE(g.valid_from, g.observed_at, g.published_at)';
      const knownTemporal = queryId === 'news'
        ? `${timeStart} >= @from AND ${timeStart} < @to`
        : `${timeStart} < @to
           AND (g.valid_to IS NULL OR g.valid_to > @from)`;
      // Current planning is a complete source snapshot, not an invented dated
      // event. Dynamic unknown clocks stay explicit in current context only.
      const usesWindow = !(queryId === 'planning' && request.mode === 'current');
      const temporal = request.mode === 'current'
        ? queryId === 'news' ? `(${timeStart} IS NULL OR (${knownTemporal}))`
          : `(${timeStart} IS NULL OR ${timeStart} < @to) AND (g.valid_to IS NULL OR g.valid_to > @from)`
        : knownTemporal;
      return { ...defaults,
        query: `SELECT TO_JSON_STRING(STRUCT(${geoFields})) AS record
          FROM ${path(request.mode === 'current' ? 'v_geo_records_current' : 'v_geo_records_history')} g
          WHERE ${topicCondition} AND ${spatial('g.geometry')} ${admitted('g.source_id')}
            AND ${request.mode === 'current' ? "g.record_status IN ('active', 'planned')" : "g.record_status != 'withdrawn'"} ${usesWindow ? `AND ${temporal}` : ''}
          ORDER BY g.geo_record_id, g.version_id LIMIT @resultLimit`,
        params: { ...baseParams, topic, ...(queryId === 'disruption' ? { roadTopic: 'road_disruption' } : {}),
          ...(usesWindow ? { from: request.window.from, to: request.window.to } : {}) },
        types: { ...baseTypes, topic: 'STRING', ...(queryId === 'disruption' ? { roadTopic: 'STRING' } satisfies
          PreparedViewQuery['types'] : {}), ...(usesWindow ? { from: 'TIMESTAMP', to: 'TIMESTAMP' } satisfies
          PreparedViewQuery['types'] : {}) },
      };
    }
    case 'pedestrian':
      return { ...defaults,
        query: `SELECT TO_JSON_STRING(STRUCT(p.source_id, p.batch_id, p.sensor_id, p.observed_at,
          p.direction_a_count, p.direction_b_count, p.total_count, p.record_granularity, p.fetched_at,
          p.source_last_success_at, p.location_source_id, p.location_valid_from, p.location_valid_to,
          p.geometry_geojson, p.location_status, p.source_freshness_state)) AS record
          FROM ${path('v_pedestrian_observations')} p
          WHERE p.observed_at >= @from AND p.observed_at < @to AND ${spatial('p.geometry')} ${admitted('p.source_id')}
            AND p.location_status = 'located' AND p.location_valid_from <= p.observed_at
            AND (p.location_valid_to IS NULL OR p.location_valid_to >=
              CASE p.record_granularity WHEN 'sensor_minute' THEN TIMESTAMP_ADD(p.observed_at, INTERVAL 1 MINUTE)
                WHEN 'sensor_hour' THEN TIMESTAMP_ADD(p.observed_at, INTERVAL 1 HOUR) END)
          ORDER BY p.source_id, p.sensor_id, p.observed_at, p.batch_id LIMIT @resultLimit`,
        params: { ...baseParams, from: request.window.from, to: request.window.to },
        types: { ...baseTypes, from: 'TIMESTAMP', to: 'TIMESTAMP' },
      };
    case 'boundary': {
      const filter = request.boundaryFilter;
      if (filter == null || !(filter.level in boundarySchemes)) {
        throw new RangeError('A supported boundary selection is required');
      }
      const scheme = Object.entries(boundarySchemes).find(([level]) => level === filter.level)?.[1];
      if (scheme === undefined) throw new RangeError('A supported boundary selection is required');
      return { ...defaults,
        query: `SELECT TO_JSON_STRING(STRUCT(b.boundary_id, b.version_id, b.scheme, b.code, b.name,
          b.vintage, b.geometry_geojson, b.valid_from, b.valid_to, b.source_record_id, b.source_id,
          b.batch_id, b.fetched_at)) AS record FROM ${path('v_boundaries')} b
          WHERE b.scheme = @scheme AND b.vintage = @vintage AND ${spatial('b.geometry')} ${admitted('b.source_id')}
          ORDER BY b.boundary_id, b.version_id LIMIT @resultLimit`,
        params: { ...baseParams, scheme, vintage: filter.vintage },
        types: { ...baseTypes, scheme: 'STRING', vintage: 'STRING' },
      };
    }
    case 'rent':
    case 'census': {
      const filter = request.areaFilter;
      if (filter == null) throw new RangeError('A verified indicator selection is required');
      return { ...defaults,
        query: `SELECT TO_JSON_STRING(STRUCT(i.indicator_id, i.version_id, i.boundary_id,
          i.boundary_scheme, i.boundary_code, i.boundary_name, i.boundary_vintage,
          ST_ASGEOJSON(i.boundary_geometry) AS geometry_geojson, i.boundary_mapping_status,
          i.period_start, i.period_end, i.value, i.unit, i.status, i.assertion_kind, i.is_prediction,
          i.definition, i.source_area_name, i.source_record_id, i.source_id, i.batch_id, i.fetched_at)) AS record
          FROM ${path('v_area_indicators')} i
          WHERE i.source_id = @sourceId AND i.indicator_id = @indicatorId
            AND DATE(i.period_start) = @periodStart AND DATE(i.period_end) = @periodEnd
            AND i.boundary_vintage = @vintage AND i.boundary_mapping_status = 'matched'
            AND ${spatial('i.boundary_geometry')} ${admitted('i.source_id')}
          ORDER BY i.boundary_id, i.indicator_id, i.version_id LIMIT @resultLimit`,
        params: { ...baseParams, sourceId: queryId === 'rent' ? 'homes_victoria.rents' : 'abs.census',
          indicatorId: filter.indicatorId, periodStart: filter.periodStart, periodEnd: filter.periodEnd,
          vintage: filter.boundaryVintage },
        types: { ...baseTypes, sourceId: 'STRING', indicatorId: 'STRING', periodStart: 'DATE',
          periodEnd: 'DATE', vintage: 'STRING' },
      };
    }
    case 'sourceCoverage':
      return { ...defaults,
        query: `SELECT TO_JSON_STRING(STRUCT(s.source_id, s.topic, s.scope, s.license_status, s.access_status, s.coverage_area_refs,
          s.coverage_from, s.coverage_to, s.health_state, s.latest_published_batch_id,
          s.latest_published_at, s.latest_published_window_from, s.latest_published_window_to,
          s.latest_published_output_count, s.coverage_evidence_state)) AS record
          FROM ${path('v_source_coverage')} s
          WHERE s.license_status IN ('verified_open', 'restricted') AND s.access_status = 'active'
          ORDER BY s.source_id LIMIT @resultLimit`,
        params: { resultLimit: pageSize + 1 }, types: { resultLimit: 'INT64' },
      };
    default: {
      const exhaustive: never = queryId;
      throw new Error(`Unsupported query family: ${exhaustive}`);
    }
  }
}
