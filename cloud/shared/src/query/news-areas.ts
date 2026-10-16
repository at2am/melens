import { createHash } from 'node:crypto';

import { validateMapConfig, type MapConfig } from '../config.js';
import { MapQueryError } from '../errors.js';
import { SERVICE_BBOX, bboxSchema, mapItemSchema, type Bbox, type Coverage, type MapGeometry, type MapItem,
  type ViewportQuery } from '../contracts/map-contract.js';
import { parsePublishedGeometry, publicSourceReference, publishedIdentifier, publishedText,
  type PublicSourceResolver } from './adapter-common.js';
import type { PreparedViewQuery } from './bigquery-adapter.js';
import { instantMicros, prepareStateLoad } from './current-layer-cache.js';
import { intersectsBox, prepareGeometry, type PreparedGeometry } from './geo-box.js';
import type { LoadedMemberGroup } from './layer-loaders.js';
import { adaptNewsRow, type NewsItem } from './news.js';
import type { ViewQueryRunner, ViewRow } from './query-runner.js';
import { sourceBelongsToLayer, type SourceCoverageSnapshot } from './source-coverage.js';
import {
  CURRENT_NEWS_LOOKBACK_DAYS, GEO_COLUMNS, NEWS_REPORTED_AT, bind, queryDefaults, recordProjection,
  recordStatusFilter, resultLimit, topicFilter, viewPath,
} from './sql.js';

/*
 * UC-06 news by area. GDELT names places in an article; it never says where the reported event
 * happened, so no article is a point. Each official area (LGA or SA2) that current articles name
 * is drawn with its own boundary and the count of those articles, and keeps the latest of them as
 * members for the details list. The area is an association, never an event site.
 */

/** Area outlines are display shapes: simplified on load, and labelled as simplified. */
export const NEWS_AREA_TOLERANCE_METERS = 100;
/** The latest articles kept per area for its details list (UC-06 asks for the top 3). */
export const NEWS_AREA_MEMBERS = 5;
/**
 * A loaded copy is reused within one publication of the news sources, for at most this long. The
 * window is applied per request, so only a new publication changes the rows.
 */
const MAX_ENTRY_AGE_MS = 15 * 60_000;
/**
 * Boundary outlines are kept across loads: reading them scans about 180 MB. They are read again
 * only when an article names an area they did not cover, or after this long.
 */
const BOUNDARY_MAX_AGE_MS = 6 * 3_600_000;
/** A copy that could not be used (incomplete, or behind the registry) is not retried before this. */
const RETRY_AFTER_MS = 30_000;
/**
 * A request waits this long for the copy of a new publication (a load takes about 10 s), then
 * answers without areas while the load finishes. A copy of the same publication that only aged
 * is served at once while it is refreshed.
 */
const LOAD_WAIT_MS = 15_000;
const LOOKBACK_MICROS = CURRENT_NEWS_LOOKBACK_DAYS * 24 * 3_600 * 1_000_000;

/**
 * The summary metadata is about two thirds of the rows' bytes, yet the news adapter reads only its
 * `summary_text`. Keeping just that field yields the same item the public-record recheck rebuilds.
 */
const NEWS_AREA_COLUMNS = GEO_COLUMNS.replace('g.summary,', `CASE WHEN g.summary IS NULL THEN NULL
    WHEN JSON_VALUE(g.summary, '$.summary_text') IS NULL THEN '{}'
    ELSE TO_JSON_STRING(STRUCT(JSON_VALUE(g.summary, '$.summary_text') AS summary_text)) END AS summary,`);

interface AreaRow {
  readonly row: ViewRow; readonly sourceId: string; readonly start: number | null; readonly refs: readonly string[];
}
interface Area {
  readonly boundaryId: string; readonly versionId: string; readonly name: string; readonly sourceId: string;
  readonly geometry: MapGeometry; readonly prepared: PreparedGeometry;
}
interface Entry { readonly key: string; readonly rows: readonly AreaRow[]; readonly areas: ReadonlyMap<string, Area>;
  readonly expiresAt: number }
