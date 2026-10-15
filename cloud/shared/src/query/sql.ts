import type { MapConfig } from '../config.js';
import type { Bbox, BoundaryLevel, TimeWindow } from '../contracts/map-contract.js';
import type { PreparedViewQuery } from './bigquery-adapter.js';
import type { ViewQueryId } from './view-queries.js';

/*
 * SQL fragments shared by the viewport, unlocated and public-record query families.
 * Every identifier here is a server-owned literal; request values travel only as named
 * parameters. The row adapters validate exactly the projected columns, so a column change
 * happens here once and reaches every family.
 */

export type ViewName = 'v_geo_records_current' | 'v_geo_records_history' | 'v_pedestrian_observations'
  | 'v_boundaries' | 'v_area_indicators' | 'v_source_coverage' | 'v_anomaly_current' | 'v_parking_sensor_current';
export type QueryMode = 'current' | 'historical';

export interface QueryBindings {
  readonly params: PreparedViewQuery['params'];
  readonly types: PreparedViewQuery['types'];
}

export const NO_BINDINGS: QueryBindings = { params: {}, types: {} };

export function bind(...parts: readonly QueryBindings[]): QueryBindings {
  return parts.reduce<QueryBindings>((merged, part) => ({
    params: { ...merged.params, ...part.params }, types: { ...merged.types, ...part.types },
  }), NO_BINDINGS);
}

export const viewPath = (config: MapConfig, view: ViewName): string =>
  `\`${config.projectId}.melens_query.${view}\``;
export const geoView = (mode: QueryMode): ViewName =>
  mode === 'current' ? 'v_geo_records_current' : 'v_geo_records_history';

export const GEO_COLUMNS = `g.geo_record_id, g.version_id, g.source_id, g.topic, g.assertion_kind,
  g.is_prediction, g.title, g.summary, g.original_url, g.geometry_geojson,
  g.location_role, g.location_confidence, g.area_refs, g.observed_at, g.published_at,
  g.valid_from, g.valid_to, g.fetched_at, g.freshness_state, g.record_status`;
export const PEDESTRIAN_COLUMNS = `p.source_id, p.batch_id, p.sensor_id, p.observed_at,
  p.direction_a_count, p.direction_b_count, p.total_count, p.record_granularity, p.fetched_at,
  p.source_last_success_at, p.location_source_id, p.location_valid_from, p.location_valid_to,
  p.geometry_geojson, p.location_status, p.source_freshness_state`;
export const ANOMALY_COLUMNS = `a.result_id, a.source_id, a.batch_id, a.sensor_id, a.sensor_name, a.lat, a.lon,
  a.window_from, a.window_to, a.observation_id, a.baseline_definition_id, a.baseline_value, a.observed_value,
  a.delta, a.direction, a.classification, a.is_replay, a.replay_label, a.location_evidence, a.published_at`;
/** The latest-snapshot sensor view (UC-15). It never exposes a rule or "may park" claim beyond `may_park_now`. */
export const PARKING_COLUMNS = `s.source_id, s.batch_id, s.sensor_id, s.source_record_id, s.version_id,
  s.occupied, s.reported_status, s.zone_number, s.status_changed_at, s.source_updated_at, s.fetched_at,
  s.source_freshness, s.occupancy_freshness, s.latitude, s.longitude, s.availability_note, s.may_park_now,
  s.original_url`;
export const BOUNDARY_COLUMNS = `b.boundary_id, b.version_id, b.scheme, b.code, b.name,
  b.vintage, b.geometry_geojson, b.valid_from, b.valid_to, b.source_record_id, b.source_id,
  b.batch_id, b.fetched_at`;

/** Rows travel as one JSON string each, so the runner can bound bytes before parsing. */
export const recordProjection = (columns: string): string => `SELECT TO_JSON_STRING(STRUCT(${columns})) AS record`;

export const GEO_ORDER = 'ORDER BY g.geo_record_id, g.version_id LIMIT @resultLimit';
export const PEDESTRIAN_ORDER = 'ORDER BY p.source_id, p.sensor_id, p.observed_at, p.batch_id LIMIT @resultLimit';
export const BOUNDARY_ORDER = 'ORDER BY b.boundary_id, b.version_id LIMIT @resultLimit';
export const PARKING_ORDER = 'ORDER BY s.sensor_id LIMIT @resultLimit';

/** One lookahead row tells the runner whether the page is partial. */
export const resultLimit = (pageSize: number): QueryBindings =>
  ({ params: { resultLimit: pageSize + 1 }, types: { resultLimit: 'INT64' } });
