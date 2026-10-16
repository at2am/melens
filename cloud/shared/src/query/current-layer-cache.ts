import { z } from 'zod';

import { validateMapConfig, type MapConfig } from '../config.js';
import { MapQueryError } from '../errors.js';
import { identifierSchema, parseViewportQuery, type Bbox, type LayerId, type ViewportQuery } from '../contracts/map-contract.js';
import type { PreparedViewQuery } from './bigquery-adapter.js';
import { intersectsBox, prepareGeometry, type PreparedGeometry } from './geo-box.js';
import { publicRecordKeysSchema } from './public-record-queries.js';
import { boundedRows, type ViewQueryResult, type ViewQueryRunner } from './query-runner.js';
import { sourceBelongsToLayer, type SourceCoverageReader, type SourceCoverageSnapshot } from './source-coverage.js';
import {
  ANOMALY_COLUMNS, GEO_COLUMNS, GEO_ORDER, PARKING_COLUMNS, PARKING_ORDER, bind, queryDefaults, recordProjection, recordStatusFilter,
  resultLimit, topicFilter, usesTimeWindow, viewPath, type GeoQueryId,
} from './sql.js';

/**
 * Current-mode map layers held in memory, one entry per layer and publication.
 *
 * A layer's current rows change only when one of its sources publishes, yet every map request
 * used to run its own BigQuery job (plus a second one to recheck the rows were still public),
 * about 1-4 s each. Here a layer is loaded once from its small current table and reused until
 * the source registry shows a newer publication of any of its sources. Requests are answered in
 * memory with the same filters, order and limits as the SQL in view-queries.ts.
 * Non-parking public-record checks always use the live SQL rights gate.
 */
export const CACHED_LAYERS: ReadonlySet<LayerId> = new Set(['planning', 'disruption', 'event', 'news', 'parking', 'anomaly']);

/** News rows are mostly ungeolocated GDELT articles (about 40 MB); only drawable ones are held. */
const DRAWABLE_ONLY: ReadonlySet<LayerId> = new Set(['news']);
/** Non-parking checks use the live SQL verifier. */
const VERIFIABLE: ReadonlySet<LayerId> = new Set(['planning', 'disruption', 'event', 'parking']);
/** The parking table carries its batch on every row; the geo copy records its batch per source. */
const PARKING_SOURCE = 'melbourne.parking.sensors';
/** Point layers filtered by their latitude and longitude columns, as their SQL does. */
const POINT_LAYERS: ReadonlySet<LayerId> = new Set(['parking', 'anomaly']);
/** Time-dependent limits (Ticketmaster's 24 hours) are applied by the view when an entry loads. */
const MAX_ENTRY_AGE_MS = 2 * 60_000;
/** A copy that lags the registry still answers its request, then is reloaded shortly after. */
const LAGGING_ENTRY_AGE_MS = 5_000;

interface CachedRow {
  readonly record: string;
  readonly sourceId: string;
  readonly id: string;
  readonly versionId: string;
  readonly sensorId: string | null;
  readonly geometry: PreparedGeometry | null;
  readonly start: number | null;
  readonly validTo: number | null;
  readonly latitude: number | null;
  readonly longitude: number | null;
  readonly batchId: string | null;
}
interface Entry { readonly key: string; readonly rows: readonly CachedRow[]; readonly expiresAt: number }

const queryInput = z.object({
  queryId: z.string(), request: z.unknown(),
  family: z.enum(['viewport', 'unlocated', 'publicRecords']).optional(),
  recordKeys: publicRecordKeysSchema.optional(), approvedScope: z.unknown().optional(),
  publicSourceIds: z.array(identifierSchema).max(1_000).optional(),
  resultBudgetBytes: z.number().int().min(2).optional(),
}).strict();

/** Microseconds since the epoch, so BigQuery's microsecond instants compare exactly. */
export function instantMicros(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const match = typeof value === 'string'
    && /^(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) throw new TypeError('Invalid instant');
  const seconds = Date.parse(`${match[1]!.replace(' ', 'T')}${match[3]}`);
  if (!Number.isFinite(seconds)) throw new TypeError('Invalid instant');
  return seconds * 1_000 + Number((match[2] ?? '').padEnd(6, '0').slice(0, 6));
}

