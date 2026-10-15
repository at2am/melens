import { z } from 'zod';

import {
  MAX_PAGE_ITEMS, compareInstants, coverageSchema, identifierSchema as identifier, layerResultSchema,
  timeWindowSchema, type Bbox, type Coverage, type LayerId, type LayerResult, type MapItem,
  type TimeWindow, type ViewportQuery,
} from '../contracts/map-contract.js';
import { MapQueryError } from '../errors.js';
import type { ViewQueryResult } from './query-runner.js';

/** Source metadata instants are validated contract instants, so the contract comparison applies. */
export const compareSourceInstants = compareInstants;
const instant = timeWindowSchema.shape.from;
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const sourceRowSchema = z.object({
  source_id: identifier, topic: identifier, scope: identifier,
  coverage_area_refs: z.array(identifier).nullable(),
  coverage_from: instant.nullable(), coverage_to: instant.nullable(),
  license_status: z.enum(['verified_open', 'restricted', 'review_required']),
  access_status: z.enum(['candidate', 'ready', 'active', 'paused']),
  health_state: z.enum(['current', 'late', 'stale', 'healthy_versioned', 'source_unavailable', 'unknown']),
  latest_published_batch_id: identifier.nullable(), latest_published_at: instant.nullable(),
  latest_published_window_from: instant.nullable(), latest_published_window_to: instant.nullable(),
  latest_published_output_count: count.nullable(),
  coverage_evidence_state: z.enum(['verified', 'unknown']),
}).superRefine((row, context) => {
  if (row.coverage_from !== null && row.coverage_to !== null
    && compareSourceInstants(row.coverage_from, row.coverage_to) >= 0) {
    context.addIssue({ code: 'custom', message: 'Invalid declared coverage interval' });
  }
  if (row.latest_published_window_from !== null && row.latest_published_window_to !== null
    && compareSourceInstants(row.latest_published_window_from, row.latest_published_window_to) >= 0) {
    context.addIssue({ code: 'custom', message: 'Invalid published interval' });
  }
});

export interface PublicSourceCoverage {
  readonly sourceId: string;
  readonly topic: string;
  readonly scope: string;
  readonly coverageAreaRefs: readonly string[];
  readonly coverageFrom: string | null;
  readonly coverageTo: string | null;
  readonly licenseStatus: 'verified_open' | 'restricted' | 'review_required';
  readonly accessStatus: 'candidate' | 'ready' | 'active' | 'paused';
  readonly admitted: boolean;
  readonly healthState: 'current' | 'late' | 'stale' | 'healthy_versioned' | 'source_unavailable' | 'unknown';
  readonly publishedBatchId: string | null;
  readonly publishedAt: string | null;
  readonly publishedWindow: TimeWindow | null;
  readonly publishedOutputCount: number | null;
  readonly evidenceState: 'verified' | 'unknown';
}

export interface SourceCoverageSnapshot {
  readonly sources: readonly PublicSourceCoverage[];
  readonly completeness: 'complete' | 'partial';
}

export interface CoverageQueryRunner {
  run(input: unknown, execution?: { readonly signal?: AbortSignal }): Promise<ViewQueryResult>;
}

export type SourceCoverageReader = (
  request: ViewportQuery, execution?: { readonly signal?: AbortSignal },
) => Promise<SourceCoverageSnapshot>;

