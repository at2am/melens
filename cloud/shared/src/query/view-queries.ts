import { z } from 'zod';

import type { MapConfig } from '../config.js';
import type { ViewportQuery } from '../contracts/map-contract.js';
import type { PreparedViewQuery } from './bigquery-adapter.js';
import {
  ANOMALY_COLUMNS, BOUNDARY_COLUMNS, BOUNDARY_ORDER, BOUNDARY_SCHEMES, GEO_COLUMNS, NO_BINDINGS,
  PARKING_COLUMNS, PARKING_ORDER, PEDESTRIAN_COLUMNS, PEDESTRIAN_OBSERVATION_END, PEDESTRIAN_ORDER, bboxBindings, bind, geoOrder, geoTimeFilter,
  geoRightsView, geoView, inJsonArray, isGeoQuery, jsonArray, queryDefaults, recordProjection, recordStatusFilter,
  resultLimit, spatialFilter, timeWindow, topicFilter, usesTimeWindow, viewPath, type ViewName,
} from './sql.js';

export const viewQueryIdSchema = z.enum([
  'planning', 'disruption', 'event', 'news', 'pedestrian', 'anomaly', 'boundary', 'rent', 'census', 'sourceCoverage',
  'parking',
]);
export type ViewQueryId = z.infer<typeof viewQueryIdSchema>;
export type IndicatorFilter = NonNullable<ViewportQuery['areaFilter']>;
export type CurrentGeoRead = 'served' | 'authoritative';

