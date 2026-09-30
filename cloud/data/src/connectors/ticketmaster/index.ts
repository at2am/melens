import { z } from 'zod';

import type { Connector, ConnectorInput, ConnectorResult } from '../../core/connector.js';
import { HttpClient, HttpFailure } from '../../core/http.js';
import type { GeoRecord, GeoRecordSource, SourceRecord } from '../../core/types.js';
import { sourceRecordId, sourceVersionId } from '../../validation/record.js';

const SOURCE_ID = 'ticketmaster.events';
const ENDPOINT = 'https://app.ticketmaster.com/discovery/v2/events.json';
const MELBOURNE = { lat: -37.8136, lon: 144.9631 };
const SEARCH_RADIUS_KM = 80;
const PAGE_SIZE = 100;

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
  if (!value || !Number.isFinite(Date.parse(value))
    || !/(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
  return new Date(value).toISOString();
}

function pointFor(event: TicketEvent): { lon: number; lat: number } | null {
  const location = event._embedded?.venues?.[0]?.location;
  if (!location) return null;
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
    const cancelled = status === 'canceled';
    const unscheduled = status === 'postponed' || event.dates.start.dateTBA === true
      || event.dates.start.dateTBD === true;
    const startAt = unscheduled ? null : timestamp(event.dates.start.dateTime);
    const suppliedEnd = timestamp(event.dates.end?.dateTime);
    const endAt = startAt === null ? null
      : suppliedEnd !== null && suppliedEnd >= startAt ? suppliedEnd : startAt;
    const venue = event._embedded?.venues?.[0];
    const point = pointFor(event);
    const id = sourceRecordId({ sourceId: SOURCE_ID, nativeId: event.id,
      originalUrl: event.url, sourceTime: startAt });
    const version = sourceVersionId(null, {
      status, start: event.dates.start, end: event.dates.end,
      timezone: event.dates.timezone, venue: venue?.id,
      venueLocation: venue?.location, name: event.name,
    });
    sourceRecords.push({ batch_id: input.runId, source_id: SOURCE_ID, schema_version: 1,
      fetched_at: fetchedAt, source_record_id: id, version_id: version,
      original_url: event.url, raw_uri: null, published_at: null, observed_at: null,
      first_accessible_at: null,
      time_missing_reason: 'Discovery API does not provide event publication time',
      valid_from: startAt, valid_to: endAt, source_updated_at: null,
      source_version_ordinal: null,
      record_status: cancelled ? 'cancelled' : 'active', assertion_kind: 'plan',
      rights_status: 'review_required' });
    geoRecords.push({ batch_id: input.runId, source_id: SOURCE_ID, schema_version: 1,
      fetched_at: fetchedAt, geo_record_id: id, version_id: version,
      topic: 'event', assertion_kind: 'plan', title: event.name,
      summary: `Ticketmaster status: ${status}; local start: ${event.dates.start.localDate ?? 'unknown'} ${event.dates.start.localTime ?? ''} ${event.dates.timezone ?? ''}; venue: ${venue?.name ?? 'unknown'}`,
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
      rights_status: 'review_required', public_query_allowed: false });
    geoRecordSources.push({ batch_id: input.runId, source_id: SOURCE_ID,
      schema_version: 1, fetched_at: fetchedAt,
      geo_record_id: id, version_id: version, source_record_id: id,
      source_version_id: version, evidence_role: 'ticketmaster_event',
      original_url: event.url });
  }
  return { sourceRecords, geoRecords, geoRecordSources };
}

function failure(input: ConnectorInput, code: 'rate_limited' | 'upstream_unavailable'
  | 'schema_changed' | 'auth_failed' | 'incomplete_window' | 'validation_failed'): ConnectorResult {
  return { kind: 'failure', sourceId: SOURCE_ID, runId: input.runId,
    checkedAt: new Date().toISOString(), code,
    message: 'Ticketmaster event window could not be validated', retryAfterSeconds: null,
    completeness: { complete: false, expected_records: null, fetched_records: 0,
      expected_pages: null, fetched_pages: 0,
      evidence: 'All pages within the 1000-result API deep-paging limit are required' },
    sourceLatestUpdateAt: null };
}

export class TicketmasterConnector implements Connector {
  readonly sourceId = SOURCE_ID;
  constructor(private readonly client = new HttpClient(),
    private readonly keyProvider: () => string | undefined = () => process.env.TICKETMASTER_DISCOVERY_API_KEY) {}

  async collect(input: ConnectorInput): Promise<ConnectorResult> {
    if (input.sourceId !== SOURCE_ID || input.window.kind !== 'time') {
      return failure(input, 'validation_failed');
    }
    const key = this.keyProvider();
    if (!key) return failure(input, 'auth_failed');
    try {
      const events: TicketEvent[] = [];
      let fetchedAt = new Date().toISOString();
      let total: number | null = null;
      let pages: number | null = null;
      for (let page = 0; ; page += 1) {
        if (page * PAGE_SIZE >= 1000) return failure(input, 'incomplete_window');
        const url = new URL(ENDPOINT);
        url.searchParams.set('apikey', key);
        url.searchParams.set('countryCode', 'AU');
        url.searchParams.set('stateCode', 'VIC');
        url.searchParams.set('geoPoint', geohash(MELBOURNE.lat, MELBOURNE.lon));
        url.searchParams.set('radius', String(SEARCH_RADIUS_KM));
        url.searchParams.set('unit', 'km');
        url.searchParams.set('startDateTime', input.window.from);
        url.searchParams.set('endDateTime', input.window.to);
        url.searchParams.set('size', String(PAGE_SIZE));
        url.searchParams.set('page', String(page));
        const response = await this.client.getJson({ url, timeoutMs: 20000, maxAttempts: 3 });
        const body = parseTicketPage(response.body);
        fetchedAt = response.fetchedAt;
        if (body.page.number !== page || (total !== null && body.page.totalElements !== total)
          || (pages !== null && body.page.totalPages !== pages)) {
          return failure(input, 'incomplete_window');
        }
        total = body.page.totalElements;
        pages = body.page.totalPages;
        if (total > 1000) return failure(input, 'incomplete_window');
        events.push(...(body._embedded?.events ?? []));
        if (page + 1 >= Math.max(1, pages)) break;
      }
      if (events.length !== total) return failure(input, 'incomplete_window');
      const normalized = normalizeTicketEvents(events, input, fetchedAt);
      return { kind: 'success', sourceId: SOURCE_ID, runId: input.runId,
        fetchedAt, sourceRevision: null, sourceLatestUpdateAt: null,
        checkpointAfter: input.window.to,
        completeness: { complete: true, method: 'pagination', expected_records: total,
          fetched_records: events.length, expected_pages: pages,
          fetched_pages: Math.max(1, pages ?? 1),
          evidence: 'Every zero-based page agrees on totalElements and totalPages' },
        inputCount: events.length, outputCount: normalized.sourceRecords.length,
        rejectedCount: 0, ...normalized, boundaries: [], areaIndicators: [],
        parkingBays: [], parkingObservations: [], parkingRules: [], sensorLocations: [],
        pedestrianObservations: [], retainableRawRecords: null };
    } catch (error) {
      const code = error instanceof HttpFailure ? error.code
        : error instanceof z.ZodError ? 'schema_changed' : 'validation_failed';
      return failure(input, code);
    }
  }
}

export const connector: Connector = new TicketmasterConnector();
