import { z } from 'zod';

import type { Connector, ConnectorInput, ConnectorResult } from '../../core/connector.js';
import { HttpClient, HttpFailure } from '../../core/http.js';
import type { GeoRecord, GeoRecordSource, SourceRecord } from '../../core/types.js';
import { sourceRecordId, sourceVersionId } from '../../validation/record.js';
import { TICKETMASTER_ATTRIBUTION, ticketmasterUpcomingWindow } from './policy.js';

export const SOURCE_ID = 'ticketmaster.events';
export const ENDPOINT = 'https://app.ticketmaster.com/discovery/v2/events.json';
export const MELBOURNE = { lat: -37.8136, lon: 144.9631 };
export const SEARCH_RADIUS_KM = 80;
export const PAGE_SIZE = 100;
export const DEEP_PAGING_LIMIT = 1000;
export const MAX_REQUEST_PAGES = DEEP_PAGING_LIMIT / PAGE_SIZE;
export const REQUEST_GAP_MS = 350;

/** Discovery search uses whole-second UTC parameters; the input remains half-open. */
export function ticketmasterApiTimeWindow(window: { from: string; to: string }) {
  const fromMs = Math.ceil(Date.parse(window.from) / 1000) * 1000;
  const toMs = Math.floor((Date.parse(window.to) - 1) / 1000) * 1000;
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || fromMs > toMs) {
    throw new Error('Ticketmaster search requires a nonempty whole-second event window');
  }
  return { from: new Date(fromMs).toISOString().replace(/\.\d{3}Z$/, 'Z'),
    to: new Date(toMs).toISOString().replace(/\.\d{3}Z$/, 'Z') };
}

const venueSchema = z.object({
  id: z.string().optional(),
  name: z.string().optional(),
  location: z.object({ longitude: z.string(), latitude: z.string() }).optional(),
  country: z.object({ countryCode: z.string() }).optional(),
  state: z.object({ stateCode: z.string() }).optional(),
}).passthrough();

const eventSchema = z.object({
  id: z.string().trim().min(1),
  name: z.string().trim().min(1),
  url: z.url(),
  dates: z.object({
    start: z.object({ dateTime: z.string().optional(), localDate: z.string().optional(),
      localTime: z.string().optional(), dateTBA: z.boolean().optional(),
      dateTBD: z.boolean().optional(), timeTBA: z.boolean().optional() }).passthrough(),
    end: z.object({ dateTime: z.string().optional() }).passthrough().optional(),
    timezone: z.string().optional(),
    status: z.object({ code: z.string() }).optional(),
  }).passthrough(),
  _embedded: z.object({ venues: z.array(venueSchema).optional() }).passthrough().optional(),
}).passthrough();

const pageSchema = z.object({
  page: z.object({ size: z.number().int().positive(),
    totalElements: z.number().int().nonnegative(),
    totalPages: z.number().int().nonnegative(), number: z.number().int().nonnegative() }),
  _embedded: z.object({ events: z.array(eventSchema).optional() }).optional(),
}).passthrough();

type TicketEvent = z.infer<typeof eventSchema>;
type TicketPage = z.infer<typeof pageSchema>;

export function parseTicketPage(value: unknown): TicketPage { return pageSchema.parse(value); }

/** Standard geohash, used only to define the approximate upstream search circle. */
export function geohash(lat: number, lon: number, precision = 8): string {
  const alphabet = '0123456789bcdefghjkmnpqrstuvwxyz';
  let latMin = -90; let latMax = 90; let lonMin = -180; let lonMax = 180;
  let bits = 0; let value = 0; let encoded = '';
  while (encoded.length < precision) {
    const longitudeBit = bits % 2 === 0;
    const midpoint = longitudeBit ? (lonMin + lonMax) / 2 : (latMin + latMax) / 2;
    const coordinate = longitudeBit ? lon : lat;
    value = (value << 1) | Number(coordinate >= midpoint);
    if (longitudeBit) {
      if (coordinate >= midpoint) lonMin = midpoint; else lonMax = midpoint;
    } else if (coordinate >= midpoint) latMin = midpoint; else latMax = midpoint;
    bits += 1;
    if (bits % 5 === 0) {
      encoded += alphabet[value];
      value = 0;
    }
  }
  return encoded;
}

function timestamp(value: string | undefined): string | null {
  const parsed = z.iso.datetime({ offset: true }).safeParse(value);
  if (!parsed.success || !Number.isFinite(Date.parse(parsed.data))) return null;
  return new Date(parsed.data).toISOString();
}

function pointFor(event: TicketEvent): { lon: number; lat: number } | null {
  const venues = event._embedded?.venues;
  if (venues?.length !== 1) return null;
  const location = venues[0]?.location;
  if (!location || location.longitude.trim() === '' || location.latitude.trim() === '') return null;
  const lon = Number(location.longitude);
  const lat = Number(location.latitude);
  return Number.isFinite(lon) && Number.isFinite(lat) && lon >= -180 && lon <= 180
    && lat >= -90 && lat <= 90 ? { lon, lat } : null;
}

