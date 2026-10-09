import { z } from 'zod';
import type { MapConfig } from '../config.js';
import { identifierSchema as id, type ViewportQuery } from '../contracts/map-contract.js';
import type { PreparedViewQuery } from './bigquery-adapter.js';
import type { ViewQueryId } from './view-queries.js';

export const publicRecordKeysSchema = z.array(z.strictObject({
  id, versionId: id, sourceId: id, sensorId: id.optional(), observedAt: z.string().max(32).optional(),
})).min(1).max(1_000);
export type PublicRecordKeys = z.infer<typeof publicRecordKeysSchema>;

/** Read-only current rights proof for stored identities, never a replacement result page. */
export function preparePublicRecordQuery(options: {
  readonly queryId: ViewQueryId; readonly request: ViewportQuery; readonly config: MapConfig;
  readonly pageSize: number; readonly recordKeys: PublicRecordKeys;
}): PreparedViewQuery {
  const { queryId, request, config, pageSize } = options;
  const keys = publicRecordKeysSchema.parse(options.recordKeys);
  const path = (view: string) => `\`${config.projectId}.melens_query.${view}\``;
  const params = { publicRecordKeysJson: JSON.stringify(keys), resultLimit: pageSize + 1 };
  const types = { publicRecordKeysJson: 'STRING', resultLimit: 'INT64' } satisfies PreparedViewQuery['types'];
  const defaults = { location: config.location, maximumBytesBilled: String(request.mode === 'historical'
    || queryId === 'boundary' ? config.historicalScanBytes : config.dynamicScanBytes), jobTimeoutMs: config.queryTimeoutMs };
  const match = (idColumn: string, versionColumn: string, sourceColumn: string) => `EXISTS (
    SELECT 1 FROM UNNEST(JSON_QUERY_ARRAY(@publicRecordKeysJson)) k
    WHERE JSON_VALUE(k, '$.id') = ${idColumn} AND JSON_VALUE(k, '$.versionId') = ${versionColumn}
      AND JSON_VALUE(k, '$.sourceId') = ${sourceColumn})`;
  if (queryId === 'boundary') return { ...defaults, params, types,
    query: `SELECT TO_JSON_STRING(STRUCT(b.boundary_id, b.version_id, b.scheme, b.code, b.name,
      b.vintage, b.geometry_geojson, b.valid_from, b.valid_to, b.source_record_id, b.source_id,
      b.batch_id, b.fetched_at)) AS record FROM ${path('v_boundaries')} b
      WHERE ${match('b.boundary_id', 'b.version_id', 'b.source_id')}
      ORDER BY b.boundary_id, b.version_id LIMIT @resultLimit` };
  if (queryId === 'pedestrian') return { ...defaults, params, types,
    query: `SELECT TO_JSON_STRING(STRUCT(p.source_id, p.batch_id, p.sensor_id, p.observed_at,
      p.direction_a_count, p.direction_b_count, p.total_count, p.record_granularity, p.fetched_at,
      p.source_last_success_at, p.location_source_id, p.location_valid_from, p.location_valid_to,
      p.geometry_geojson, p.location_status, p.source_freshness_state)) AS record
      FROM ${path('v_pedestrian_observations')} p WHERE EXISTS (
        SELECT 1 FROM UNNEST(JSON_QUERY_ARRAY(@publicRecordKeysJson)) k
        WHERE JSON_VALUE(k, '$.sourceId') = p.source_id AND JSON_VALUE(k, '$.sensorId') = p.sensor_id
          AND p.observed_at = SAFE_CAST(JSON_VALUE(k, '$.observedAt') AS TIMESTAMP))
      ORDER BY p.source_id, p.sensor_id, p.observed_at, p.batch_id LIMIT @resultLimit` };
  if (!['planning', 'disruption', 'event'].includes(queryId)) throw new RangeError('Public record verifier unavailable');
  return { ...defaults, params, types,
    query: `SELECT TO_JSON_STRING(STRUCT(g.geo_record_id, g.version_id, g.source_id, g.topic,
      g.assertion_kind, g.is_prediction, g.title, g.summary, g.original_url, g.geometry_geojson,
      g.location_role, g.location_confidence, g.area_refs, g.observed_at, g.published_at,
      g.valid_from, g.valid_to, g.fetched_at, g.freshness_state, g.record_status)) AS record
      FROM ${path(request.mode === 'current' ? 'v_geo_records_current' : 'v_geo_records_history')} g
      WHERE ${match('g.geo_record_id', 'g.version_id', 'g.source_id')}
        AND ${request.mode === 'current' ? "g.record_status IN ('active', 'planned')" : "g.record_status != 'withdrawn'"}
      ORDER BY g.geo_record_id, g.version_id LIMIT @resultLimit` };
}