export function parseSourceCoverage(result: ViewQueryResult): SourceCoverageSnapshot {
  try {
    const rows = z.array(sourceRowSchema).max(MAX_PAGE_ITEMS).parse(result.rows);
    if (new Set(rows.map((row) => row.source_id)).size !== rows.length) {
      throw new Error('Duplicate source metadata');
    }
    const sources = rows.map((row): PublicSourceCoverage => ({
      sourceId: row.source_id, topic: row.topic, scope: row.scope,
      coverageAreaRefs: [...new Set(row.coverage_area_refs ?? [])].sort(),
      coverageFrom: row.coverage_from, coverageTo: row.coverage_to,
      licenseStatus: row.license_status, accessStatus: row.access_status,
      admitted: (row.license_status === 'verified_open' || row.license_status === 'restricted')
        && row.access_status === 'active',
      healthState: row.health_state, publishedBatchId: row.latest_published_batch_id,
      publishedAt: row.latest_published_at,
      publishedWindow: row.latest_published_window_from !== null && row.latest_published_window_to !== null
        ? { from: row.latest_published_window_from, to: row.latest_published_window_to } : null,
      publishedOutputCount: row.latest_published_output_count, evidenceState: row.coverage_evidence_state,
    }));
    return { sources, completeness: result.kind };
  } catch { throw new MapQueryError('serviceUnavailable'); }
}

export function createSourceCoverageReader(options: { readonly runner: CoverageQueryRunner }): {
  read: SourceCoverageReader;
} {
  return {
    async read(request, execution = {}) {
      // Current public access is checked independently of a stored snapshot.
      // A client page size must not truncate the complete source registry.
      const { cursor: _cursor, snapshotId: _snapshotId, ...context } = request;
      try {
        return parseSourceCoverage(await options.runner.run({ queryId: 'sourceCoverage',
          request: { ...context, pageSize: MAX_PAGE_ITEMS } }, execution));
      } catch (error) {
        if (error instanceof MapQueryError) throw error;
        throw new MapQueryError('serviceUnavailable');
      }
    },
  };
}

/**
 * The registry read is the same query for every request, so requests share one result for [ttlMs] and concurrent
 * requests share one query. A failure is not kept. The shared query runs without any caller's signal, so one
 * abandoned request cannot fail the others; each caller still stops waiting when its own signal aborts.
 * For a further [staleMs] after [ttlMs], requests get the last result at once while one background read replaces
 * it, so a request after a quiet spell does not wait about a second for the registry. Access changes in the
 * registry reach the map within [ttlMs] + [staleMs].
 */
