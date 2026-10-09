import { z } from 'zod';

import { compareInstants, compareMapItems, geometrySchema, sourceReferenceSchema, type MapGeometry, type MapItem }
  from '../contracts/map-contract.js';
import type { ViewRow } from './query-runner.js';

export type PublicSourceReference = MapItem['sources'][number];
/** The caller resolves only currently admitted, published public sources. */
export type PublicSourceResolver = (sourceId: string) => PublicSourceReference | null;

export const publishedGeoRowSchema = z.object({
  geo_record_id: z.string(), version_id: z.string(), source_id: z.string(), topic: z.string(),
  assertion_kind: z.enum(['observation', 'report', 'plan', 'prediction']), is_prediction: z.boolean().optional(),
  title: z.string().nullable(), summary: z.string().nullable(), original_url: z.string().nullable(),
  geometry_geojson: z.string().nullable(),
  location_role: z.enum(['event_site', 'sensor_site', 'area_only', 'mentioned_place', 'unknown']),
  location_confidence: z.enum(['source_coordinate', 'official_join', 'resolved_area', 'unverified']),
  area_refs: z.array(z.string()), observed_at: z.string().nullable(), published_at: z.string().nullable(),
  valid_from: z.string().nullable(), valid_to: z.string().nullable(), fetched_at: z.string().nullable(),
  freshness_state: z.string().optional(),
  record_status: z.enum(['active', 'planned', 'cancelled', 'resolved', 'withdrawn']),
  source_time_text: z.string().nullable().optional(), source_timezone: z.string().nullable().optional(),
  period_label: z.string().nullable().optional(),
});

export interface PublishedItemBatch<T extends MapItem = MapItem> {
  readonly items: readonly T[];
  readonly unlocatedItems: readonly T[];
  readonly sourceIds: readonly string[];
  /** Scoped unresolved totals require an independent association proof in T014. */
  readonly unresolvedCount: null;
}

export class MapAdapterError extends Error {
  constructor(readonly code: 'invalidRecord' | 'notPublic' = 'invalidRecord') {
    super(code === 'notPublic' ? 'Published source is unavailable' : 'Invalid published map record');
    this.name = 'MapAdapterError';
  }
}

const utcInstant = z.iso.datetime({ offset: false })
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/)
  .refine((value) => Number.isFinite(Date.parse(value)));

/** Neither source-local clocks nor fetch time are promoted to observation time. */
export function publishedInstant(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const parsed = utcInstant.safeParse(value);
  if (!parsed.success) throw new MapAdapterError();
  return parsed.data;
}

function requirePublishedInstant(value: unknown): string {
  const parsed = publishedInstant(value);
  if (parsed === null) throw new MapAdapterError();
  return parsed;
}

function instantMicroseconds(value: string): bigint {
  const parsed = requirePublishedInstant(value);
  const fraction = /\.(\d+)Z$/.exec(parsed)?.[1] ?? '';
  return BigInt(Date.parse(parsed.replace(/\.\d+Z$/, 'Z'))) * 1_000n
    + BigInt(fraction.padEnd(6, '0'));
}

/** Both operands must be published instants; a malformed one fails the record, not the comparison. */
export function comparePublishedInstants(left: string, right: string): number {
  return compareInstants(requirePublishedInstant(left), requirePublishedInstant(right));
}

export function offsetPublishedInstant(value: string, deltaMs: number): string {
  if (!Number.isSafeInteger(deltaMs)) throw new MapAdapterError();
  const microseconds = instantMicroseconds(value) + BigInt(deltaMs) * 1_000n;
  // Floor division keeps the fraction positive for dates before the Unix epoch.
  const wholeSeconds = microseconds >= 0n ? microseconds / 1_000_000n
    : (microseconds - 999_999n) / 1_000_000n;
  const fraction = String(microseconds - wholeSeconds * 1_000_000n).padStart(6, '0').replace(/0+$/, '');
  const date = new Date(Number(wholeSeconds * 1_000n));
  if (!Number.isFinite(date.getTime())) throw new MapAdapterError();
  const result = `${date.toISOString().replace(/\.000Z$/, '')}${fraction === '' ? '' : `.${fraction}`}Z`;
  return publishedInstant(result) ?? result;
}

export function publishedText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string' || value.length > 4_096) throw new MapAdapterError();
  const text = value.trim();
  return text === '' ? null : text;
}

export function publishedIdentifier(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 256 || /\s/.test(value)) {
    throw new MapAdapterError();
  }
  return value;
}

/** Approved GeoJSON only. Null stays null; centroids and provider payloads are never consulted. */
export function parsePublishedGeometry(raw: unknown): MapGeometry | null {
  if (raw === null || raw === undefined) return null;
  let value: unknown = raw;
  if (typeof raw === 'string') {
    try { value = JSON.parse(raw); }
    catch { throw new MapAdapterError(); }
  }
  const parsed = geometrySchema.safeParse(value);
  if (!parsed.success) throw new MapAdapterError();
  return parsed.data;
}

