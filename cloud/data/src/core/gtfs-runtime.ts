import type { BigQuery } from '@google-cloud/bigquery';
import { z } from 'zod';

import { gtfsRouteTypeToMode, SOURCE_ID as STATIC_SOURCE_ID,
  type GtfsStaticSnapshot, type NormalizedGtfsResult } from '../connectors/tv_gtfs_static/index.js';
import { SOURCE_ID as REALTIME_SOURCE_ID } from '../connectors/tv_gtfs_realtime/index.js';
import { joinGtfsAlertLocations, type RouteShapeReference, type StaticGtfsVersion } from '../normalization/gtfs-alerts.js';
import { sourceRecordSchema, sourceVersionId } from '../validation/record.js';
import type { ConnectorSuccess } from './connector.js';
import type { DataConfig } from './config.js';
import type { GeoRecord } from './types.js';

const mode = z.enum(['metro_train', 'yarra_tram']);
const utc = z.iso.datetime({ offset: false });
const route = z.object({ route_id: z.string().min(1), route_type: z.number().int(),
  route_short_name: z.string().nullable(), route_long_name: z.string().nullable() }).strict();
const stop = z.object({ stop_id: z.string().min(1), stop_name: z.string().min(1),
  stop_lat: z.number().min(-90).max(90), stop_lon: z.number().min(-180).max(180),
  location_type: z.number().int().nullable(), parent_station: z.string().nullable() }).strict();
const feedInfo = z.object({ feed_version: z.string().min(1),
  feed_start_date: z.string().regex(/^\d{8}$/).nullable(),
  feed_end_date: z.string().regex(/^\d{8}$/).nullable() }).strict();
const referenceBase = z.object({ kind: z.literal('gtfs_static_stop_reference'),
  schema_version: z.literal(1), feed_version: z.string().min(1), stop,
  routes: z.array(route).max(10_000) });
const referenceSchema = z.union([
  referenceBase.extend({ publisher_mode: z.null(), publisher_feed_info: z.null() }).strict(),
  referenceBase.extend({ publisher_mode: mode, publisher_feed_info: feedInfo }).strict(),
]);
const publishedReferenceSchema = z.object({ kind: z.literal('stop'), source: sourceRecordSchema,
  summary: z.string().nullable(), geometry_geojson: z.string().nullable(),
  centroid_lat: z.number().nullable(), centroid_lon: z.number().nullable(),
  route_records: z.array(sourceRecordSchema).max(10_000) }).strict();
const routeShapeSummarySchema = z.object({ kind: z.literal('gtfs_static_route_shape'), schema_version: z.literal(1),
  feed_version: z.string().min(1), route }).strict();
const publishedRouteShapeSchema = z.object({ kind: z.literal('route_shape'), source: sourceRecordSchema,
  summary: z.string(), geometry_geojson: z.string() }).strict();
const maximumReferences = 50_000;
const pointSchema = z.object({ type: z.literal('Point'), coordinates: z.tuple([z.number(), z.number()]) });
const multiLineSchema = z.object({ type: z.literal('MultiLineString'),
  coordinates: z.array(z.array(z.tuple([z.number(), z.number()])).min(2)).min(1) }).strict();

function referenceFromSummary(summary: string | null) {
  if (summary === null || !summary.trim().startsWith('{')) return null;
  const parsed = referenceSchema.safeParse(JSON.parse(summary));
  return parsed.success ? parsed.data : null;
}

/**
 * The latest published static schedule, with its original published source-record versions.
 * Transport Victoria's archive carries no feed_info, so an alert cannot name the schedule it was
 * written against; the newest published schedule is the one in service, and only it is loaded.
 */
