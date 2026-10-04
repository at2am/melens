import { z } from 'zod';
import type { MapConfig } from '../config.js';
import type { UnlocatedQuery } from '../contracts/map-contract.js';
import type { PreparedViewQuery } from './bigquery-adapter.js';
import type { ViewQueryId } from './view-queries.js';

const id = z.string().min(1).max(256).regex(/^\S+$/);
export const approvedUnlocatedScopeSchema = z.strictObject({
  sourceIds: z.array(id).min(1).max(1_000), areaRefs: z.array(id).max(1_000),
  sourceJurisdiction: z.string().min(1).max(4_096).nullable(),
}).refine((scope) => (scope.areaRefs.length > 0) !== (scope.sourceJurisdiction !== null));
export type ApprovedUnlocatedScope = Readonly<z.infer<typeof approvedUnlocatedScopeSchema>>;

/** Dedicated null-geometry reads; approved scope is supplied by the trusted service. */
export function prepareUnlocatedQuery(options: {
  readonly queryId: ViewQueryId; readonly request: UnlocatedQuery; readonly config: MapConfig;
  readonly pageSize: number; readonly approvedScope: ApprovedUnlocatedScope;
}): PreparedViewQuery {
  const { queryId, request, config, pageSize } = options;
  const scope = approvedUnlocatedScopeSchema.parse(options.approvedScope);
  if ('areaRefs' in request.scope) {
    if (scope.sourceJurisdiction !== null || JSON.stringify([...scope.areaRefs].sort()) !== JSON.stringify([...request.scope.areaRefs].sort())) throw new RangeError('Unapproved scope');
  } else if (scope.sourceJurisdiction !== request.scope.sourceJurisdiction || scope.areaRefs.length !== 0) throw new RangeError('Unapproved scope');
  const geo = queryId === 'planning' || queryId === 'disruption' || queryId === 'event';
  if (!geo && queryId !== 'pedestrian') throw new RangeError('Unlocated layer unavailable');
  if (queryId === 'pedestrian' && scope.areaRefs.length > 0) throw new RangeError('Observation view has no area association');
  const usesWindow = !(queryId === 'planning' && request.mode === 'current');
  const params = { sourceIdsJson: JSON.stringify([...scope.sourceIds].sort()), resultLimit: pageSize + 1,
    ...(scope.areaRefs.length > 0 ? { areaRefsJson: JSON.stringify([...scope.areaRefs].sort()) } : {}),
    ...(usesWindow ? { from: request.window.from, to: request.window.to } : {}) };
  const types = { sourceIdsJson: 'STRING', resultLimit: 'INT64',
    ...(scope.areaRefs.length > 0 ? { areaRefsJson: 'STRING' } satisfies PreparedViewQuery['types'] : {}),
    ...(usesWindow ? { from: 'TIMESTAMP', to: 'TIMESTAMP' } satisfies PreparedViewQuery['types'] : {}) } satisfies PreparedViewQuery['types'];
  const defaults = { location: config.location, maximumBytesBilled: String(request.mode === 'historical' ? config.historicalScanBytes : config.dynamicScanBytes), jobTimeoutMs: config.queryTimeoutMs };
  const path = (name: string) => `\`${config.projectId}.melens_query.${name}\``;
  if (queryId === 'pedestrian') return { ...defaults,
    query: `SELECT TO_JSON_STRING(STRUCT(p.source_id, p.batch_id, p.sensor_id, p.observed_at,
      p.direction_a_count, p.direction_b_count, p.total_count, p.record_granularity, p.fetched_at,
      p.source_last_success_at, p.location_source_id, p.location_valid_from, p.location_valid_to,
      p.geometry_geojson, p.location_status, p.source_freshness_state)) AS record
      FROM ${path('v_pedestrian_observations')} p WHERE (p.geometry IS NULL OR p.location_status != 'located'
      OR p.location_valid_from IS NULL OR p.location_valid_from > p.observed_at
      OR p.location_valid_to < CASE p.record_granularity WHEN 'sensor_minute' THEN TIMESTAMP_ADD(p.observed_at, INTERVAL 1 MINUTE)
        WHEN 'sensor_hour' THEN TIMESTAMP_ADD(p.observed_at, INTERVAL 1 HOUR) END)
      AND p.source_id IN UNNEST(JSON_VALUE_ARRAY(@sourceIdsJson))
      AND p.observed_at >= @from AND p.observed_at < @to
      ORDER BY p.source_id, p.sensor_id, p.observed_at, p.batch_id LIMIT @resultLimit`, params, types };
  const topic = { planning: 'planning', disruption: 'transport', event: 'event' }[queryId as 'planning' | 'disruption' | 'event'];
  const time = 'COALESCE(g.valid_from, g.observed_at, g.published_at)';
  const knownTemporal = `${time} < @to AND (g.valid_to IS NULL OR g.valid_to > @from)`;
  const temporal = usesWindow ? `AND ${request.mode === 'current' ? `(${time} IS NULL OR ${time} < @to) AND (g.valid_to IS NULL OR g.valid_to > @from)` : knownTemporal}` : '';
  return { ...defaults,
    query: `SELECT TO_JSON_STRING(STRUCT(g.geo_record_id, g.version_id, g.source_id, g.topic,
      g.assertion_kind, g.is_prediction, g.title, g.summary, g.original_url, g.geometry_geojson,
      g.location_role, g.location_confidence, g.area_refs, g.observed_at, g.published_at,
      g.valid_from, g.valid_to, g.fetched_at, g.freshness_state, g.record_status)) AS record
      FROM ${path(request.mode === 'current' ? 'v_geo_records_current' : 'v_geo_records_history')} g
      WHERE g.geometry IS NULL AND g.source_id IN UNNEST(JSON_VALUE_ARRAY(@sourceIdsJson))
      AND ${queryId === 'disruption' ? 'g.topic IN (@topic, @roadTopic)' : 'g.topic = @topic'}
      AND ${request.mode === 'current' ? "g.record_status IN ('active', 'planned')" : "g.record_status != 'withdrawn'"}
      ${scope.areaRefs.length > 0 ? 'AND EXISTS (SELECT 1 FROM UNNEST(g.area_refs) ref WHERE ref IN UNNEST(JSON_VALUE_ARRAY(@areaRefsJson)))' : ''}
      ${temporal} ORDER BY g.geo_record_id, g.version_id LIMIT @resultLimit`,
    params: { ...params, topic, ...(queryId === 'disruption' ? { roadTopic: 'road_disruption' } : {}) },
    types: { ...types, topic: 'STRING', ...(queryId === 'disruption' ? { roadTopic: 'STRING' } satisfies PreparedViewQuery['types'] : {}) } };
}