export const timeWindow = (window: TimeWindow): QueryBindings =>
  ({ params: { from: window.from, to: window.to }, types: { from: 'TIMESTAMP', to: 'TIMESTAMP' } });
export const bboxBindings = ([west, south, east, north]: Bbox): QueryBindings => ({
  params: { west, south, east, north },
  types: { west: 'FLOAT64', south: 'FLOAT64', east: 'FLOAT64', north: 'FLOAT64' },
});
export const spatialFilter = (column: string): string =>
  `${column} IS NOT NULL AND ST_INTERSECTSBOX(${column}, @west, @south, @east, @north)`;

/** A string list travels as one JSON parameter; callers sort it where identity matters. */
export const jsonArray = (name: string, values: readonly string[]): QueryBindings =>
  ({ params: { [name]: JSON.stringify(values) }, types: { [name]: 'STRING' } });
export const inJsonArray = (column: string, name: string): string =>
  `${column} IN UNNEST(JSON_VALUE_ARRAY(@${name}))`;

export const GEO_TOPICS = { planning: 'planning', disruption: 'transport', event: 'event', news: 'news' } as const;
export type GeoQueryId = keyof typeof GEO_TOPICS;
export const isGeoQuery = (queryId: ViewQueryId): queryId is GeoQueryId => Object.hasOwn(GEO_TOPICS, queryId);

/** Road disruptions are a second topic of the same layer. */
export function topicFilter(queryId: GeoQueryId): QueryBindings & { readonly sql: string } {
  if (queryId === 'disruption') {
    return { sql: 'g.topic IN (@topic, @roadTopic)',
      params: { topic: GEO_TOPICS.disruption, roadTopic: 'road_disruption' },
      types: { topic: 'STRING', roadTopic: 'STRING' } };
  }
  return { sql: 'g.topic = @topic', params: { topic: GEO_TOPICS[queryId] }, types: { topic: 'STRING' } };
}

export const recordStatusFilter = (mode: QueryMode): string =>
  mode === 'current' ? "g.record_status IN ('active', 'planned')" : "g.record_status != 'withdrawn'";

/** Current planning is a complete source snapshot, not an invented dated event. */
export const usesTimeWindow = (queryId: ViewQueryId, mode: QueryMode): boolean =>
  !(queryId === 'planning' && mode === 'current');

/**
 * Known-time rows must overlap the window. In current mode a row without a clock stays
 * visible, because an unknown time is not evidence that the record ended.
 */
export function geoTimeFilter(queryId: GeoQueryId, mode: QueryMode): string {
  if (queryId === 'news') {
    const start = 'COALESCE(g.published_at, g.observed_at)';
    const known = `${start} >= @from AND ${start} < @to`;
    return mode === 'current' ? `(${start} IS NULL OR (${known}))` : known;
  }
  const start = 'COALESCE(g.valid_from, g.observed_at, g.published_at)';
  const open = '(g.valid_to IS NULL OR g.valid_to > @from)';
  return mode === 'current' ? `(${start} IS NULL OR ${start} < @to) AND ${open}` : `${start} < @to AND ${open}`;
}

/** Minute and hour observations end one granularity step after they start. */
export const PEDESTRIAN_OBSERVATION_END = `CASE p.record_granularity
  WHEN 'sensor_minute' THEN TIMESTAMP_ADD(p.observed_at, INTERVAL 1 MINUTE)
  WHEN 'sensor_hour' THEN TIMESTAMP_ADD(p.observed_at, INTERVAL 1 HOUR) END`;

/** Snapshot-style views use the historical scan allowance in either mode. */
const STATIC_VIEW_QUERIES: ReadonlySet<ViewQueryId> = new Set(['boundary', 'rent', 'census']);

export function queryDefaults(config: MapConfig, mode: QueryMode, queryId: ViewQueryId):
Pick<PreparedViewQuery, 'location' | 'maximumBytesBilled' | 'jobTimeoutMs'> {
  const historical = mode === 'historical' || STATIC_VIEW_QUERIES.has(queryId);
  return { location: config.location,
    maximumBytesBilled: String(historical ? config.historicalScanBytes : config.dynamicScanBytes),
    jobTimeoutMs: config.queryTimeoutMs };
}

/** Public boundary levels map to the admitted scheme codes stored in the views. */
export const BOUNDARY_SCHEMES = {
  GCCSA: 'ASGS_GCCSA', LGA: 'ASGS_LGA', SA2: 'ASGS_SA2', STE: 'ASGS_STE',
  CLUE_BLOCK: 'com_clue_block', MUNICIPAL: 'com_municipal',
} as const satisfies Record<BoundaryLevel, string>;