export function normalizeTicketEvents(events: readonly TicketEvent[], input: ConnectorInput,
  fetchedAt: string): { sourceRecords: SourceRecord[]; geoRecords: GeoRecord[];
    geoRecordSources: GeoRecordSource[] } {
  const sourceRecords: SourceRecord[] = [];
  const geoRecords: GeoRecord[] = [];
  const geoRecordSources: GeoRecordSource[] = [];
  const seen = new Set<string>();
  for (const event of events) {
    if (seen.has(event.id)) throw new Error('Duplicate Ticketmaster event ID');
    seen.add(event.id);
    const status = event.dates.status?.code ?? 'unknown';
    const statusLower = status.toLowerCase();
    const cancelled = statusLower === 'canceled' || statusLower === 'cancelled';
    const unscheduled = statusLower === 'postponed' || event.dates.start.dateTBA === true
      || event.dates.start.dateTBD === true;
    const startAt = unscheduled ? null : timestamp(event.dates.start.dateTime);
    const suppliedEnd = timestamp(event.dates.end?.dateTime);
    const endAt = startAt === null ? null
      : suppliedEnd !== null && suppliedEnd >= startAt ? suppliedEnd : null;
    const venues = event._embedded?.venues ?? [];
    const venue = venues.length === 1 ? venues[0] : undefined;
    const point = pointFor(event);
    const id = sourceRecordId({ sourceId: SOURCE_ID, nativeId: event.id,
      originalUrl: event.url, sourceTime: startAt });
    const version = sourceVersionId(null, {
      status, start: event.dates.start, end: event.dates.end,
      timezone: event.dates.timezone, venues: venues.map(entry => ({
        id: entry.id, name: entry.name, location: entry.location,
      })), name: event.name, url: event.url,
    });
    sourceRecords.push({ batch_id: input.runId, source_id: SOURCE_ID, schema_version: 1,
      fetched_at: fetchedAt, source_record_id: id, version_id: version,
      original_url: event.url, raw_uri: null, published_at: null, observed_at: null,
      first_accessible_at: fetchedAt,
      time_missing_reason: 'Discovery API does not provide event publication time',
      valid_from: startAt, valid_to: endAt, source_updated_at: null,
      source_version_ordinal: null,
      record_status: cancelled ? 'cancelled' : 'active', assertion_kind: 'plan',
      rights_status: 'restricted' });
    geoRecords.push({ batch_id: input.runId, source_id: SOURCE_ID, schema_version: 1,
      fetched_at: fetchedAt, geo_record_id: id, version_id: version,
      topic: 'event', assertion_kind: 'plan', title: event.name,
      summary: `${TICKETMASTER_ATTRIBUTION}; Ticketmaster status: ${status}; local start: ${event.dates.start.localDate ?? 'unknown'} ${event.dates.start.localTime ?? ''} ${event.dates.timezone ?? ''}; venue: ${venue?.name ?? (venues.length > 1 ? 'multiple venues' : 'unknown')}`,
      original_url: event.url,
      geometry_geojson: point === null ? null : JSON.stringify({ type: 'Point',
        coordinates: [point.lon, point.lat] }),
      centroid_lon: point?.lon ?? null, centroid_lat: point?.lat ?? null,
      location_role: point === null ? 'unknown' : 'event_site',
      location_confidence: point === null ? 'unverified' : 'source_coordinate',
      area_refs: [], published_at: null, observed_at: null,
      valid_from: startAt, valid_to: endAt, source_updated_at: null,
      source_version_ordinal: null, freshness_state: 'unknown',
      record_status: cancelled ? 'cancelled' : 'planned',
      rights_status: 'restricted', public_query_allowed: true });
    geoRecordSources.push({ batch_id: input.runId, source_id: SOURCE_ID,
      schema_version: 1, fetched_at: fetchedAt,
      geo_record_id: id, version_id: version, source_record_id: id,
      source_version_id: version, evidence_role: 'ticketmaster_event',
      original_url: event.url });
  }
  return { sourceRecords, geoRecords, geoRecordSources };
}

export function failure(input: ConnectorInput, code: 'rate_limited' | 'upstream_unavailable'
  | 'schema_changed' | 'auth_failed' | 'incomplete_window' | 'validation_failed',
  retryAfterSeconds: number | null = null,
  message = 'Ticketmaster event window could not be validated'): ConnectorResult {
  return { kind: 'failure', sourceId: SOURCE_ID, runId: input.runId,
    checkedAt: new Date().toISOString(), code,
    message, retryAfterSeconds,
    completeness: { complete: false, expected_records: null, fetched_records: 0,
      expected_pages: null, fetched_pages: 0,
      evidence: 'All pages within the 1000-result API deep-paging limit are required' },
    sourceLatestUpdateAt: null };
}