const text = (value: unknown) => typeof value === 'string' ? value : null;
const number = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : null;

function cachedRow(layerId: LayerId, record: string): CachedRow {
  const row = JSON.parse(record) as Record<string, unknown>;
  const sourceId = text(row.source_id);
  if (sourceId === null) throw new TypeError('Cached row without a source');
  if (layerId === 'anomaly') {
    const resultId = text(row.result_id);
    if (resultId === null) throw new TypeError('Anomaly row without a result');
    return { record, sourceId, id: resultId, versionId: '', sensorId: text(row.sensor_id), geometry: null,
      start: null, validTo: null, latitude: number(row.lat), longitude: number(row.lon), batchId: text(row.batch_id) };
  }
  if (layerId === 'parking') {
    const sensorId = text(row.sensor_id);
    if (sensorId === null) throw new TypeError('Parking row without a sensor');
    return { record, sourceId, id: sensorId, versionId: text(row.version_id) ?? '', sensorId, geometry: null,
      start: null, validTo: null, latitude: number(row.latitude), longitude: number(row.longitude), batchId: text(row.batch_id) };
  }
  const id = text(row.geo_record_id), versionId = text(row.version_id);
  if (id === null || versionId === null) throw new TypeError('Geo row without an identity');
  const geojson = text(row.geometry_geojson);
  const start = layerId === 'news'
    ? instantMicros(row.published_at ?? row.observed_at)
    : instantMicros(row.valid_from ?? row.observed_at ?? row.published_at);
  return { record, sourceId, id, versionId, sensorId: null, geometry: geojson === null ? null : prepareGeometry(geojson),
    start, validTo: instantMicros(row.valid_to), latitude: null, longitude: null, batchId: null };
}

/** The current-mode time filter of sql.ts geoTimeFilter, on parsed instants. */
function withinWindow(layerId: LayerId, row: CachedRow, from: number, to: number): boolean {
  if (layerId === 'news') return row.start === null || (row.start >= from && row.start < to);
  return (row.start === null || row.start < to) && (row.validTo === null || row.validTo > from);
}

export function prepareLayerLoad(layerId: LayerId, config: MapConfig, maxRows: number): PreparedViewQuery {
  const defaults = queryDefaults(config, 'current', layerId as never);
  if (layerId === 'anomaly') {
    return { ...defaults, ...resultLimit(maxRows),
      query: `${recordProjection(ANOMALY_COLUMNS)} FROM ${viewPath(config, 'v_anomaly_current')} a
        ORDER BY a.window_to DESC, a.result_id LIMIT @resultLimit` };
  }
  if (layerId === 'parking') {
    return { ...defaults, ...resultLimit(maxRows),
      query: `${recordProjection(PARKING_COLUMNS)} FROM ${viewPath(config, 'v_parking_sensor_current')} s ${PARKING_ORDER}` };
  }
  const topic = topicFilter(layerId as GeoQueryId);
  return { ...defaults, ...bind(resultLimit(maxRows), topic),
    query: `${recordProjection(GEO_COLUMNS)}
      FROM ${viewPath(config, 'v_geo_records_current_served')} g
      WHERE ${topic.sql} AND ${recordStatusFilter('current')} ${DRAWABLE_ONLY.has(layerId) ? 'AND g.geometry IS NOT NULL' : ''}
      ${GEO_ORDER}` };
}

export function prepareStateLoad(config: MapConfig, maxRows: number): PreparedViewQuery {
  return { ...queryDefaults(config, 'current', 'planning'), ...resultLimit(maxRows),
    query: `${recordProjection('s.source_id, s.batch_id')} FROM ${viewPath(config, 'v_geo_records_current_state')} s
      ORDER BY s.source_id LIMIT @resultLimit` };
}