export async function loadPublishedStaticGtfsVersions(config: DataConfig,
  bigquery: Pick<BigQuery, 'query'>): Promise<StaticGtfsVersion[]> {
  if (!config.maxBytesBilled) throw new Error('GTFS reference loading requires a billed-byte ceiling');
  const path = (table: string) => `\`${config.projectId}.${config.ingestDataset}.${table}\``;
  let rows: unknown;
  try {
    const [queried] = await bigquery.query({
      query: `/* published-gtfs-static-references */
      -- Only the newest batch is read, so its fact rows sit in the partitions from just before it
      -- started. A scripting variable is a constant, so BigQuery prunes the older partitions on it.
      DECLARE fetched_floor TIMESTAMP DEFAULT (
        SELECT TIMESTAMP_SUB(started_at, INTERVAL 1 DAY) FROM (
          SELECT batch_id, state, started_at, published_at FROM ${path('sync_batches')}
          WHERE source_id = @sourceId
          QUALIFY ROW_NUMBER() OVER (PARTITION BY batch_id ORDER BY state_updated_at DESC) = 1
        ) WHERE state = 'published' AND published_at IS NOT NULL
        ORDER BY published_at DESC, batch_id DESC LIMIT 1);
      WITH source_states AS (
        SELECT source_id, license_status, access_status FROM ${path('data_sources')}
        WHERE source_id = @sourceId
        QUALIFY ROW_NUMBER() OVER (PARTITION BY source_id ORDER BY updated_at DESC) = 1
      ), batch_states AS (
        SELECT batch_id, source_id, source_revision, state, published_at FROM ${path('sync_batches')}
        WHERE source_id = @sourceId
        QUALIFY ROW_NUMBER() OVER (PARTITION BY batch_id ORDER BY state_updated_at DESC) = 1
      ), published_batches AS (
        SELECT b.* FROM batch_states b JOIN source_states s USING (source_id)
        WHERE b.state = 'published' AND b.published_at IS NOT NULL
          AND s.access_status = 'active' AND s.license_status IN ('verified_open', 'restricted')
        QUALIFY ROW_NUMBER() OVER (ORDER BY b.published_at DESC, b.batch_id DESC) = 1
      ), published_stops AS (
        SELECT g.*, r AS source_record, b.published_at AS batch_published_at
        FROM ${path('geo_records')} g JOIN published_batches b USING (batch_id, source_id)
        JOIN ${path('source_records')} r ON r.batch_id = g.batch_id AND r.source_id = g.source_id
          AND r.source_record_id = g.geo_record_id AND r.version_id = g.version_id
        WHERE g.source_id = @sourceId AND STARTS_WITH(g.geo_record_id, CONCAT(@sourceId, ':stop:'))
          AND g.fetched_at >= fetched_floor AND r.fetched_at >= fetched_floor
          AND g.public_query_allowed AND g.rights_status IN ('verified_open', 'restricted')
          AND r.rights_status IN ('verified_open', 'restricted')
        QUALIFY ROW_NUMBER() OVER (PARTITION BY g.batch_id, g.geo_record_id, g.version_id
          ORDER BY b.published_at DESC, g.fetched_at DESC) = 1
      ), route_evidence AS (
        SELECT l.batch_id, l.geo_record_id, l.version_id, r AS source_record
        FROM ${path('geo_record_sources')} l
        JOIN published_batches b ON b.batch_id = l.batch_id AND b.source_id = l.source_id
        JOIN ${path('source_records')} r ON r.batch_id = l.batch_id AND r.source_id = @sourceId
          AND r.source_record_id = l.source_record_id AND r.version_id = l.source_version_id
        WHERE l.source_id = @sourceId AND l.evidence_role = 'serving_route'
          AND l.fetched_at >= fetched_floor AND r.fetched_at >= fetched_floor
          AND r.rights_status IN ('verified_open', 'restricted')
        QUALIFY ROW_NUMBER() OVER (PARTITION BY l.batch_id, l.geo_record_id, l.version_id,
          r.source_record_id, r.version_id ORDER BY r.fetched_at DESC) = 1
      ), related_routes AS (
        SELECT batch_id, geo_record_id, version_id, ARRAY_AGG(source_record) AS records
        FROM route_evidence GROUP BY batch_id, geo_record_id, version_id
      ), published_route_shapes AS (
        SELECT g.*, r AS source_record
        FROM ${path('geo_records')} g JOIN published_batches b USING (batch_id, source_id)
        JOIN ${path('source_records')} r ON r.batch_id = g.batch_id AND r.source_id = g.source_id
          AND r.source_record_id = g.geo_record_id AND r.version_id = g.version_id
        WHERE g.source_id = @sourceId AND STARTS_WITH(g.geo_record_id, CONCAT(@sourceId, ':route:'))
          AND g.fetched_at >= fetched_floor AND r.fetched_at >= fetched_floor
          AND g.geometry_geojson IS NOT NULL
          AND g.public_query_allowed AND g.rights_status IN ('verified_open', 'restricted')
          AND r.rights_status IN ('verified_open', 'restricted')
        QUALIFY ROW_NUMBER() OVER (PARTITION BY g.batch_id, g.geo_record_id, g.version_id
          ORDER BY g.fetched_at DESC) = 1
      )
      SELECT reference FROM (
        SELECT g.geo_record_id, g.version_id, TO_JSON_STRING(STRUCT('stop' AS kind, g.source_record AS source,
          g.summary, g.geometry_geojson, g.centroid_lat, g.centroid_lon,
          IFNULL(routes.records, []) AS route_records)) AS reference
        FROM published_stops g LEFT JOIN related_routes routes USING (batch_id, geo_record_id, version_id)
        UNION ALL
        SELECT g.geo_record_id, g.version_id, TO_JSON_STRING(STRUCT('route_shape' AS kind,
          g.source_record AS source, g.summary, g.geometry_geojson)) AS reference
        FROM published_route_shapes g
      ) ORDER BY geo_record_id, version_id LIMIT ${maximumReferences + 1}`,
      params: { sourceId: STATIC_SOURCE_ID }, location: config.region,
      maximumBytesBilled: config.maxBytesBilled,
    });
    rows = queried;
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : 'GTFS reference query failed');
  }
  const parsedRows = z.array(z.object({ reference: z.string() })).max(maximumReferences).parse(rows)
    .map(row => z.discriminatedUnion('kind', [publishedReferenceSchema, publishedRouteShapeSchema])
      .parse(JSON.parse(row.reference)));
  const loaded = parsedRows.flatMap(row => row.kind === 'stop' ? [row] : []);
  const shapesByBatch = new Map<string, Map<string, RouteShapeReference>>();
  for (const stored of parsedRows) {
    if (stored.kind !== 'route_shape') continue;
    const summary = routeShapeSummarySchema.parse(JSON.parse(stored.summary));
    if (stored.source.source_id !== STATIC_SOURCE_ID
      || stored.source.source_record_id !== `${STATIC_SOURCE_ID}:route:${summary.route.route_id}`) {
      throw new Error('Published GTFS route shape has inconsistent provenance');
    }
    multiLineSchema.parse(JSON.parse(stored.geometry_geojson));
    let shapes = shapesByBatch.get(stored.source.batch_id);
    if (!shapes) { shapes = new Map(); shapesByBatch.set(stored.source.batch_id, shapes); }
    if (shapes.has(summary.route.route_id)) throw new Error('Published GTFS route has conflicting shapes');
    shapes.set(summary.route.route_id, { geometryGeojson: stored.geometry_geojson, record: stored.source,
      feedVersion: summary.feed_version });
  }
  const grouped = new Map<string, { publisherMode: z.infer<typeof mode> | null;
    feedVersion: string; feedInfo: z.infer<typeof feedInfo> | null; batchId: string;
    rows: { stored: z.infer<typeof publishedReferenceSchema>; reference: z.infer<typeof referenceSchema> }[] }>();
  for (const stored of loaded) {
    const reference = referenceFromSummary(stored.summary);
    // A claimed publisher version must agree with its own feed_info; an archive version claims none.
    if (reference === null || (reference.publisher_feed_info !== null
      && reference.publisher_feed_info.feed_version !== reference.feed_version)) continue;
    if (stored.source.source_id !== STATIC_SOURCE_ID
      || stored.source.source_record_id !== `${STATIC_SOURCE_ID}:stop:${reference.stop.stop_id}`) {
      throw new Error('Published GTFS stop reference has inconsistent provenance');
    }
    const expectedRoutes = new Set(reference.routes.map(item => `${STATIC_SOURCE_ID}:route:${item.route_id}`));
    const actualRoutes = new Set(stored.route_records.map(item => item.source_record_id));
    if (expectedRoutes.size !== reference.routes.length || actualRoutes.size !== stored.route_records.length
      || expectedRoutes.size !== actualRoutes.size || [...expectedRoutes].some(id => !actualRoutes.has(id))
      || stored.route_records.some(record => record.source_id !== STATIC_SOURCE_ID
        || record.batch_id !== stored.source.batch_id)) {
      throw new Error('Published GTFS route references are incomplete');
    }
    const geometry = stored.geometry_geojson === null ? null : pointSchema.parse(JSON.parse(stored.geometry_geojson));
    if (stored.geometry_geojson === null
      || geometry?.coordinates[0] !== reference.stop.stop_lon || geometry.coordinates[1] !== reference.stop.stop_lat
      || stored.centroid_lat !== reference.stop.stop_lat || stored.centroid_lon !== reference.stop.stop_lon) {
      throw new Error('Published GTFS stop geometry disagrees with the retained reference');
    }
    const key = `${stored.source.batch_id}\u0000${reference.publisher_mode}\u0000${reference.feed_version}`;
    const existing = grouped.get(key);
    if (existing) {
      if (JSON.stringify(existing.feedInfo) !== JSON.stringify(reference.publisher_feed_info)) {
        throw new Error('Published GTFS mode has conflicting publisher metadata');
      }
      existing.rows.push({ stored, reference });
    } else grouped.set(key, { publisherMode: reference.publisher_mode, feedVersion: reference.feed_version,
      feedInfo: reference.publisher_feed_info, batchId: stored.source.batch_id, rows: [{ stored, reference }] });
  }
  const versions: StaticGtfsVersion[] = [];
  for (const group of grouped.values()) {
    const routeEvidence = new Map<string, string>();
    for (const row of group.rows) for (const item of row.reference.routes) {
      const record = row.stored.route_records.find(record =>
        record.source_record_id === `${STATIC_SOURCE_ID}:route:${item.route_id}`);
      if (!record) throw new Error('Published GTFS route has no versioned source fact');
      const identity = `${record.version_id}\u0000${JSON.stringify(item)}`;
      const previous = routeEvidence.get(item.route_id);
      if (previous !== undefined && previous !== identity) {
        throw new Error('Published GTFS route has conflicting versioned evidence');
      }
      routeEvidence.set(item.route_id, identity);
    }
    const routes = [...new Map(group.rows.flatMap(row => row.reference.routes)
      .map(item => [item.route_id, item])).values()];
    const stops = group.rows.map(row => ({ ...row.reference.stop,
      route_ids: row.reference.routes.map(item => item.route_id).sort(),
      modes: [...new Set(row.reference.routes.map(item => gtfsRouteTypeToMode(item.route_type)))].sort() }));
    const snapshot: GtfsStaticSnapshot = { feed_info: group.feedInfo === null ? [] : [group.feedInfo],
      routes, stops, trips: [], stop_times: [], route_shapes: [] };
    const sourceRecords = [...new Map(group.rows.flatMap(row => [row.stored.source, ...row.stored.route_records])
      .map(item => [`${item.source_record_id}\u0000${item.version_id}`, item])).values()];
    const geoRecords: GeoRecord[] = group.rows.map(({ stored, reference }) => ({
      batch_id: stored.source.batch_id, source_id: STATIC_SOURCE_ID, schema_version: stored.source.schema_version,
      fetched_at: stored.source.fetched_at, geo_record_id: stored.source.source_record_id,
      version_id: stored.source.version_id, topic: 'transport', assertion_kind: 'report',
      title: reference.stop.stop_name, summary: stored.summary, original_url: stored.source.original_url,
      geometry_geojson: stored.geometry_geojson, centroid_lat: stored.centroid_lat, centroid_lon: stored.centroid_lon,
      location_role: 'sensor_site', location_confidence: 'source_coordinate', area_refs: [],
      published_at: stored.source.published_at, observed_at: stored.source.observed_at,
      valid_from: stored.source.valid_from, valid_to: stored.source.valid_to,
      source_updated_at: stored.source.source_updated_at, source_version_ordinal: stored.source.source_version_ordinal,
      freshness_state: 'unknown', record_status: 'active', rights_status: stored.source.rights_status,
      public_query_allowed: true,
    }));
    const first = group.rows[0];
    if (!first) continue;
    const normalized: NormalizedGtfsResult = { sourceRecords, geoRecords, geoRecordSources: [],
      feedVersion: group.feedVersion, validFrom: first.stored.source.valid_from,
      validTo: first.stored.source.valid_to, routes, stops,
      sourceUpdatedAt: first.stored.source.source_updated_at, tripStopMembershipComplete: false };
    const routeShapes = new Map([...(shapesByBatch.get(group.batchId) ?? new Map<string, RouteShapeReference>())]
      .filter(([, shape]) => shape.feedVersion === group.feedVersion));
    versions.push({ snapshot, normalized, routeShapes,
      ...(group.publisherMode === null ? {} : { publisherMode: group.publisherMode }),
      // Only the newest published schedule is loaded, so an archive version stands for the one in service.
      ...(group.feedVersion.startsWith('archive-sha256:') ? { matchRule: 'latest_published_archive' as const } : {}) });
  }
  return versions;
}