/** The outlines of every area current articles named when they were read (including ones with no drawable shape). */
interface Boundaries { readonly areas: ReadonlyMap<string, Area>; readonly covered: ReadonlySet<string>; readonly loadedAt: number }

export function prepareNewsAreaRowsLoad(config: MapConfig, maxRows: number): PreparedViewQuery {
  const topic = topicFilter('news');
  return { ...queryDefaults(config, 'current', 'news'), ...bind(resultLimit(maxRows), topic),
    query: `${recordProjection(NEWS_AREA_COLUMNS)}
      FROM ${viewPath(config, 'v_geo_records_current_served')} g
      WHERE ${topic.sql} AND ${recordStatusFilter('current')} AND g.geometry IS NULL AND ARRAY_LENGTH(g.area_refs) > 0
        AND g.location_role IN ('mentioned_place', 'area_only')
        AND (${NEWS_REPORTED_AT} IS NULL
          OR ${NEWS_REPORTED_AT} >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL ${CURRENT_NEWS_LOOKBACK_DAYS + 1} DAY))
      ORDER BY ${NEWS_REPORTED_AT} DESC, g.geo_record_id, g.version_id LIMIT @resultLimit` };
}

export function prepareNewsAreaBoundariesLoad(config: MapConfig, maxRows: number): PreparedViewQuery {
  const topic = topicFilter('news');
  return { ...queryDefaults(config, 'current', 'boundary'), ...bind(resultLimit(maxRows), topic),
    query: `${recordProjection(`b.boundary_id, b.version_id, b.name, b.source_id,
        ST_ASGEOJSON(ST_UNION(ARRAY(SELECT part
          FROM UNNEST(ST_DUMP(ST_SIMPLIFY(b.geometry, ${NEWS_AREA_TOLERANCE_METERS}), 2)) part))) AS geometry_geojson`)}
      FROM ${viewPath(config, 'v_boundaries')} b
      WHERE b.boundary_id IN (SELECT DISTINCT ref FROM ${viewPath(config, 'v_geo_records_current_served')} g,
        UNNEST(g.area_refs) ref WHERE ${topic.sql} AND ${recordStatusFilter('current')} AND g.geometry IS NULL)
      ORDER BY b.boundary_id, b.version_id LIMIT @resultLimit` };
}

/** One story's syndicated copies share a headline; without one, an article is its own story. */
function storyKey(row: AreaRow): string {
  const title = typeof row.row.title === 'string' ? row.row.title.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim() : '';
  return title === '' ? `id:${String(row.row.geo_record_id)}` : `title:${title}`;
}

function areaRow(row: ViewRow): AreaRow {
  const sourceId = row.source_id;
  if (typeof sourceId !== 'string') throw new TypeError('News row without a source');
  const refs = Array.isArray(row.area_refs) ? row.area_refs.filter((ref): ref is string => typeof ref === 'string') : [];
  return { row, sourceId, refs, start: instantMicros(row.published_at ?? row.observed_at ?? row.source_updated_at) };
}

/** Simplifying can leave stray lines beside a polygon; the SQL keeps the polygons, and any other shape is skipped. */
function area(row: ViewRow): Area | null {
  let geometry: MapGeometry | null;
  try { geometry = parsePublishedGeometry(row.geometry_geojson); } catch { return null; }
  const name = publishedText(row.name);
  if (geometry === null || (geometry.type !== 'Polygon' && geometry.type !== 'MultiPolygon') || name === null
    || typeof row.source_id !== 'string') return null;
  return { boundaryId: publishedIdentifier(row.boundary_id), versionId: publishedIdentifier(row.version_id), name,
    sourceId: row.source_id, geometry, prepared: prepareGeometry(JSON.stringify(geometry)) };
}

function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

