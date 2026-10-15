import { readFileSync } from 'node:fs';

import type { BigQuery } from '@google-cloud/bigquery';

import type { DataConfig } from './config.js';

/**
 * The current geo records of the sources the map's geo layers draw, kept as a small table.
 *
 * v_geo_records_current rebuilds "current" from the whole append-only history on every read:
 * about 500 MB and 4 s per map request on 2026-10-15, most of it other sources' rows (rents alone
 * are 84% of geo_records). This table holds the same rows and is refreshed after publication:
 * - a snapshot source rebuilds its own rows from the view's own SQL (a few to a few hundred MB);
 * - an append source that publishes every few minutes (GDELT) applies only its newly published
 *   batches, reading their recent partitions;
 * - the source-retention job rebuilds every source from the view's SQL, so drift between the
 *   incremental path and the view lasts at most one retention cycle.
 * geo_records_current_state records which published batch each source's rows reflect, so a reader
 * can tell a copy that lags a publication from a current one.
 */
export const GEO_CURRENT_TABLE = 'geo_records_current';
export const GEO_CURRENT_STATE_TABLE = 'geo_records_current_state';

/**
 * Sources with rows in the map's geo layers (planning, disruption, event, news): every connector
 * of those topics except GTFS static and the activity counts, which the map does not draw. A test
 * reads the connectors' source.json files so a new map source cannot be left out.
 */
export const GEO_CURRENT_SOURCES: ReadonlySet<string> = new Set([
  'melbourne.development_monitor', 'victoria.council.engagement', 'victoria.vicmap.planning',
  'victoria.council.engagement_news', 'gdelt.news', 'ticketmaster.events', 'user.events',
  'victoria.transport.gtfs_realtime', 'victoria.transport.road_unplanned', 'victoria.transport.road_planned',
]);

/**
 * Append-only sources whose current record is simply the newest public version: no snapshot
 * membership decides it. GDELT publishes every 15 minutes and user events every 5, so a rebuild
 * per publication would scan the whole history each time. (GTFS and road impacts are
 * snapshot-membership sources: enabling them at one-minute cadence needs an incremental path of
 * their own.)
 */
export const INCREMENTAL_GEO_SOURCES: ReadonlySet<string> = new Set(['gdelt.news', 'user.events']);

const COLUMNS = ['geo_record_id', 'version_id', 'batch_id', 'source_id', 'schema_version', 'topic',
  'assertion_kind', 'is_prediction', 'title', 'summary', 'original_url', 'geometry_geojson', 'geometry',
  'centroid_lat', 'centroid_lon', 'location_role', 'location_confidence', 'area_refs', 'observed_at',
  'published_at', 'valid_from', 'valid_to', 'fetched_at', 'batch_published_at', 'source_updated_at',
  'source_version_ordinal', 'freshness_state', 'record_status', 'rights_status'] as const;

/** Per-source fact tables: every view read of them is about one source's rows (ids are source-prefixed). */
const SOURCE_SCOPED_TABLES = ['geo_records', 'source_records', 'geo_record_sources', 'parking_sensor_memberships'];
const HISTORY_MARKER = 'CREATE OR REPLACE VIEW `melens_query.v_geo_records_history` AS';
const CURRENT_MARKER = 'CREATE OR REPLACE VIEW `melens_query.v_geo_records_current` AS';
const PUBLIC_RIGHTS = "('verified_open', 'restricted')";
const ENDED = "('cancelled', 'resolved', 'withdrawn')";
export const NO_STATE_MESSAGE = 'geo_records_current has no refreshed state for this source';
/**
 * Ceiling for a rebuild. Small daily partitions hold every source's rows in the same blocks, so a
 * rebuild reads most of geo_records, source_records and geo_record_sources whatever its sources:
 * 490 MB on 2026-10-15, against the 500 MB per-query source ceiling. Rebuilds run a few times a day
 * (snapshot publications and the retention cycle); the frequent GDELT path reads about 60 MB.
 */
export const GEO_CURRENT_REBUILD_MAX_BYTES = '1500000000';

function viewBody(sql: string, marker: string): string {
  const start = sql.indexOf(marker);
  if (start < 0) throw new Error(`Missing view definition: ${marker}`);
  const rest = sql.slice(start + marker.length);
  const next = rest.indexOf('CREATE OR REPLACE VIEW');
  // The next view's leading comment lines follow this view's closing semicolon.
  const lines = (next < 0 ? rest : rest.slice(0, next)).split('\n');
  while (lines.length > 0 && /^\s*(--.*)?$/.test(lines.at(-1)!)) lines.pop();
  const body = lines.join('\n').trim();
  if (!body.endsWith(';')) throw new Error(`Unterminated view definition: ${marker}`);
  return body.slice(0, -1);
}

/**
 * The SELECT of v_geo_records_current, taken from the reviewed view SQL so the two cannot drift,
 * with the history view inlined and each source-scoped fact table narrowed to @sourceIds. The
 * narrowing lets BigQuery skip other sources' blocks; it does not change the selected sources'
 * rows, because every read of those tables in the views is about the outer row's own source.
 */