/** Run after collection and before publication; failed collection never reaches this step. */
export async function withPublishedGtfsLocations(result: ConnectorSuccess, config: DataConfig,
  bigquery: Pick<BigQuery, 'query'>): Promise<ConnectorSuccess> {
  if (result.sourceId !== REALTIME_SOURCE_ID) return result;
  if (result.completeness.method !== 'feed_snapshot' || !result.completeness.complete
    || result.completeness.expected_pages !== 2 || result.completeness.fetched_pages !== 2) {
    throw new Error('GTFS runtime requires both complete mode snapshots');
  }
  const parents = result.sourceRecords.flatMap(record => {
    const match = /^victoria\.transport\.gtfs_realtime:feed:(metro_train|yarra_tram):(.+)$/.exec(record.source_record_id);
    if (!match) return [];
    const timestamp = utc.parse(record.source_updated_at);
    if (Date.parse(utc.parse(match[2])) !== Date.parse(timestamp)) {
      throw new Error('GTFS snapshot parent timestamp disagrees with its identity');
    }
    return [{ mode: mode.parse(match[1]), timestamp, record }];
  });
  if (parents.length !== 2 || new Set(parents.map(parent => parent.mode)).size !== 2) {
    throw new Error('GTFS runtime requires one timestamped parent for each mode');
  }
  const memberships = new Map<string, Array<(typeof result.geoRecordSources)[number]>>();
  for (const link of result.geoRecordSources) {
    if (link.evidence_role !== 'parent_feed_snapshot') continue;
    const key = JSON.stringify([link.geo_record_id, link.version_id]);
    const existing = memberships.get(key);
    if (existing) existing.push(link);
    else memberships.set(key, [link]);
  }
  for (const alert of result.geoRecords) {
    const alertMode = /^victoria\.transport\.gtfs_realtime:alert:(metro_train|yarra_tram):/.exec(alert.geo_record_id)?.[1];
    const parent = parents.find(item => item.mode === alertMode);
    const membership = memberships.get(JSON.stringify([alert.geo_record_id, alert.version_id])) ?? [];
    const link = membership[0];
    if (!parent || membership.length !== 1 || !link
      || alert.source_id !== REALTIME_SOURCE_ID || alert.batch_id !== result.runId
      || alert.source_updated_at !== parent.timestamp
      || parent.record.source_id !== REALTIME_SOURCE_ID || parent.record.batch_id !== result.runId
      || link.source_id !== REALTIME_SOURCE_ID || link.batch_id !== result.runId
      || link.source_record_id !== parent.record.source_record_id
      || link.source_version_id !== parent.record.version_id) {
      throw new Error('GTFS alert snapshot membership does not match its mode parent');
    }
  }
  const staticVersions = result.geoRecords.length === 0 ? []
    : await loadPublishedStaticGtfsVersions(config, bigquery);
  const joined = joinGtfsAlertLocations({ alerts: result.geoRecords,
    alertSources: result.geoRecordSources, staticVersions });
  const mappingById = new Map(joined.mappings.map(item => [item.geoRecordId, item]));
  const geoRecords = joined.geoRecords.map(row => {
    const mapping = mappingById.get(row.geo_record_id);
    if (!mapping) throw new Error('GTFS runtime did not classify an alert');
    const originalSummary: unknown = row.summary === null ? null : JSON.parse(row.summary);
    const summary = JSON.stringify({ ...z.record(z.string(), z.unknown()).parse(originalSummary),
      gtfs_mapping_status: mapping.status, static_feed_version: mapping.staticFeedVersion,
      static_evidence: mapping.staticEvidence });
    return { ...row, summary, version_id: sourceVersionId(row.source_updated_at,
      { joinedVersionId: row.version_id, summary }) };
  });
  const finalVersions = new Map(geoRecords.map(row => [row.geo_record_id, row.version_id]));
  return { ...result, geoRecords,
    sourceRevision: sourceVersionId(result.sourceLatestUpdateAt, {
      providerSourceRevision: result.sourceRevision,
      derivedGeoVersions: geoRecords.map(row => ({ id: row.geo_record_id, version: row.version_id }))
        .sort((a, b) => a.id.localeCompare(b.id)),
    }),
    geoRecordSources: joined.geoRecordSources.map(link => ({ ...link,
      version_id: finalVersions.get(link.geo_record_id) ?? link.version_id })) };
}