export function createCurrentLayerCache(options: {
  readonly config: MapConfig; readonly runner: Pick<ViewQueryRunner, 'run' | 'runPrepared'>;
  readonly readCoverage: SourceCoverageReader; readonly clock?: () => Date;
  /** Bounds of one layer entry; a larger layer is served by SQL instead. */
  readonly maxRows?: number; readonly maxBytes?: number;
}) {
  const config = validateMapConfig(options.config);
  const clock = options.clock ?? (() => new Date());
  const maxRows = options.maxRows ?? 20_000;
  const maxBytes = options.maxBytes ?? 16 * 1024 * 1024;
  const entries = new Map<LayerId, Entry>();
  const loading = new Map<string, Promise<Entry | null>>();
  const tooLarge = new Map<string, number>();
  const maximumResultBudget = config.maxResponseBytes - config.responseEnvelopeReserveBytes;

  /** Every source the registry places in the layer, with its latest publication. */
  function watermark(layerId: LayerId, coverage: SourceCoverageSnapshot) {
    return coverage.sources.filter((source) => sourceBelongsToLayer(source, layerId))
      .map((source) => [source.sourceId, source.publishedBatchId] as const)
      .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  }

  async function load(layerId: LayerId, key: string, published: ReadonlyMap<string, string>,
    execution: { readonly signal?: AbortSignal }): Promise<Entry | null> {
    const rowsLoad = options.runner.runPrepared(prepareLayerLoad(layerId, config, maxRows),
      { pageSize: maxRows, byteBudget: maxBytes }, execution);
    const stateLoad = POINT_LAYERS.has(layerId) ? null
      : options.runner.runPrepared(prepareStateLoad(config, 1_000), { pageSize: 1_000, byteBudget: 1024 * 1024 }, execution);
    const [result, state] = await Promise.all([rowsLoad, stateLoad]);
    if (state !== null && state.kind !== 'complete') throw new MapQueryError('serviceUnavailable');
    const rows = result.rows.map((row) => cachedRow(layerId, JSON.stringify(row)));
    // The copy is current only when it reflects every publication the registry reports.
    let current: boolean;
    // v_anomaly_current reads the published batches directly: there is no copy that could lag.
    if (layerId === 'anomaly') current = true;
    else if (layerId === 'parking') {
      const batch = published.get(PARKING_SOURCE);
      current = rows.every((row) => row.sourceId !== PARKING_SOURCE || row.batchId === batch);
    } else {
      const reflected = new Map(state!.rows.map((row) => [String(row.source_id), row.batch_id]));
      current = [...published].every(([sourceId, batchId]) => reflected.get(sourceId) === batchId);
    }
    if (!current && layerId !== 'parking') throw new MapQueryError('serviceUnavailable');
    if (result.kind !== 'complete') return null;
    const now = clock().getTime();
    return { key, rows, expiresAt: now + (current ? MAX_ENTRY_AGE_MS : LAGGING_ENTRY_AGE_MS) };
  }

  async function entryFor(layerId: LayerId, request: ViewportQuery,
    execution: { readonly signal?: AbortSignal }): Promise<Entry | null> {
    const coverage = await options.readCoverage(request, execution);
    if (coverage.completeness !== 'complete') {
      if (!POINT_LAYERS.has(layerId)) throw new MapQueryError('serviceUnavailable');
      return null;
    }
    const marks = watermark(layerId, coverage);
    const key = JSON.stringify([layerId, marks]);
    const now = clock().getTime();
    if ((tooLarge.get(key) ?? 0) > now) return null;
    const existing = entries.get(layerId);
    if (existing !== undefined && existing.key === key && existing.expiresAt > now) return existing;
    let pending = loading.get(key);
    if (pending === undefined) {
      const published = new Map(marks.filter((mark): mark is readonly [string, string] => mark[1] !== null));
      // One load per layer and publication, shared by concurrent requests; it is not tied to the
      // first caller's cancellation, because the others still wait for it.
      pending = load(layerId, key, published, {}).then((entry) => {
        if (entry === null) tooLarge.set(key, clock().getTime() + MAX_ENTRY_AGE_MS);
        else entries.set(layerId, entry);
        return entry;
      }).finally(() => loading.delete(key));
      loading.set(key, pending);
    }
    return abortable(pending, execution.signal);
  }

  function page(rows: readonly CachedRow[], request: ViewportQuery, byteBudget: number): ViewQueryResult {
    const pageSize = Math.min(request.pageSize ?? config.maxPageItems, config.maxPageItems);
    const selected = rows.slice(0, pageSize + 1).map((row) => ({ record: row.record }));
    return boundedRows(selected, { pageSize, byteBudget, hasMore: false });
  }

  return {
    async runQuery(input: unknown, execution: { readonly signal?: AbortSignal } = {}): Promise<ViewQueryResult> {
      const parsed = queryInput.safeParse(input);
      let request: ViewportQuery | null = null;
      if (parsed.success && CACHED_LAYERS.has(parsed.data.queryId as LayerId)
        && (parsed.data.family === undefined || parsed.data.family === 'viewport' || parsed.data.family === 'publicRecords')) {
        try { request = parseViewportQuery(parsed.data.request); } catch { request = null; }
      }
      const layerId = parsed.success ? parsed.data.queryId as LayerId : null;
      const family = parsed.success ? parsed.data.family ?? 'viewport' : null;
      if (!parsed.success || request === null || layerId === null || request.mode !== 'current'
        || request.cursor !== undefined || request.snapshotId !== undefined || !request.layers.includes(layerId)
        || (family === 'viewport' && parsed.data.publicSourceIds === undefined)
        || (family === 'publicRecords' && (layerId !== 'parking' || !VERIFIABLE.has(layerId) || parsed.data.recordKeys === undefined))
        || (parsed.data.resultBudgetBytes ?? maximumResultBudget) > maximumResultBudget) {
        return options.runner.run(input, execution);
      }
      let entry: Entry | null;
      try { entry = await entryFor(layerId, request, execution); } catch (error) {
        if (execution.signal?.aborted) throw error;
        if (!POINT_LAYERS.has(layerId)) throw error instanceof MapQueryError ? error : new MapQueryError('serviceUnavailable');
        entry = null; // A failed load leaves the request to the SQL path, which reports its own outcome.
      }
      if (entry === null) return options.runner.run(input, execution);
      const byteBudget = parsed.data.resultBudgetBytes ?? maximumResultBudget;

      if (family === 'publicRecords') {
        const keys = parsed.data.recordKeys!;
        const wanted = new Set(keys.map((key) => layerId === 'parking'
          ? JSON.stringify([key.sourceId, key.sensorId ?? null]) : JSON.stringify([key.sourceId, key.id, key.versionId])));
        // The entry holds every current row of the layer, so a key it lacks is not current.
        return page(entry.rows.filter((row) => wanted.has(layerId === 'parking'
          ? JSON.stringify([row.sourceId, row.sensorId]) : JSON.stringify([row.sourceId, row.id, row.versionId]))),
        request, byteBudget);
      }

      const admitted = new Set(parsed.data.publicSourceIds);
      const box: Bbox = request.bbox;
      const [west, south, east, north] = box;
      const windowed = !POINT_LAYERS.has(layerId) && usesTimeWindow(layerId as GeoQueryId, 'current');
      const from = windowed ? instantMicros(request.window.from)! : 0;
      const to = windowed ? instantMicros(request.window.to)! : 0;
      return page(entry.rows.filter((row) => {
        if (!admitted.has(row.sourceId)) return false;
        if (POINT_LAYERS.has(layerId)) {
          return row.latitude !== null && row.longitude !== null && row.latitude >= south && row.latitude <= north
            && row.longitude >= west && row.longitude <= east;
        }
        return row.geometry !== null && intersectsBox(row.geometry, box) && (!windowed || withinWindow(layerId, row, from, to));
      }), request, byteBudget);
    },
    stats() { return { layers: [...entries.keys()], loading: loading.size }; },
  };
}
export type CurrentLayerCache = ReturnType<typeof createCurrentLayerCache>;

function abortable<T>(value: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (signal === undefined) return value;
  if (signal.aborted) return Promise.reject(new MapQueryError('queryTimeout'));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new MapQueryError('queryTimeout'));
    signal.addEventListener('abort', onAbort, { once: true });
    value.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}
