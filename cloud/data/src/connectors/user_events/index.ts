import { z } from 'zod';

import type { Connector, ConnectorInput, ConnectorResult } from '../../core/connector.js';
import type { GeoRecord, GeoRecordSource, SourceRecord } from '../../core/types.js';
import { sourceRecordId, sourceVersionId } from '../../validation/record.js';

/**
 * Events users publish in the app (UC-09). The agent service writes them to Firestore
 * (`userEvents/{eventId}`, agent-protocol.md, User events); this connector exports every
 * document changed in the window as one `event` version, so the records reach the map's
 * event layer and the agent's tools like any other source. The owner's uid and the
 * attendees' uids never leave Firestore: only the attendee count is exported.
 */
export const SOURCE_ID = 'user.events';
export const EVIDENCE_ROLE = 'user_event';
export const ATTRIBUTION = 'Published by a Melens user';
export const COLLECTION = 'userEvents';
const TIMEZONE = 'Australia/Melbourne';
/** The map contract's service area, west, south, east, north; a pin outside it is rejected, never published. */
const SERVICE_BBOX = [144, -39, 146.5, -37] as const;

const instant = z.iso.datetime();

/** The document fields the export reads; unknown fields, the owner uid among them, are dropped by the schema. */
export const userEventDocumentSchema = z.object({
  id: z.string().regex(/^ue_[A-Za-z0-9_-]{1,64}$/),
  title: z.string().trim().min(1).max(120),
  description: z.string().max(2000),
  point: z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }),
  placeName: z.string().max(120).nullable(),
  startAt: instant,
  endAt: instant.nullable(),
  timezone: z.literal(TIMEZONE),
  anonymousAttendance: z.boolean(),
  capacity: z.number().int().nullable(),
  status: z.enum(['published', 'cancelled', 'removed']),
  visibility: z.enum(['visible', 'hidden']),
  attendeeUids: z.array(z.string()).default([]),
  createdAt: instant,
  updatedAt: instant,
  version: z.number().int().positive(),
  activeUntil: instant,
}).transform(({ attendeeUids, ...fields }) => ({ ...fields, attendeeCount: attendeeUids.length }));

export type UserEventDocument = z.infer<typeof userEventDocumentSchema>;

/** Reads the documents changed in a half-open window; the production reader queries Firestore. */
export interface UserEventReader {
  listUpdated(window: { readonly from: string; readonly to: string }): Promise<readonly unknown[]>;
}

export function firestoreUserEventReader(options: { readonly projectId: string; readonly databaseId?: string }): UserEventReader {
  let client: Promise<import('@google-cloud/firestore').Firestore> | null = null;
  const load = () => client ??= import('@google-cloud/firestore').then(({ Firestore }) => new Firestore({
    projectId: options.projectId, ...(options.databaseId === undefined ? {} : { databaseId: options.databaseId }) }));
  return {
    async listUpdated(window) {
      const db = await load();
      const snapshot = await db.collection(COLLECTION).where('updatedAt', '>=', window.from).where('updatedAt', '<', window.to)
        .orderBy('updatedAt', 'asc').get();
      return snapshot.docs.map(doc => doc.data());
    },
  };
}

function insideServiceArea(point: { lat: number; lng: number }): boolean {
  return point.lng >= SERVICE_BBOX[0] && point.lat >= SERVICE_BBOX[1] && point.lng <= SERVICE_BBOX[2] && point.lat <= SERVICE_BBOX[3];
}

/** Where the app shows one event; the record's provenance, since Melens itself is the publisher. */
export const DEFAULT_APP_BASE_URL = 'https://melens-510012.web.app';

export function eventUrl(appBaseUrl: string, eventId: string): string {
  return `${appBaseUrl.replace(/\/+$/, '')}/events/${eventId}`;
}

