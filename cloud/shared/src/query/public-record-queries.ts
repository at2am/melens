import { z } from 'zod';
import type { MapConfig } from '../config.js';
import { identifierSchema as id, type ViewportQuery } from '../contracts/map-contract.js';
import type { PreparedViewQuery } from './bigquery-adapter.js';
import {
  BOUNDARY_COLUMNS, BOUNDARY_ORDER, GEO_COLUMNS, GEO_ORDER, PARKING_COLUMNS, PARKING_ORDER, PEDESTRIAN_COLUMNS,
  PEDESTRIAN_ORDER,
  bind, geoRightsView, isGeoQuery, queryDefaults, recordProjection, recordStatusFilter, resultLimit, viewPath,
} from './sql.js';
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
  const defaults = queryDefaults(config, request.mode, queryId);
  const bindings = bind(resultLimit(pageSize),
    { params: { publicRecordKeysJson: JSON.stringify(keys) }, types: { publicRecordKeysJson: 'STRING' } });
  const joinRecordKeys = (idColumn: string, versionColumn: string, sourceColumn: string) => `JOIN (
    SELECT DISTINCT JSON_VALUE(k, '$.id') AS id, JSON_VALUE(k, '$.versionId') AS version_id,
      JSON_VALUE(k, '$.sourceId') AS source_id
    FROM UNNEST(JSON_QUERY_ARRAY(@publicRecordKeysJson)) k) requested
    ON requested.id = ${idColumn} AND requested.version_id = ${versionColumn}
      AND requested.source_id = ${sourceColumn}`;

  if (queryId === 'boundary') {
    return { ...defaults, ...bindings,
      query: `${recordProjection(BOUNDARY_COLUMNS)} FROM ${viewPath(config, 'v_boundaries')} b
      ${joinRecordKeys('b.boundary_id', 'b.version_id', 'b.source_id')}
      ${BOUNDARY_ORDER}` };
  }
  if (queryId === 'pedestrian') {
    // Sensor/start select the observation; adaptation also binds its native record and location revisions.
    return { ...defaults, ...bindings,
      query: `${recordProjection(PEDESTRIAN_COLUMNS)}
      FROM ${viewPath(config, 'v_pedestrian_observations')} p
      JOIN (SELECT DISTINCT JSON_VALUE(k, '$.sourceId') AS source_id,
          JSON_VALUE(k, '$.sensorId') AS sensor_id,
          SAFE_CAST(JSON_VALUE(k, '$.observedAt') AS TIMESTAMP) AS observed_at
        FROM UNNEST(JSON_QUERY_ARRAY(@publicRecordKeysJson)) k) requested
        ON requested.source_id = p.source_id AND requested.sensor_id = p.sensor_id
          AND requested.observed_at = p.observed_at
      ${PEDESTRIAN_ORDER}` };
  }
  if (queryId === 'parking') {
    // The latest snapshot holds one row per sensor; the source and sensor identify it. The caller then
    // compares the published version (batch and record version), not the read-time freshness.
    return { ...defaults, ...bindings,
      query: `${recordProjection(PARKING_COLUMNS)}
      FROM ${viewPath(config, 'v_parking_sensor_current')} s WHERE EXISTS (
        SELECT 1 FROM UNNEST(JSON_QUERY_ARRAY(@publicRecordKeysJson)) k
        WHERE JSON_VALUE(k, '$.sourceId') = s.source_id AND JSON_VALUE(k, '$.sensorId') = s.sensor_id)
      ${PARKING_ORDER}` };
  }
  if (!isGeoQuery(queryId)) throw new RangeError('Public record verifier unavailable');
  return { ...defaults, ...bindings,
    query: `${recordProjection(GEO_COLUMNS)}
      FROM ${viewPath(config, geoRightsView(request.mode))} g
      ${joinRecordKeys('g.geo_record_id', 'g.version_id', 'g.source_id')}
      WHERE ${recordStatusFilter(request.mode)}
      ${GEO_ORDER}` };
}
