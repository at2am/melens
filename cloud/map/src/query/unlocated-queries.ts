import { z } from 'zod';
import type { MapConfig } from '../config.js';
import { identifierSchema as id, type UnlocatedQuery } from '../contracts/map-contract.js';
import type { PreparedViewQuery } from './bigquery-adapter.js';
import {
  GEO_COLUMNS, GEO_ORDER, NO_BINDINGS, PEDESTRIAN_COLUMNS, PEDESTRIAN_OBSERVATION_END, PEDESTRIAN_ORDER,
  bind, geoTimeFilter, geoView, inJsonArray, isGeoQuery, jsonArray, queryDefaults, recordProjection,
  recordStatusFilter, resultLimit, timeWindow, topicFilter, usesTimeWindow, viewPath,
} from './sql.js';
import type { ViewQueryId } from './view-queries.js';

export const approvedUnlocatedScopeSchema = z.strictObject({
  sourceIds: z.array(id).min(1).max(1_000), areaRefs: z.array(id).max(1_000),
  sourceJurisdiction: z.string().min(1).max(4_096).nullable(),
}).refine((scope) => (scope.areaRefs.length > 0) !== (scope.sourceJurisdiction !== null));
export type ApprovedUnlocatedScope = Readonly<z.infer<typeof approvedUnlocatedScopeSchema>>;

const sortedJson = (values: readonly string[]) => JSON.stringify([...values].sort());

/** Dedicated null-geometry reads; approved scope is supplied by the trusted service. */
export function prepareUnlocatedQuery(options: {
  readonly queryId: ViewQueryId; readonly request: UnlocatedQuery; readonly config: MapConfig;
  readonly pageSize: number; readonly approvedScope: ApprovedUnlocatedScope;
}): PreparedViewQuery {
  const { queryId, request, config, pageSize } = options;
  const scope = approvedUnlocatedScopeSchema.parse(options.approvedScope);
  if ('areaRefs' in request.scope) {
    if (scope.sourceJurisdiction !== null || sortedJson(scope.areaRefs) !== sortedJson(request.scope.areaRefs)) {
      throw new RangeError('Unapproved scope');
    }
  } else if (scope.sourceJurisdiction !== request.scope.sourceJurisdiction || scope.areaRefs.length !== 0) {
    throw new RangeError('Unapproved scope');
  }
  const geo = isGeoQuery(queryId) && queryId !== 'news';
  if (!geo && queryId !== 'pedestrian') throw new RangeError('Unlocated layer unavailable');
  if (queryId === 'pedestrian' && scope.areaRefs.length > 0) throw new RangeError('Observation view has no area association');

  const mode = request.mode;
  const windowed = usesTimeWindow(queryId, mode);
  const defaults = queryDefaults(config, mode, queryId);
  const base = bind(resultLimit(pageSize), jsonArray('sourceIdsJson', [...scope.sourceIds].sort()),
    scope.areaRefs.length > 0 ? jsonArray('areaRefsJson', [...scope.areaRefs].sort()) : NO_BINDINGS,
    windowed ? timeWindow(request.window) : NO_BINDINGS);

  if (queryId === 'pedestrian') {
    // The viewport query keeps only coordinates effective for the whole count; this is its complement.
    return { ...defaults, ...base,
      query: `${recordProjection(PEDESTRIAN_COLUMNS)}
      FROM ${viewPath(config, 'v_pedestrian_observations')} p WHERE (p.geometry IS NULL OR p.location_status != 'located'
      OR p.location_valid_from IS NULL OR p.location_valid_from > p.observed_at
      OR p.location_valid_to < ${PEDESTRIAN_OBSERVATION_END})
      AND ${inJsonArray('p.source_id', 'sourceIdsJson')}
      AND p.observed_at >= @from AND p.observed_at < @to
      ${PEDESTRIAN_ORDER}` };
  }
  const topic = topicFilter(queryId);
  return { ...defaults, ...bind(base, topic),
    query: `${recordProjection(GEO_COLUMNS)}
      FROM ${viewPath(config, geoView(mode))} g
      WHERE g.geometry IS NULL AND ${inJsonArray('g.source_id', 'sourceIdsJson')}
      AND ${topic.sql}
      AND ${recordStatusFilter(mode)}
      ${scope.areaRefs.length > 0 ? `AND EXISTS (SELECT 1 FROM UNNEST(g.area_refs) ref WHERE ${inJsonArray('ref', 'areaRefsJson')})` : ''}
      ${windowed ? `AND ${geoTimeFilter(queryId, mode)}` : ''} ${GEO_ORDER}` };
}