/** The area's own extent, kept inside the service envelope that every contract bbox must respect. */
function areaBounds(geometry: MapGeometry): Bbox {
  const positions = geometry.type === 'Polygon' ? geometry.coordinates.flat()
    : geometry.type === 'MultiPolygon' ? geometry.coordinates.flat(2) : [];
  const longitudes = positions.map((position) => position[0]);
  const latitudes = positions.map((position) => position[1]);
  return bboxSchema.parse([Math.max(SERVICE_BBOX[0], Math.min(...longitudes)), Math.max(SERVICE_BBOX[1], Math.min(...latitudes)),
    Math.min(SERVICE_BBOX[2], Math.max(...longitudes)), Math.min(SERVICE_BBOX[3], Math.max(...latitudes))]);
}

type AggregateItem = Extract<MapItem, { kind: 'aggregate' }>;

function areaAggregate(area: Area, members: readonly NewsItem[], total: number, request: ViewportQuery,
  coverage: Coverage, resolveSource: PublicSourceResolver): AggregateItem | null {
  const boundarySource = resolveSource(area.sourceId);
  if (boundarySource === null) return null;
  const memberIds = members.map((member) => member.id);
  // The boundary version drawn, and each news source once; every member keeps its own article link.
  const newsSources = [...new Set(members.map((member) => member.sources[0]!.sourceId))].sort()
    .map((sourceId) => resolveSource(sourceId));
  if (newsSources.some((source) => source === null)) return null;
  const sources = [publicSourceReference(boundarySource, area.versionId),
    ...newsSources.map((source) => ({ ...source!, versionRef: null }))];
  const plural = total === 1 ? 'story' : 'stories';
  // An LGA and an SA2 can share a name (Maribyrnong), so a council area says so.
  const place = area.boundaryId.startsWith('ASGS_LGA:') ? `${area.name} council area` : area.name;
  const parsed = mapItemSchema.parse({
    id: `aggregate.news.area.${area.boundaryId}`,
    versionId: `areaMentions-v1.${digest([area.versionId, total, members.map((member) => [member.id, member.versionId]),
      request.window, coverage])}`,
    layerId: 'news', kind: 'aggregate', title: `${place}: ${total} news ${plural}`,
    geometry: area.geometry,
    location: { precision: 'area', role: 'areaAssociation',
      evidence: 'Official boundary of an area these articles name. A named place is not where the reported event happened.' },
    geometryPresentation: { simplified: true, originalPrecision: 'area', toleranceMeters: NEWS_AREA_TOLERANCE_METERS },
    assertionKind: 'report', lifecycle: 'active',
    time: { observedAt: null, reportedAt: null, validFrom: null, validTo: null, periodLabel: null, fetchedAt: null,
      sourceTimeText: null, sourceTimezone: null },
    sources,
    details: {
      representation: 'areaMentions', memberIds, memberCursor: null,
      resultRange: { scope: 'areaAssociation', returnedCount: members.length, totalMatching: total },
      metric: { id: 'newsAreaStoryCount', label: 'News stories naming this area', unit: 'stories', value: total,
        definition: `Stories from the last ${CURRENT_NEWS_LOOKBACK_DAYS} days whose articles name ${place}. Copies of a story under the same headline count once; one story can name several areas, and "Melbourne" on its own is counted for the City of Melbourne. Up to the latest ${NEWS_AREA_MEMBERS} are listed.` },
      window: null, coverage: structuredClone(coverage), bounds: areaBounds(area.geometry), grid: null,
    },
  });
  return parsed.kind === 'aggregate' ? parsed : null;
}

export interface NewsAreas {
  /** The current news areas of one viewport request. */
  readonly load: NewsAreaLoader;
  /** Starts loading the copy of the latest publication, if it is not loaded or loading, without waiting. */
  readonly warm: (coverage: SourceCoverageSnapshot) => void;
}

export type NewsAreaLoader = (request: ViewportQuery, options: {
  readonly coverage: SourceCoverageSnapshot; readonly layerCoverage: Coverage;
  readonly publicSourceIds: readonly string[]; readonly resolveSource: PublicSourceResolver;
  readonly rowLimit: number; readonly signal?: AbortSignal;
}) => Promise<readonly LoadedMemberGroup[]>;