export function publishedItemTime(row: Readonly<Record<string, unknown>>): MapItem['time'] {
  const time = {
    observedAt: publishedInstant(row.observed_at), reportedAt: publishedInstant(row.published_at),
    validFrom: publishedInstant(row.valid_from), validTo: publishedInstant(row.valid_to),
    fetchedAt: publishedInstant(row.fetched_at), periodLabel: publishedText(row.period_label),
    sourceTimeText: publishedText(row.source_time_text), sourceTimezone: publishedText(row.source_timezone),
  };
  if (time.validFrom !== null && time.validTo !== null
    && comparePublishedInstants(time.validFrom, time.validTo) >= 0) throw new MapAdapterError();
  return time;
}

export function publishedLifecycle(value: unknown): MapItem['lifecycle'] {
  switch (value) {
    case 'active': case 'planned': case 'cancelled': case 'resolved': case 'withdrawn': return value;
    default: throw new MapAdapterError();
  }
}

export function publishedAssertion(row: Readonly<Record<string, unknown>>): MapItem['assertionKind'] {
  const kind = row.assertion_kind;
  if (kind !== 'observation' && kind !== 'report' && kind !== 'plan' && kind !== 'prediction') {
    throw new MapAdapterError();
  }
  if (row.is_prediction !== undefined && row.is_prediction !== (kind === 'prediction')) {
    throw new MapAdapterError();
  }
  return kind;
}

export function publishedLocation(row: Readonly<Record<string, unknown>>, geometry: MapGeometry | null, options: {
  readonly areaRole?: 'affectedExtent' | 'areaAssociation' | 'statisticalArea';
} = {}): MapItem['location'] {
  const confidence = row.location_confidence;
  const roles = {
    event_site: 'eventSite', sensor_site: 'sensor', area_only: options.areaRole ?? 'areaAssociation',
    mentioned_place: 'mention', unknown: 'unknown',
  } as const;
  const sourceRole = row.location_role;
  if (typeof sourceRole !== 'string' || !(sourceRole in roles)
    || !['source_coordinate', 'official_join', 'resolved_area', 'unverified'].includes(String(confidence))) {
    throw new MapAdapterError();
  }
  const role = roles[sourceRole as keyof typeof roles];
  const precision = geometry === null ? 'unlocated'
    : geometry.type === 'Point' || geometry.type === 'MultiPoint' ? 'point'
      : geometry.type === 'LineString' || geometry.type === 'MultiLineString' ? 'line' : 'area';
  if (geometry !== null && (confidence === 'unverified' || role === 'unknown'
    || (precision === 'point' && (confidence === 'resolved_area' || sourceRole === 'area_only'))
    || (confidence === 'resolved_area' && sourceRole !== 'area_only'))) throw new MapAdapterError();
  const evidence = confidence === 'source_coordinate' ? 'Source coordinates'
    : confidence === 'official_join' ? 'Official location join'
      : confidence === 'resolved_area' ? 'Verified area association' : null;
  return { precision, role, evidence };
}

export function publicSourceReference(source: PublicSourceReference, versionId: string,
  originalUrl?: unknown): PublicSourceReference {
  const reference = sourceReferenceSchema.safeParse(source);
  if (!reference.success) throw new MapAdapterError('notPublic');
  const selected = sourceReferenceSchema.safeParse({
    sourceId: reference.data.sourceId,
    url: originalUrl === null || originalUrl === undefined ? reference.data.url : originalUrl,
    attribution: reference.data.attribution,
    versionRef: publishedIdentifier(versionId),
  });
  if (!selected.success) throw new MapAdapterError();
  return selected.data;
}

export function resolvePublishedSource(row: ViewRow, resolveSource: PublicSourceResolver): PublicSourceReference {
  const sourceId = publishedIdentifier(row.source_id);
  const source = resolveSource(sourceId);
  if (source === null || source.sourceId !== sourceId) throw new MapAdapterError('notPublic');
  return source;
}

/** Fail the layer rather than silently dropping malformed records or preserving a false exact count. */
export function orderedPublishedItems<T extends MapItem>(items: readonly T[]): T[] {
  const ordered = [...items].sort(compareMapItems);
  if (ordered.some((item, index) => index > 0 && compareMapItems(ordered[index - 1]!, item) === 0)) {
    throw new MapAdapterError();
  }
  return ordered;
}

export function publishedItemBatch<T extends MapItem>(items: readonly T[]): PublishedItemBatch<T> {
  const ordered = orderedPublishedItems(items);
  return {
    items: ordered.filter((item) => item.geometry !== null),
    unlocatedItems: ordered.filter((item) => item.geometry === null),
    sourceIds: [...new Set(ordered.flatMap((item) => item.sources.map((source) => source.sourceId)))].sort(),
    unresolvedCount: null,
  };
}