export function currentGeoRecordsSelect(viewSql: string, config: Pick<DataConfig, 'projectId' | 'ingestDataset'>): string {
  const history = viewBody(viewSql, HISTORY_MARKER);
  let current = viewBody(viewSql, CURRENT_MARKER);
  if (!current.includes('`melens_query.v_geo_records_history`')) throw new Error('The current view no longer reads the history view');
  current = current.replaceAll('`melens_query.v_geo_records_history`', `(${history})`);
  for (const table of SOURCE_SCOPED_TABLES) {
    current = current.replaceAll(`\`melens_ingest.${table}\``,
      `(SELECT * FROM \`${config.projectId}.${config.ingestDataset}.${table}\` WHERE source_id IN UNNEST(@sourceIds))`);
  }
  current = current.replaceAll('`melens_ingest.', `\`${config.projectId}.${config.ingestDataset}.`);
  if (/`melens_(query|ingest)\./.test(current)) throw new Error('Unqualified dataset reference left in the current view SQL');
  return current;
}

let cachedViewSql: string | null = null;
/** dist/src/core → ../../../sql in the repository and in the image (/app/dist/src/core → /app/sql). */
export function readCoreViewSql(): string {
  cachedViewSql ??= readFileSync(new URL('../../../sql/002_core_views.sql', import.meta.url), 'utf8');
  return cachedViewSql;
}

function paths(config: Pick<DataConfig, 'projectId' | 'ingestDataset'>) {
  const path = (name: string) => `\`${config.projectId}.${config.ingestDataset}.${name}\``;
  return { path, current: path(GEO_CURRENT_TABLE), state: path(GEO_CURRENT_STATE_TABLE) };
}

/** Latest published batch per source, with the history view's own state ordering. */
const latestPublishedSql = (path: (name: string) => string, sourceFilter: string) => `
  SELECT source_id, batch_id, published_at FROM (
    SELECT batch_id, source_id, state, published_at, started_at FROM ${path('sync_batches')}
    WHERE ${sourceFilter}
    QUALIFY ROW_NUMBER() OVER (PARTITION BY batch_id ORDER BY state_updated_at DESC, started_at DESC, batch_id DESC) = 1
  )
  WHERE state = 'published' AND published_at IS NOT NULL
  QUALIFY ROW_NUMBER() OVER (PARTITION BY source_id ORDER BY published_at DESC, started_at DESC, batch_id DESC) = 1`;

/** Replace the selected sources' rows with the view's current rows, and their state, in one transaction. */
export function rebuildGeoRecordsCurrentSql(config: Pick<DataConfig, 'projectId' | 'ingestDataset'>, viewSql: string): string {
  const { path, current, state } = paths(config);
  return `/* rebuild-geo-records-current */
BEGIN TRANSACTION;
DELETE FROM ${current} WHERE source_id IN UNNEST(@sourceIds);
INSERT INTO ${current} (${COLUMNS.join(', ')})
SELECT ${COLUMNS.join(', ')} FROM (${currentGeoRecordsSelect(viewSql, config)}) AS v
WHERE v.source_id IN UNNEST(@sourceIds);
DELETE FROM ${state} WHERE source_id IN UNNEST(@sourceIds);
INSERT INTO ${state} (source_id, batch_id, published_at, refreshed_at, method)
SELECT id, b.batch_id, b.published_at, CURRENT_TIMESTAMP(), 'rebuild'
FROM UNNEST(@sourceIds) AS id
LEFT JOIN (${latestPublishedSql(path, 'source_id IN UNNEST(@sourceIds)')}) AS b ON b.source_id = id;
COMMIT TRANSACTION;`;
}

/**
 * Apply an append source's batches published since its recorded state. Each record keeps its newest
 * version by the history view's ordering; a newer version that is not public, or that ended the
 * record, removes it, as the views do. The read covers only the recent partitions those batches
 * wrote. Without a recorded state the script fails, and the caller rebuilds instead.
 */
export function applyGeoRecordsCurrentBatchesSql(config: Pick<DataConfig, 'projectId' | 'ingestDataset'>): string {
  const { path, current, state } = paths(config);
  const incomingColumns = COLUMNS.map(column => column === 'geometry'
    ? 'SAFE.ST_GEOGFROMGEOJSON(i.geometry_geojson) AS geometry'
    : column === 'is_prediction' ? "i.assertion_kind = 'prediction' AS is_prediction" : `i.${column}`);
  return `/* apply-geo-records-current */
DECLARE state_published TIMESTAMP;
DECLARE fetched_floor DATE;
DECLARE source_public BOOL;
BEGIN TRANSACTION;
SET state_published = (SELECT published_at FROM ${state} WHERE source_id = @sourceId
  ORDER BY refreshed_at DESC LIMIT 1);
IF state_published IS NULL THEN
  RAISE USING MESSAGE = '${NO_STATE_MESSAGE}';
END IF;
CREATE TEMP TABLE new_batches AS
SELECT batch_id, source_id, published_at FROM (
  SELECT batch_id, source_id, state, published_at FROM ${path('sync_batches')} WHERE source_id = @sourceId
  QUALIFY ROW_NUMBER() OVER (PARTITION BY batch_id ORDER BY state_updated_at DESC, started_at DESC, batch_id DESC) = 1
) WHERE state = 'published' AND published_at IS NOT NULL AND published_at > state_published;
-- Rows are written before their batch publishes; two days covers a run that spans midnight.
SET fetched_floor = DATE_SUB(DATE((SELECT MIN(published_at) FROM new_batches)), INTERVAL 2 DAY);
SET source_public = EXISTS (
  SELECT 1 FROM ${path('data_sources')} WHERE source_id = @sourceId
  QUALIFY ROW_NUMBER() OVER (PARTITION BY source_id ORDER BY updated_at DESC, source_id DESC) = 1
    AND license_status IN ${PUBLIC_RIGHTS} AND access_status = 'active');
CREATE TEMP TABLE incoming AS
SELECT g.*, b.published_at AS batch_published_at
FROM ${path('geo_records')} AS g
JOIN new_batches AS b ON g.batch_id = b.batch_id AND g.source_id = b.source_id
WHERE g.source_id = @sourceId AND DATE(g.fetched_at) >= fetched_floor
QUALIFY ROW_NUMBER() OVER (PARTITION BY g.geo_record_id, g.version_id
  ORDER BY b.published_at DESC, g.fetched_at DESC, g.batch_id DESC) = 1;
CREATE TEMP TABLE winners AS
SELECT geo_record_id, version_id, is_incoming FROM (
  SELECT geo_record_id, version_id, source_updated_at, source_version_ordinal, 1 AS is_incoming FROM incoming
  UNION ALL
  SELECT geo_record_id, version_id, source_updated_at, source_version_ordinal, 0 AS is_incoming FROM ${current}
  WHERE source_id = @sourceId AND geo_record_id IN (SELECT geo_record_id FROM incoming)
)
QUALIFY ROW_NUMBER() OVER (PARTITION BY geo_record_id ORDER BY source_updated_at DESC NULLS LAST,
  source_version_ordinal DESC NULLS LAST, version_id DESC, is_incoming DESC) = 1;
DELETE FROM ${current} WHERE source_id = @sourceId
  AND geo_record_id IN (SELECT geo_record_id FROM winners WHERE is_incoming = 1);
INSERT INTO ${current} (${COLUMNS.join(', ')})
SELECT ${incomingColumns.join(', ')}
FROM incoming AS i JOIN winners AS w USING (geo_record_id, version_id)
WHERE w.is_incoming = 1 AND source_public
  AND i.public_query_allowed = TRUE AND i.rights_status IN ${PUBLIC_RIGHTS}
  AND i.record_status NOT IN ${ENDED};
DELETE FROM ${state} WHERE source_id = @sourceId AND EXISTS (SELECT 1 FROM new_batches);
INSERT INTO ${state} (source_id, batch_id, published_at, refreshed_at, method)
SELECT source_id, batch_id, published_at, CURRENT_TIMESTAMP(), 'incremental'
FROM new_batches ORDER BY published_at DESC, batch_id DESC LIMIT 1;
COMMIT TRANSACTION;`;
}

type Query = Pick<BigQuery, 'query'>;
function queryOptions(config: DataConfig, query: string, params: Record<string, unknown>,
  maximumBytesBilled = config.maxBytesBilled) {
  if (!config.maxBytesBilled || !maximumBytesBilled) throw new Error('Geo current refresh requires a BigQuery query ceiling');
  return { query, params, location: config.region, maximumBytesBilled };
}

export async function rebuildGeoRecordsCurrent(config: DataConfig, bigquery: Query,
  sourceIds: readonly string[], viewSql = readCoreViewSql()): Promise<void> {
  if (sourceIds.length === 0 || sourceIds.some(id => !GEO_CURRENT_SOURCES.has(id))) {
    throw new Error('Geo current rebuild needs map geo sources');
  }
  await bigquery.query(queryOptions(config, rebuildGeoRecordsCurrentSql(config, viewSql), { sourceIds: [...sourceIds] },
    GEO_CURRENT_REBUILD_MAX_BYTES));
}

/**
 * Refresh one source after it published. Append sources apply their new batches and fall back to
 * a rebuild when no state is recorded yet; every other map source rebuilds its own rows.
 */
export async function refreshGeoRecordsCurrent(config: DataConfig, bigquery: Query, sourceId: string,
  viewSql?: string): Promise<'incremental' | 'rebuild'> {
  if (!GEO_CURRENT_SOURCES.has(sourceId)) throw new Error('Not a map geo source');
  if (INCREMENTAL_GEO_SOURCES.has(sourceId)) {
    try {
      await bigquery.query(queryOptions(config, applyGeoRecordsCurrentBatchesSql(config), { sourceId }));
      return 'incremental';
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes(NO_STATE_MESSAGE)) throw error;
    }
  }
  await rebuildGeoRecordsCurrent(config, bigquery, [sourceId], viewSql);
  return 'rebuild';
}