export class TicketmasterConnector implements Connector {
  readonly sourceId = SOURCE_ID;
  constructor(private readonly client = new HttpClient(),
    private readonly keyProvider: () => string | undefined = () => process.env.TICKETMASTER_DISCOVERY_API_KEY,
    private readonly now: () => string = () => new Date().toISOString()) {}

  async collect(input: ConnectorInput): Promise<ConnectorResult> {
    if (input.sourceId !== SOURCE_ID) {
      return failure(input, 'validation_failed');
    }
    const key = this.keyProvider()?.trim();
    if (!key) return failure(input, 'auth_failed');
    try {
      const window = input.window.kind === 'time' ? input.window
        : ticketmasterUpcomingWindow(this.now());
      const apiWindow = ticketmasterApiTimeWindow(window);
      const events: TicketEvent[] = [];
      let fetchedAt = new Date().toISOString();
      let total: number | null = null;
      let pages: number | null = null;
      let pageSize: number | null = null;
      let fetchedPages = 0;
      for (let page = 0; ; page += 1) {
        if (page >= MAX_REQUEST_PAGES) {
          return failure(input, 'incomplete_window');
        }
        if (page > 0) await new Promise(resolve => setTimeout(resolve, REQUEST_GAP_MS));
        const url = new URL(ENDPOINT);
        url.searchParams.set('apikey', key);
        url.searchParams.set('countryCode', 'AU');
        url.searchParams.set('stateCode', 'VIC');
        url.searchParams.set('geoPoint', geohash(MELBOURNE.lat, MELBOURNE.lon));
        url.searchParams.set('radius', String(SEARCH_RADIUS_KM));
        url.searchParams.set('unit', 'km');
        url.searchParams.set('startDateTime', apiWindow.from);
        url.searchParams.set('endDateTime', apiWindow.to);
        url.searchParams.set('sort', 'id,asc');
        url.searchParams.set('includeTest', 'no');
        url.searchParams.set('includeTBA', 'no');
        url.searchParams.set('includeTBD', 'no');
        url.searchParams.set('size', String(PAGE_SIZE));
        url.searchParams.set('page', String(page));
        const response = await this.client.getJson({ url, timeoutMs: 20000,
          maxAttempts: 1, redirect: 'error' });
        const body = parseTicketPage(response.body);
        fetchedPages += 1;
        fetchedAt = response.fetchedAt;
        if (body.page.number !== page || (total !== null && body.page.totalElements !== total)
          || (pages !== null && body.page.totalPages !== pages)
          || body.page.size > PAGE_SIZE
          || (pageSize !== null && body.page.size !== pageSize)) {
          return failure(input, 'incomplete_window');
        }
        total = body.page.totalElements;
        pageSize = body.page.size;
        pages = Math.max(1, body.page.totalPages);
        const expectedPages = Math.max(1, Math.ceil(total / pageSize));
        const expectedItems = Math.min(pageSize, Math.max(0, total - page * pageSize));
        const items = body._embedded?.events ?? [];
        if (total > DEEP_PAGING_LIMIT || pages > MAX_REQUEST_PAGES || pages !== expectedPages
          || (total > 0 && body.page.totalPages === 0) || items.length !== expectedItems) {
          return failure(input, 'incomplete_window');
        }
        events.push(...items);
        if (page + 1 >= pages) break;
      }
      if (events.length !== total) return failure(input, 'incomplete_window');
      const normalized = normalizeTicketEvents(events, input, fetchedAt);
      return { kind: 'success', sourceId: SOURCE_ID, runId: input.runId,
        fetchedAt, sourceRevision: sourceVersionId(null, { fetchedAt,
          window, events: normalized.sourceRecords.map(row => [row.source_record_id, row.version_id]) }),
        sourceLatestUpdateAt: null,
        checkpointAfter: input.window.kind === 'time' ? input.window.to : null,
        completeness: { complete: true, method: 'pagination', expected_records: total,
          fetched_records: events.length, expected_pages: pages,
          fetched_pages: fetchedPages,
          evidence: 'Every zero-based page agrees on totalElements and totalPages' },
        inputCount: events.length, outputCount: normalized.sourceRecords.length,
        rejectedCount: 0, ...normalized, boundaries: [], areaIndicators: [],
        parkingBays: [], parkingObservations: [], parkingRules: [], sensorLocations: [],
        pedestrianObservations: [], retainableRawRecords: null };
    } catch (error) {
      const code = error instanceof HttpFailure ? error.code
        : error instanceof z.ZodError ? 'schema_changed' : 'validation_failed';
      const retryAfterSeconds = error instanceof HttpFailure && error.retryAfterMs !== null
        ? Math.ceil(error.retryAfterMs / 1000) : null;
      return failure(input, code, retryAfterSeconds);
    }
  }
}

export const connector: Connector = new TicketmasterConnector();