/**
 * Current news areas, loaded once per publication of the news sources and answered in memory.
 * `warm` lets the service start that load before anyone asks, so a request rarely waits for it.
 * Historical requests get none: the copy holds current records only.
 */
export function createNewsAreaLoader(options: {
  readonly config: MapConfig; readonly runner: Pick<ViewQueryRunner, 'runPrepared'>; readonly clock?: () => Date;
  readonly maxRows?: number; readonly maxBytes?: number;
}): NewsAreas {
  const config = validateMapConfig(options.config);
  const clock = options.clock ?? (() => new Date());
  const maxRows = options.maxRows ?? 20_000;
  const maxBytes = options.maxBytes ?? 24 * 1024 * 1024;
  let entry: Entry | null = null;
  let boundaries: Boundaries | null = null;
  const loading = new Map<string, Promise<Entry | null>>();
  const retryAt = new Map<string, number>();

  async function readBoundaries(): Promise<Boundaries | null> {
    // The ids the query covers are the refs of every current article; they bound later reuse.
    const read = await options.runner.runPrepared(prepareNewsAreaBoundariesLoad(config, 2_000),
      { pageSize: 2_000, byteBudget: 8 * 1024 * 1024 }, {});
    if (read.kind !== 'complete') return null;
    const areas = new Map(read.rows.map(area).filter((value): value is Area => value !== null)
      .map((value) => [value.boundaryId, value]));
    return { areas, covered: new Set(), loadedAt: clock().getTime() };
  }

  async function load(key: string, published: ReadonlyMap<string, string>): Promise<Entry | null> {
    const kept = boundaries !== null && clock().getTime() - boundaries.loadedAt < BOUNDARY_MAX_AGE_MS ? boundaries : null;
    const [rows, state, fresh] = await Promise.all([
      options.runner.runPrepared(prepareNewsAreaRowsLoad(config, maxRows), { pageSize: maxRows, byteBudget: maxBytes }, {}),
      options.runner.runPrepared(prepareStateLoad(config, 1_000), { pageSize: 1_000, byteBudget: 1024 * 1024 }, {}),
      kept === null ? readBoundaries() : Promise.resolve(null),
    ]);
    // A copy that is incomplete or behind the registry would list versions the rights check rejects.
    if (rows.kind !== 'complete' || state.kind !== 'complete') return null;
    const reflected = new Map(state.rows.map((row) => [String(row.source_id), row.batch_id]));
    if (![...published].every(([sourceId, batchId]) => reflected.get(sourceId) === batchId)) return null;
    const areaRows = rows.rows.map(areaRow);
    const refs = new Set(areaRows.flatMap((row) => row.refs));
    let outlines = fresh ?? kept;
    // An area the kept outlines never covered was named after they were read.
    if (outlines !== null && fresh === null && [...refs].some((ref) => !outlines!.covered.has(ref))) outlines = await readBoundaries();
    if (outlines === null) return null;
    boundaries = { ...outlines, covered: new Set([...outlines.covered, ...refs]) };
    return { key, rows: areaRows, areas: boundaries.areas, expiresAt: clock().getTime() + MAX_ENTRY_AGE_MS };
  }

  function newsKey(coverage: SourceCoverageSnapshot) {
    const marks = coverage.sources.filter((source) => sourceBelongsToLayer(source, 'news'))
      .map((source) => [source.sourceId, source.publishedBatchId] as const)
      .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
    return { marks, key: JSON.stringify(marks) };
  }

  /** The copy for this publication if it is fresh, else the load that brings it (null while one may not start). */
  function ensure(coverage: SourceCoverageSnapshot): { readonly ready: Entry | null; readonly pending: Promise<Entry | null> | null;
    readonly stale: Entry | null } {
    const { marks, key } = newsKey(coverage);
    const now = clock().getTime();
    const sameKey = entry !== null && entry.key === key ? entry : null;
    if (sameKey !== null && sameKey.expiresAt > now) return { ready: sameKey, pending: null, stale: null };
    if ((retryAt.get(key) ?? 0) > now) return { ready: sameKey, pending: null, stale: null };
    let pending = loading.get(key);
    if (pending === undefined) {
      const published = new Map(marks.filter((mark): mark is readonly [string, string] => mark[1] !== null));
      pending = load(key, published).catch(() => null).then((loaded) => {
        retryAt.clear();
        if (loaded === null) retryAt.set(key, clock().getTime() + RETRY_AFTER_MS);
        else entry = loaded;
        return loaded;
      }).finally(() => loading.delete(key));
      loading.set(key, pending);
    }
    return { ready: null, pending, stale: sameKey };
  }

  async function current(coverage: SourceCoverageSnapshot): Promise<Entry | null> {
    const { ready, pending, stale } = ensure(coverage);
    if (pending === null) return ready;
    // A copy of the same publication that only aged is served while it is refreshed.
    if (stale !== null) return stale;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const waited = new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), LOAD_WAIT_MS); });
    return Promise.race([pending, waited]).finally(() => clearTimeout(timer));
  }

  const warm = (coverage: SourceCoverageSnapshot) => { ensure(coverage); };
  const loadAreas: NewsAreaLoader = async (request, context) => {
    if (request.mode !== 'current' || context.rowLimit < 1) return [];
    let loaded: Entry | null;
    try { loaded = await abortable(current(context.coverage), context.signal); } catch (error) {
      if (context.signal?.aborted) throw error;
      return [];
    }
    if (loaded === null) return [];
    const admitted = new Set(context.publicSourceIds);
    const to = instantMicros(request.window.to)!;
    const byArea = new Map<string, AreaRow[]>();
    for (const row of loaded.rows) {
      if (!admitted.has(row.sourceId) || (row.start !== null && (row.start < to - LOOKBACK_MICROS || row.start >= to))) continue;
      for (const ref of new Set(row.refs)) {
        const shape = loaded.areas.get(ref);
        if (shape === undefined || !intersectsBox(shape.prepared, request.bbox)) continue;
        const list = byArea.get(ref);
        if (list === undefined) byArea.set(ref, [row]);
        else list.push(row);
      }
    }
    // Every member counts against the request's row limit, so dense views list fewer per area.
    const perArea = Math.min(NEWS_AREA_MEMBERS, Math.floor(context.rowLimit / Math.max(1, byArea.size)));
    if (perArea < 1) return [];
    const groups: LoadedMemberGroup[] = [];
    for (const [ref, rows] of [...byArea].sort(([a], [b]) => a < b ? -1 : 1)) {
      const members: NewsItem[] = [];
      // Syndicated copies of one story (same headline, several outlets) count and list once.
      const stories = new Set(rows.map(storyKey));
      const listed = new Set<string>();
      // Rows arrive newest first, so each story is listed by its newest copy.
      for (const row of rows) {
        if (members.length === perArea) break;
        const story = storyKey(row);
        const source = context.resolveSource(row.sourceId);
        if (listed.has(story) || source === null) continue;
        try { members.push(adaptNewsRow(row.row, { source })); listed.add(story); } catch { /* an invalid record is never listed */ }
      }
      if (members.length === 0) continue;
      members.sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
      const aggregate = areaAggregate(loaded.areas.get(ref)!, members, stories.size, request, context.layerCoverage,
        context.resolveSource);
      if (aggregate !== null) groups.push({ aggregate, members });
    }
    return groups;
  };
  return { load: loadAreas, warm };
}

function abortable<T>(value: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (signal === undefined) return value;
  if (signal.aborted) return Promise.reject(new MapQueryError('queryTimeout'));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new MapQueryError('queryTimeout'));
    signal.addEventListener('abort', onAbort, { once: true });
    value.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}