/** Bounded viewport reads over the published views; sql.ts owns every shared fragment. */
export function prepareViewQuery(options: {
  readonly queryId: ViewQueryId;
  readonly request: ViewportQuery;
  readonly config: MapConfig;
  readonly pageSize: number;
  readonly publicSourceIds?: readonly string[];
  /** Server composition only: readers without a later rights recheck need the live current gate. */
  readonly currentGeoRead?: CurrentGeoRead;
}): PreparedViewQuery {
  const { queryId, request, config, pageSize } = options;
  const mode = request.mode;
  const path = (view: ViewName) => viewPath(config, view);
  const defaults = queryDefaults(config, mode, queryId);
  // Admission narrows every family to the sources the caller may currently see.
  const admitted = (column: string) =>
    options.publicSourceIds === undefined ? '' : `AND ${inJsonArray(column, 'publicSourceIdsJson')}`;
  const base = bind(bboxBindings(request.bbox), resultLimit(pageSize),
    options.publicSourceIds === undefined ? NO_BINDINGS : jsonArray('publicSourceIdsJson', options.publicSourceIds));

  if (isGeoQuery(queryId)) {
    const topic = topicFilter(queryId);
    const windowed = usesTimeWindow(queryId, mode);
    return { ...defaults,
      query: `${recordProjection(GEO_COLUMNS)}
        FROM ${path(options.currentGeoRead === 'authoritative' ? geoRightsView(mode) : geoView(mode))} g
        WHERE ${topic.sql} AND ${spatialFilter('g.geometry')} ${admitted('g.source_id')}
          AND ${recordStatusFilter(mode)} ${windowed ? `AND ${geoTimeFilter(queryId, mode)}` : ''}
        ${geoOrder(queryId)}`,
      ...bind(base, topic, windowed ? timeWindow(request.window) : NO_BINDINGS),
    };
  }

  switch (queryId) {
    case 'pedestrian':
      return { ...defaults,
        query: `${recordProjection(PEDESTRIAN_COLUMNS)}
          FROM ${path('v_pedestrian_observations')} p
          WHERE p.observed_at >= @from AND p.observed_at < @to AND ${spatialFilter('p.geometry')} ${admitted('p.source_id')}
            AND p.location_status = 'located' AND p.location_valid_from <= p.observed_at
            AND (p.location_valid_to IS NULL OR p.location_valid_to >= ${PEDESTRIAN_OBSERVATION_END})
          ${PEDESTRIAN_ORDER}`,
        ...bind(base, timeWindow(request.window)),
      };
    case 'anomaly':
      // Results are the published detector or replay rows; the producer validates linkage and time.
      return { ...defaults,
        query: `${recordProjection(ANOMALY_COLUMNS)}
          FROM ${path('v_anomaly_current')} a
          WHERE a.lat BETWEEN @south AND @north AND a.lon BETWEEN @west AND @east ${admitted('a.source_id')}
          ORDER BY a.window_to DESC, a.result_id LIMIT @resultLimit`,
        ...bind(base),
      };
    case 'parking':
      // One small current snapshot, so the scan does not grow with history. Only the viewport's
      // sensors are read; a sensor with no coordinates cannot match the box and is never drawn.
      return { ...defaults,
        query: `${recordProjection(PARKING_COLUMNS)}
          FROM ${path('v_parking_sensor_current')} s
          WHERE s.latitude BETWEEN @south AND @north AND s.longitude BETWEEN @west AND @east ${admitted('s.source_id')}
          ${PARKING_ORDER}`,
        ...bind(base),
      };
    case 'boundary': {
      const filter = request.boundaryFilter;
      if (filter == null || !Object.hasOwn(BOUNDARY_SCHEMES, filter.level)) {
        throw new RangeError('A supported boundary selection is required');
      }
      return { ...defaults,
        query: `${recordProjection(BOUNDARY_COLUMNS)} FROM ${path('v_boundaries')} b
          WHERE b.scheme = @scheme AND b.vintage = @vintage AND ${spatialFilter('b.geometry')} ${admitted('b.source_id')}
          ${BOUNDARY_ORDER}`,
        ...bind(base, { params: { scheme: BOUNDARY_SCHEMES[filter.level], vintage: filter.vintage },
          types: { scheme: 'STRING', vintage: 'STRING' } }),
      };
    }
    case 'rent':
    case 'census': {
      const filter = request.areaFilter;
      if (filter == null) throw new RangeError('A verified indicator selection is required');
      return { ...defaults,
        query: `${recordProjection(`i.indicator_id, i.version_id, i.boundary_id,
          i.boundary_scheme, i.boundary_code, i.boundary_name, i.boundary_vintage,
          ST_ASGEOJSON(i.boundary_geometry) AS geometry_geojson, i.boundary_mapping_status,
          i.period_start, i.period_end, i.value, i.unit, i.status, i.assertion_kind, i.is_prediction,
          i.definition, i.source_area_name, i.source_record_id, i.source_id, i.batch_id, i.fetched_at`)}
          FROM ${path('v_area_indicators')} i
          WHERE i.source_id = @sourceId AND i.indicator_id = @indicatorId
            AND DATE(i.period_start) = @periodStart AND DATE(i.period_end) = @periodEnd
            AND i.boundary_vintage = @vintage AND i.boundary_mapping_status = 'matched'
            AND ${spatialFilter('i.boundary_geometry')} ${admitted('i.source_id')}
          ORDER BY i.boundary_id, i.indicator_id, i.version_id LIMIT @resultLimit`,
        ...bind(base, {
          params: { sourceId: queryId === 'rent' ? 'homes_victoria.rents' : 'abs.census',
            indicatorId: filter.indicatorId, periodStart: filter.periodStart, periodEnd: filter.periodEnd,
            vintage: filter.boundaryVintage },
          types: { sourceId: 'STRING', indicatorId: 'STRING', periodStart: 'DATE', periodEnd: 'DATE', vintage: 'STRING' },
        }),
      };
    }
    case 'sourceCoverage':
      return { ...defaults,
        query: `${recordProjection(`s.source_id, s.topic, s.scope, s.license_status, s.access_status, s.coverage_area_refs,
          s.coverage_from, s.coverage_to, s.health_state, s.latest_published_batch_id,
          s.latest_published_at, s.latest_published_window_from, s.latest_published_window_to,
          s.latest_published_output_count, s.coverage_evidence_state`)}
          FROM ${path('v_source_coverage')} s
          WHERE s.license_status IN ('verified_open', 'restricted') AND s.access_status = 'active'
          ORDER BY s.source_id LIMIT @resultLimit`,
        ...resultLimit(pageSize),
      };
    default: {
      const exhaustive: never = queryId;
      throw new Error(`Unsupported query family: ${exhaustive}`);
    }
  }
}