export function cacheSourceCoverage(read: SourceCoverageReader, options: {
  readonly ttlMs: number; readonly staleMs?: number; readonly clock?: () => Date;
}): SourceCoverageReader {
  const clock = options.clock ?? (() => new Date());
  const staleMs = options.staleMs ?? 0;
  type Entry = { readonly snapshot: Promise<SourceCoverageSnapshot>; readonly startedAt: number;
    value?: SourceCoverageSnapshot };
  let cached: Entry | null = null;
  let refreshing = false;
  const start = (request: Parameters<SourceCoverageReader>[0], now: number): Entry => {
    const entry: Entry = { snapshot: read(request), startedAt: now };
    entry.snapshot.then((value) => { entry.value = value; }, () => {});
    return entry;
  };
  return async (request, execution = {}) => {
    const now = clock().getTime();
    const age = cached === null || now < cached.startedAt ? Number.POSITIVE_INFINITY : now - cached.startedAt;
    if (cached !== null && age >= options.ttlMs && age < options.ttlMs + staleMs && cached.value !== undefined) {
      const current = cached.value;
      if (!refreshing) {
        refreshing = true;
        const entry = start(request, now);
        entry.snapshot.then(() => { cached = entry; }, () => {}).finally(() => { refreshing = false; });
      }
      return current;
    }
    if (cached === null || age >= options.ttlMs) {
      const entry = start(request, now);
      cached = entry;
      entry.snapshot.catch(() => { if (cached === entry) cached = null; });
    }
    return abortable(cached.snapshot, execution.signal);
  };
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

function published(source: PublicSourceCoverage): boolean {
  return source.publishedBatchId !== null && source.publishedAt !== null;
}

export function findPublicSource(snapshot: SourceCoverageSnapshot, sourceId: string): PublicSourceCoverage | null {
  return snapshot.sources.find((source) => source.sourceId === sourceId && source.admitted && published(source)) ?? null;
}

export function sourceBelongsToLayer(source: PublicSourceCoverage, layerId: LayerId): boolean {
  switch (layerId) {
    case 'pedestrian': return source.topic === 'pedestrian' && source.sourceId !== 'melbourne.pedestrian.locations';
    case 'disruption': return (source.topic === 'road_disruption' || source.topic === 'transport')
      && source.sourceId !== 'victoria.transport.gtfs_static'
      && source.sourceId !== 'melbourne.transport.activity_counts';
    // Only the live sensor feed is drawn. The static bay points and restriction rules share the
    // topic but are references, not readings, and no crosswalk to the sensors is admitted.
    case 'parking': return source.sourceId === 'melbourne.parking.sensors' && source.topic === 'parking';
    case 'rent': return source.sourceId === 'homes_victoria.rents' && source.topic === 'housing';
    case 'census': return source.sourceId === 'abs.census' && source.topic === 'demographics';
    default: return source.topic === layerId;
  }
}

export type CoverageAreaResolver = (source: PublicSourceCoverage, bbox: Bbox) => 'contains' | 'disjoint' | 'unknown';
export interface LayerCoverageAssessment {
  readonly coverage: Coverage;
  readonly freshness: LayerResult['freshness'];
  readonly availability: 'available' | 'notCovered' | 'unavailable' | 'unknown';
  readonly sourceIds: readonly string[];
  readonly updatedAt: string | null;
  readonly queryCoverageVerified?: boolean;
}

const unknownCoverage = (): Coverage => ({ state: 'unknown', areaRefs: [], window: null, evidenceSourceIds: [] });
const healthy = (source: PublicSourceCoverage) => source.healthState === 'current' || source.healthState === 'healthy_versioned';
const hasEvidence = (source: PublicSourceCoverage) => published(source) && source.evidenceState === 'verified'
  && source.coverageAreaRefs.length > 0 && source.coverageFrom !== null;

function effectiveWindow(source: PublicSourceCoverage): TimeWindow | null {
  if (source.publishedWindow === null || source.coverageFrom === null) return null;
  const from = compareSourceInstants(source.coverageFrom, source.publishedWindow.from) > 0
    ? source.coverageFrom : source.publishedWindow.from;
  const to = source.coverageTo !== null && compareSourceInstants(source.coverageTo, source.publishedWindow.to) < 0
    ? source.coverageTo : source.publishedWindow.to;
  return compareSourceInstants(from, to) < 0 ? { from, to } : null;
}

function combinedFreshness(sources: readonly PublicSourceCoverage[]): LayerResult['freshness'] {
  if (sources.length === 0) return 'unknown';
  const states = sources.map((source): LayerResult['freshness'] => {
    if (source.healthState === 'healthy_versioned') return 'versioned';
    if (source.healthState === 'source_unavailable') return 'unknown';
    return source.healthState;
  });
  for (const state of ['unknown', 'stale', 'late', 'current', 'versioned'] as const) {
    if (states.includes(state)) return state;
  }
  return 'unknown';
}

/** Area relationships require actual boundary evidence, never the service envelope or scope label. */
export function assessLayerCoverage(options: {
  readonly snapshot: SourceCoverageSnapshot;
  readonly layerId: LayerId;
  readonly request?: ViewportQuery;
  readonly resolveArea?: CoverageAreaResolver;
}): LayerCoverageAssessment {
  const { snapshot, layerId, request, resolveArea } = options;
  const sources = snapshot.sources.filter((source) => source.admitted && sourceBelongsToLayer(source, layerId));
  const relevant = sources.filter((source) => request === undefined || !hasEvidence(source)
    || resolveArea?.(source, request.bbox) !== 'disjoint');
  const sourceIds = relevant.map((source) => source.sourceId).sort();
  const timestamps = relevant.flatMap((source) => source.publishedAt === null ? [] : [source.publishedAt]);
  const updatedAt = timestamps.sort(compareSourceInstants).at(-1) ?? null;
  const freshness = combinedFreshness(relevant);
  const base = { sourceIds, updatedAt, freshness };
  if (relevant.length === 0) {
    if (snapshot.completeness === 'partial') return { ...base, coverage: unknownCoverage(), availability: 'unknown' };
    if (layerId === 'anomaly') return { ...base, coverage: unknownCoverage(), availability: 'unavailable' };
    return { ...base, coverage: { state: 'notCovered', areaRefs: [], window: null, evidenceSourceIds: [] }, availability: 'notCovered' };
  }
  const usable = relevant.filter((source) => published(source) && healthy(source));
  const readable = relevant.filter((source) => published(source)
    && source.healthState !== 'source_unavailable' && source.healthState !== 'unknown');
  const availability = readable.length > 0 ? 'available'
    : relevant.every((source) => source.healthState === 'source_unavailable') ? 'unavailable' : 'unknown';
  if (snapshot.completeness !== 'complete' || usable.length !== relevant.length
    || !relevant.every(hasEvidence)) {
    return { ...base, coverage: unknownCoverage(), availability };
  }
  const windows = relevant.map(effectiveWindow);
  let window: TimeWindow | null = null;
  if (windows.every((value) => value !== null)) {
    const from = windows.map((value) => value.from).sort(compareSourceInstants).at(-1)!;
    const to = windows.map((value) => value.to).sort(compareSourceInstants)[0]!;
    if (compareSourceInstants(from, to) < 0) window = { from, to };
  }
  if (request !== undefined && (window === null
    || compareSourceInstants(window.from, request.window.from) > 0
    || compareSourceInstants(window.to, request.window.to) < 0
    || !relevant.every((source) => resolveArea?.(source, request.bbox) === 'contains'))) {
    return { ...base, coverage: unknownCoverage(), availability };
  }
  const coverage = coverageSchema.parse({ state: 'verified',
    areaRefs: [...new Set(relevant.flatMap((source) => source.coverageAreaRefs))].sort(),
    window, evidenceSourceIds: sourceIds });
  return { ...base, coverage, availability, queryCoverageVerified: request !== undefined };
}

/** This is the single empty-result policy used by all public layer adapters. */
export function finalizeLayerResult(options: {
  readonly layerId: LayerId;
  readonly assessment: LayerCoverageAssessment;
  readonly items: readonly MapItem[];
  readonly completeness: 'complete' | 'partial';
  readonly unresolvedCount: number | null;
  readonly totalMatching: number | null;
  readonly nextCursor?: string | null;
  readonly observedWindow?: TimeWindow | null;
  readonly querySucceeded?: boolean;
}): LayerResult {
  const { assessment } = options;
  const succeeded = options.querySucceeded !== false;
  const completeness = succeeded ? options.completeness : 'partial';
  const items = succeeded ? [...options.items] : [];
  const nextCursor = succeeded ? options.nextCursor ?? null : null;
  let state: LayerResult['state'];
  if (!succeeded) state = 'unavailable';
  else if (items.length > 0) state = 'available';
  else if (assessment.availability === 'notCovered') state = 'notCovered';
  else if (assessment.availability === 'unavailable') state = 'unavailable';
  else if (assessment.queryCoverageVerified === true
    && assessment.coverage.state === 'verified' && assessment.coverage.window !== null
    && completeness === 'complete' && options.unresolvedCount === 0
    && options.totalMatching === 0 && nextCursor === null) state = 'noMatching';
  else state = 'unknown';
  return layerResultSchema.parse({ layerId: options.layerId, state, freshness: assessment.freshness,
    completeness, sourceIds: [...assessment.sourceIds], coverage: assessment.coverage,
    observedWindow: options.observedWindow ?? null, updatedAt: assessment.updatedAt,
    items, unresolvedCount: options.unresolvedCount, nextCursor,
    totalMatching: state === 'available' || state === 'noMatching' ? options.totalMatching : null });
}