export function normalizeUserEvents(documents: readonly unknown[], input: ConnectorInput, fetchedAt: string,
  options: { readonly appBaseUrl: string } = { appBaseUrl: DEFAULT_APP_BASE_URL }): {
  sourceRecords: SourceRecord[]; geoRecords: GeoRecord[]; geoRecordSources: GeoRecordSource[]; rejected: number;
  latestUpdateAt: string | null;
} {
  const sourceRecords: SourceRecord[] = [];
  const geoRecords: GeoRecord[] = [];
  const geoRecordSources: GeoRecordSource[] = [];
  const seen = new Set<string>();
  let rejected = 0;
  let latestUpdateAt: string | null = null;
  for (const document of documents) {
    const parsed = userEventDocumentSchema.safeParse(document);
    if (!parsed.success || seen.has(parsed.data.id) || !insideServiceArea(parsed.data.point)
      || (parsed.data.endAt !== null && parsed.data.endAt <= parsed.data.startAt)) {
      rejected += 1;
      continue;
    }
    const event = parsed.data;
    seen.add(event.id);
    if (latestUpdateAt === null || event.updatedAt > latestUpdateAt) latestUpdateAt = event.updatedAt;
    // A removed or hidden event withdraws every earlier version; a cancelled one stays visible as cancelled.
    const withdrawn = event.status === 'removed' || event.visibility === 'hidden';
    const sourceStatus = withdrawn ? 'withdrawn' : event.status === 'cancelled' ? 'cancelled' : 'active';
    const geoStatus = withdrawn ? 'withdrawn' : event.status === 'cancelled' ? 'cancelled'
      : event.startAt > fetchedAt ? 'planned' : 'active';
    const id = sourceRecordId({ sourceId: SOURCE_ID, nativeId: event.id, originalUrl: null, sourceTime: null });
    const content = { version: event.version, status: sourceStatus, title: event.title, description: event.description, point: event.point,
      placeName: event.placeName, startAt: event.startAt, endAt: event.endAt, capacity: event.capacity,
      anonymousAttendance: event.anonymousAttendance, attendeeCount: event.attendeeCount };
    const version = sourceVersionId(event.updatedAt, content);
    const url = eventUrl(options.appBaseUrl, event.id);
    sourceRecords.push({ batch_id: input.runId, source_id: SOURCE_ID, schema_version: 1, fetched_at: fetchedAt,
      source_record_id: id, version_id: version, original_url: url, raw_uri: null,
      published_at: event.createdAt, observed_at: null, first_accessible_at: event.createdAt, time_missing_reason: null,
      valid_from: event.startAt, valid_to: event.endAt, source_updated_at: event.updatedAt, source_version_ordinal: event.version,
      record_status: sourceStatus, assertion_kind: 'plan', rights_status: 'restricted' });
    geoRecords.push({ batch_id: input.runId, source_id: SOURCE_ID, schema_version: 1, fetched_at: fetchedAt,
      geo_record_id: id, version_id: version, topic: 'event', assertion_kind: 'plan', title: event.title,
      summary: JSON.stringify({ description: event.description, placeName: event.placeName,
        attendeeCount: event.attendeeCount, anonymousAttendance: event.anonymousAttendance }),
      original_url: url,
      geometry_geojson: JSON.stringify({ type: 'Point', coordinates: [event.point.lng, event.point.lat] }),
      centroid_lon: event.point.lng, centroid_lat: event.point.lat,
      // The publisher placed the pin: the coordinate comes from the source itself.
      location_role: 'event_site', location_confidence: 'source_coordinate', area_refs: [],
      published_at: event.createdAt, observed_at: null, valid_from: event.startAt, valid_to: event.endAt,
      source_updated_at: event.updatedAt, source_version_ordinal: event.version, freshness_state: 'current',
      record_status: geoStatus, rights_status: 'restricted', public_query_allowed: true });
    geoRecordSources.push({ batch_id: input.runId, source_id: SOURCE_ID, schema_version: 1, fetched_at: fetchedAt,
      geo_record_id: id, version_id: version, source_record_id: id, source_version_id: version,
      evidence_role: EVIDENCE_ROLE, original_url: url });
  }
  return { sourceRecords, geoRecords, geoRecordSources, rejected, latestUpdateAt };
}

export function failure(input: ConnectorInput, code: 'upstream_unavailable' | 'auth_failed' | 'validation_failed',
  message: string): ConnectorResult {
  return { kind: 'failure', sourceId: SOURCE_ID, runId: input.runId, checkedAt: new Date().toISOString(), code, message,
    retryAfterSeconds: null,
    completeness: { complete: false, expected_records: null, fetched_records: 0, expected_pages: null, fetched_pages: 0,
      evidence: 'Every document changed in the window is required' },
    sourceLatestUpdateAt: null };
}

export class UserEventsConnector implements Connector {
  readonly sourceId = SOURCE_ID;
  constructor(private readonly reader: () => UserEventReader | null = () => {
    const projectId = process.env.GOOGLE_CLOUD_PROJECT;
    return projectId === undefined || projectId === '' ? null
      : firestoreUserEventReader({ projectId, ...(process.env.MELENS_USER_EVENTS_DATABASE === undefined ? {} : { databaseId: process.env.MELENS_USER_EVENTS_DATABASE }) });
  }, private readonly now: () => string = () => new Date().toISOString(),
  private readonly appBaseUrl: string = process.env.MELENS_APP_BASE_URL ?? DEFAULT_APP_BASE_URL) {}

  async collect(input: ConnectorInput): Promise<ConnectorResult> {
    if (input.sourceId !== SOURCE_ID) return failure(input, 'validation_failed', 'Wrong source for the user events connector');
    if (input.window.kind !== 'time') return failure(input, 'validation_failed', 'User events are exported by time window, not snapshot');
    const reader = this.reader();
    if (reader === null) return failure(input, 'auth_failed', 'GOOGLE_CLOUD_PROJECT names the Firestore project to read');
    let documents: readonly unknown[];
    try {
      documents = await reader.listUpdated(input.window);
    } catch {
      return failure(input, 'upstream_unavailable', 'Firestore did not answer the user events query');
    }
    const fetchedAt = this.now();
    const normalized = normalizeUserEvents(documents, input, fetchedAt, { appBaseUrl: this.appBaseUrl });
    return { kind: 'success', sourceId: SOURCE_ID, runId: input.runId, fetchedAt,
      sourceRevision: sourceVersionId(null, { window: input.window,
        versions: normalized.sourceRecords.map(row => [row.source_record_id, row.version_id]) }),
      sourceLatestUpdateAt: normalized.latestUpdateAt,
      checkpointAfter: input.window.to,
      completeness: { complete: true, method: 'export_count', expected_records: documents.length,
        fetched_records: documents.length, expected_pages: 1, fetched_pages: 1,
        evidence: 'One Firestore query returns every document whose updatedAt lies in the half-open window' },
      inputCount: documents.length, outputCount: normalized.sourceRecords.length, rejectedCount: normalized.rejected,
      sourceRecords: normalized.sourceRecords, geoRecords: normalized.geoRecords, geoRecordSources: normalized.geoRecordSources,
      boundaries: [], areaIndicators: [], parkingBays: [], parkingObservations: [], parkingRules: [], sensorLocations: [],
      pedestrianObservations: [], retainableRawRecords: null };
  }
}

export const connector: Connector = new UserEventsConnector();
