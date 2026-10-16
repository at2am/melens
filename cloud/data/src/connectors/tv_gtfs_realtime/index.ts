import type { Connector, ConnectorFailure, ConnectorInput, ConnectorResult } from '../../core/connector.js';
import { HttpClient, HttpFailure } from '../../core/http.js';
import type { GeoRecord, GeoRecordSource, SourceRecord } from '../../core/types.js';
import { sourceRecordId, sourceVersionId } from '../../validation/record.js';

export const SOURCE_ID = 'victoria.transport.gtfs_realtime';
export const LANDING_URL = 'https://opendata.transport.vic.gov.au/dataset/gtfs-realtime';
export const BASE_URL = 'https://api.opendata.transport.vic.gov.au/opendata/public-transport/gtfs/realtime/v1/';
export const MAX_FEED_BYTES = 8_000_000;
export const MAX_ENTITIES = 20_000;

export type AlertMode = 'metro_train' | 'yarra_tram';
export const FEEDS: readonly { mode: AlertMode; path: string; resourceUrl: string }[] = [
  { mode: 'metro_train', path: 'metro/service-alerts',
    resourceUrl: `${LANDING_URL}/resource/2a90e184-ac14-468a-92ff-9618cb43fb77` },
  { mode: 'yarra_tram', path: 'tram/service-alerts',
    resourceUrl: `${LANDING_URL}/resource/c1affc17-233b-4124-9e43-457267595d65` },
];

export interface AlertPeriod { start: string | null; end: string | null }
export interface AlertSelector {
  agencyId: string | null;
  routeId: string | null;
  routeType: number | null;
  stopId: string | null;
  directionId: number | null;
  tripId: string | null;
  tripRouteId: string | null;
  tripStartDate: string | null;
  tripStartTime: string | null;
}
export interface ParsedAlert {
  id: string;
  activePeriods: readonly AlertPeriod[];
  communicationPeriods: readonly AlertPeriod[];
  impactPeriods: readonly AlertPeriod[];
  selectors: readonly AlertSelector[];
  cause: number | null;
  effect: number | null;
  header: string | null;
  description: string | null;
  url: string | null;
}
export interface ParsedAlertFeed {
  gtfsRealtimeVersion: string;
  feedTimestamp: string | null;
  feedVersion: string | null;
  alerts: readonly ParsedAlert[];
}

/** Bounded decoder for the GTFS-Realtime fields used by the two Service Alerts feeds. */
export class WireReader {
  private position = 0;
  constructor(private readonly bytes: Uint8Array) {}

  get done(): boolean { return this.position === this.bytes.length; }

  varint(): bigint {
    let value = 0n;
    for (let index = 0; index < 10; index += 1) {
      const octet = this.bytes[this.position++];
      if (octet === undefined) throw new Error('Truncated protobuf varint');
      if (index === 9 && octet > 1) throw new Error('Protobuf varint exceeds uint64');
      value |= BigInt(octet & 0x7f) << BigInt(index * 7);
      if ((octet & 0x80) === 0) return value;
    }
    throw new Error('Protobuf varint exceeds 10 bytes');
  }

  bytesField(): Uint8Array {
    const length = this.varint();
    if (length > BigInt(this.bytes.length - this.position)) {
      throw new Error('Truncated protobuf length-delimited field');
    }
    const end = this.position + Number(length);
    const value = this.bytes.subarray(this.position, end);
    this.position = end;
    return value;
  }

  fields(handle: (field: number, wire: number, reader: WireReader) => void): void {
    while (!this.done) {
      const tag = this.varint();
      const field = Number(tag >> 3n);
      const wire = Number(tag & 7n);
      if (field < 1 || !Number.isSafeInteger(field)) throw new Error('Invalid protobuf field number');
      const before = this.position;
      handle(field, wire, this);
      if (this.position === before) this.skip(wire);
    }
  }

  skip(wire: number): void {
    if (wire === 0) { this.varint(); return; }
    if (wire === 2) { this.bytesField(); return; }
    const length = wire === 1 ? 8 : wire === 5 ? 4 : null;
    if (length === null || this.position + length > this.bytes.length) {
      throw new Error('Invalid protobuf wire field');
    }
    this.position += length;
  }
}

function nested(reader: WireReader, wire: number): WireReader {
  if (wire !== 2) throw new Error('Expected protobuf message');
  return new WireReader(reader.bytesField());
}
function text(reader: WireReader, wire: number): string {
  if (wire !== 2) throw new Error('Expected protobuf string');
  return new TextDecoder('utf-8', { fatal: true }).decode(reader.bytesField());
}
function integer(reader: WireReader, wire: number): number {
  if (wire !== 0) throw new Error('Expected protobuf integer');
  const number = reader.varint();
  if (number > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Protobuf integer is too large');
  return Number(number);
}
function timestamp(reader: WireReader, wire: number): string {
  const seconds = integer(reader, wire);
  const millis = seconds * 1000;
  if (!Number.isSafeInteger(millis)) throw new Error('Invalid GTFS timestamp');
  const date = new Date(millis);
  if (Number.isNaN(date.valueOf())) throw new Error('Invalid GTFS timestamp');
  return date.toISOString();
}
export function parsePeriod(reader: WireReader): AlertPeriod {
  let start: string | null = null;
  let end: string | null = null;
  reader.fields((field, wire, value) => {
    if (field === 1) start = timestamp(value, wire);
    if (field === 2) end = timestamp(value, wire);
  });
  if (start === null && end === null) throw new Error('Empty GTFS alert period');
  if (start !== null && end !== null && start >= end) throw new Error('Invalid GTFS alert period');
  return { start, end };
}
function parseTrip(reader: WireReader): Pick<AlertSelector,
  'tripId' | 'tripRouteId' | 'tripStartDate' | 'tripStartTime'> {
  let tripId: string | null = null;
  let tripRouteId: string | null = null;
  let tripStartDate: string | null = null;
  let tripStartTime: string | null = null;
  reader.fields((field, wire, value) => {
    if (field === 1) tripId = text(value, wire);
    if (field === 2) tripStartTime = text(value, wire);
    if (field === 3) tripStartDate = text(value, wire);
    if (field === 5) tripRouteId = text(value, wire);
  });
  return { tripId, tripRouteId, tripStartDate, tripStartTime };
}
export function parseSelector(reader: WireReader): AlertSelector {
  let agencyId: string | null = null;
  let routeId: string | null = null;
  let routeType: number | null = null;
  let stopId: string | null = null;
  let directionId: number | null = null;
  let trip: Pick<AlertSelector,
    'tripId' | 'tripRouteId' | 'tripStartDate' | 'tripStartTime'> = {
      tripId: null, tripRouteId: null, tripStartDate: null, tripStartTime: null,
    };
  reader.fields((field, wire, value) => {
    if (field === 1) agencyId = text(value, wire);
    if (field === 2) routeId = text(value, wire);
    if (field === 3) routeType = integer(value, wire);
    if (field === 4) trip = parseTrip(nested(value, wire));
    if (field === 5) stopId = text(value, wire);
    if (field === 6) directionId = integer(value, wire);
  });
  if (directionId !== null && routeId === null) {
    throw new Error('GTFS direction selector has no route');
  }
  if (agencyId === null && routeId === null && routeType === null && stopId === null
    && trip.tripId === null && trip.tripRouteId === null) {
    throw new Error('Empty GTFS informed entity selector');
  }
  return { agencyId, routeId, routeType, stopId, directionId, ...trip };
}
function translated(reader: WireReader): string | null {
  const translations: { language: string | null; value: string }[] = [];
  reader.fields((field, wire, value) => {
    if (field !== 1) return;
    let content: string | null = null;
    let language: string | null = null;
    nested(value, wire).fields((translationField, translationWire, translation) => {
      if (translationField === 1) content = text(translation, translationWire);
      if (translationField === 2) language = text(translation, translationWire);
    });
    if (content !== null) translations.push({ language, value: content });
  });
  return translations.find(entry => entry.language?.toLowerCase().startsWith('en'))?.value
    ?? translations[0]?.value ?? null;
}
export function parseAlert(reader: WireReader, id: string): ParsedAlert {
  const activePeriods: AlertPeriod[] = [];
  const communicationPeriods: AlertPeriod[] = [];
  const impactPeriods: AlertPeriod[] = [];
  const selectors: AlertSelector[] = [];
  let cause: number | null = null;
  let effect: number | null = null;
  let header: string | null = null;
  let description: string | null = null;
  let url: string | null = null;
  reader.fields((field, wire, value) => {
    if (field === 1) activePeriods.push(parsePeriod(nested(value, wire)));
    if (field === 2) communicationPeriods.push(parsePeriod(nested(value, wire)));
    if (field === 3) impactPeriods.push(parsePeriod(nested(value, wire)));
    if (field === 5) selectors.push(parseSelector(nested(value, wire)));
    if (field === 6) cause = integer(value, wire);
    if (field === 7) effect = integer(value, wire);
    if (field === 8) url = translated(nested(value, wire));
    if (field === 10) header = translated(nested(value, wire));
    if (field === 11) description = translated(nested(value, wire));
  });
  if (selectors.length === 0) throw new Error('GTFS alert has no informed entity');
  return { id, activePeriods, communicationPeriods, impactPeriods, selectors,
    cause, effect, header, description, url };
}

export function parseAlertFeed(bytes: Uint8Array): ParsedAlertFeed {
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_FEED_BYTES) {
    throw new Error('GTFS alert feed size is invalid');
  }
  let gtfsRealtimeVersion: string | null = null;
  let feedTimestamp: string | null = null;
  let feedVersion: string | null = null;
  let incrementality = 0;
  let headerCount = 0;
  const alerts: ParsedAlert[] = [];
  const ids = new Set<string>();
  new WireReader(bytes).fields((field, wire, reader) => {
    if (field === 1) {
      headerCount += 1;
      nested(reader, wire).fields((part, partWire, header) => {
        if (part === 1) gtfsRealtimeVersion = text(header, partWire);
        if (part === 2) incrementality = integer(header, partWire);
        if (part === 3) feedTimestamp = timestamp(header, partWire);
        if (part === 4) feedVersion = text(header, partWire);
      });
    }
    if (field === 2) {
      if (ids.size >= MAX_ENTITIES) throw new Error('GTFS alert feed exceeds entity limit');
      const entityState: { id: string | null; deleted: boolean;
        alertBytes: Uint8Array | null } = { id: null, deleted: false, alertBytes: null };
      nested(reader, wire).fields((part, partWire, entity) => {
        if (part === 1) entityState.id = text(entity, partWire);
        if (part === 2) entityState.deleted = integer(entity, partWire) !== 0;
        if (part === 5) {
          if (partWire !== 2) throw new Error('Expected GTFS alert message');
          entityState.alertBytes = entity.bytesField();
        }
      });
      const { id, deleted, alertBytes } = entityState;
      const entityId: string | null = id;
      if (entityId === null || entityId.length === 0 || ids.has(entityId)) throw new Error('Invalid or duplicate GTFS entity ID');
      ids.add(entityId);
      // A FULL_DATASET feed contains current alerts. Removal means disappearance from
      // a later complete snapshot, not a NO_SERVICE effect or a fabricated tombstone.
      if (deleted) throw new Error('GTFS full snapshot unexpectedly contains is_deleted');
      if (alertBytes === null) throw new Error('Non-alert entity in Service Alerts feed');
      alerts.push(parseAlert(new WireReader(alertBytes), entityId));
    }
  });
  if (headerCount !== 1 || !gtfsRealtimeVersion || incrementality !== 0) {
    throw new Error('GTFS alert feed requires one FULL_DATASET header');
  }
  return { gtfsRealtimeVersion, feedTimestamp, feedVersion, alerts };
}

function failure(input: ConnectorInput, code: ConnectorFailure['code'], fetchedFeeds: number,
  retryAfterSeconds: number | null = null): ConnectorFailure {
  return { kind: 'failure', sourceId: SOURCE_ID, runId: input.runId,
    checkedAt: new Date().toISOString(), code,
    message: 'GTFS Service Alerts snapshot could not be completely validated',
    retryAfterSeconds, completeness: { complete: false, expected_records: null,
      fetched_records: 0, expected_pages: FEEDS.length, fetched_pages: fetchedFeeds,
      evidence: 'Metro Train and Yarra Trams must both be complete FULL_DATASET protobuf feeds' },
    sourceLatestUpdateAt: null };
}

export function singlePeriod(alert: ParsedAlert): AlertPeriod | null {
  // active_period is the display window. It cannot substitute for a service
  // impact interval when deriving the fact's valid time.
  const period = alert.impactPeriods.length === 1 ? alert.impactPeriods[0] ?? null : null;
  // The map contract has no empty interval: an end at the start instant is an unknown end.
  return period && period.start !== null && period.end !== null && period.end <= period.start
    ? { ...period, end: null } : period;
}

export function deriveAlertFeedsRevision(feeds: readonly {
  mode: AlertMode; parsed: ParsedAlertFeed;
}[], latestUpdate: string | null): string | null {
  if (feeds.length === 0) return null;
  const canonicalModes = feeds.slice().sort((a, b) => a.mode.localeCompare(b.mode)).map(feed => ({
    mode: feed.mode,
    feedTimestamp: feed.parsed.feedTimestamp,
    feedVersion: feed.parsed.feedVersion,
    alerts: [...feed.parsed.alerts].sort((a, b) => a.id.localeCompare(b.id)),
  }));
  return sourceVersionId(latestUpdate, canonicalModes);
}

export function normalizeAlertFeeds(feeds: readonly {
  mode: AlertMode; resourceUrl: string; parsed: ParsedAlertFeed; fetchedAt: string;
}[], input: ConnectorInput): {
  sourceRecords: SourceRecord[]; geoRecords: GeoRecord[]; geoRecordSources: GeoRecordSource[];
  latestUpdate: string | null;
  sourceRevision: string | null;
} {
  const sourceRecords: SourceRecord[] = [];
  const geoRecords: GeoRecord[] = [];
  const geoRecordSources: GeoRecordSource[] = [];
  let latestUpdate: string | null = null;
  for (const feed of feeds) {
    const update = feed.parsed.feedTimestamp;
    if (update !== null && (latestUpdate === null || update > latestUpdate)) latestUpdate = update;
    const parentId = sourceRecordId({ sourceId: SOURCE_ID,
      nativeId: `feed:${feed.mode}:${update ?? feed.fetchedAt}`,
      originalUrl: feed.resourceUrl, sourceTime: null });
    const parentVersion = sourceVersionId(update, {
      mode: feed.mode, feedVersion: feed.parsed.feedVersion,
      alerts: [...feed.parsed.alerts].sort((a, b) => a.id.localeCompare(b.id)) });
    sourceRecords.push({ batch_id: input.runId, source_id: SOURCE_ID, schema_version: 1,
      fetched_at: feed.fetchedAt, source_record_id: parentId, version_id: parentVersion,
      original_url: feed.resourceUrl, raw_uri: null, published_at: null,
      observed_at: null, first_accessible_at: null,
      time_missing_reason: 'Feed timestamp is publication time, not an event occurrence time',
      valid_from: null, valid_to: null, source_updated_at: update,
      source_version_ordinal: null, record_status: 'active', assertion_kind: 'report',
      rights_status: 'verified_open' });
    for (const alert of feed.parsed.alerts) {
      const alertId = sourceRecordId({ sourceId: SOURCE_ID,
        nativeId: `alert:${feed.mode}:${alert.id}`, originalUrl: feed.resourceUrl,
        sourceTime: null });
      const version = sourceVersionId(update, {
        mode: feed.mode, feedVersion: feed.parsed.feedVersion, alert });
      const period = singlePeriod(alert);
      const provenance = { batch_id: input.runId, source_id: SOURCE_ID,
        schema_version: 1, fetched_at: feed.fetchedAt };
      sourceRecords.push({ ...provenance, source_record_id: alertId,
        version_id: version, original_url: feed.resourceUrl, raw_uri: null,
        published_at: null, observed_at: null, first_accessible_at: null,
        time_missing_reason: 'Service alert has no event occurrence timestamp',
        valid_from: period?.start ?? null, valid_to: period?.end ?? null,
        source_updated_at: update, source_version_ordinal: null,
        record_status: 'active', assertion_kind: 'report',
        rights_status: 'verified_open' });
      geoRecords.push({ ...provenance, geo_record_id: alertId, version_id: version,
        topic: 'transport', assertion_kind: 'report', title: alert.header,
        summary: JSON.stringify({ mode: feed.mode, feed_timestamp: update,
          feed_version: feed.parsed.feedVersion, alert_id: alert.id,
          cause: alert.cause, effect: alert.effect, selectors: alert.selectors,
          active_periods: alert.activePeriods,
          communication_periods: alert.communicationPeriods,
          impact_periods: alert.impactPeriods,
          description: alert.description, url: alert.url }),
        original_url: alert.url?.startsWith('https://') ? alert.url : feed.resourceUrl,
        geometry_geojson: null, centroid_lon: null, centroid_lat: null,
        location_role: 'unknown', location_confidence: 'unverified', area_refs: [],
        published_at: null, observed_at: null, valid_from: period?.start ?? null,
        valid_to: period?.end ?? null, source_updated_at: update,
        source_version_ordinal: null, freshness_state: 'unknown',
        record_status: 'active', rights_status: 'verified_open',
        public_query_allowed: true });
      for (const link of [
        { source_record_id: parentId, source_version_id: parentVersion,
          evidence_role: 'parent_feed_snapshot' },
        { source_record_id: alertId, source_version_id: version,
          evidence_role: 'alert_entity' },
      ]) geoRecordSources.push({ ...provenance, geo_record_id: alertId,
        version_id: version, ...link, original_url: feed.resourceUrl });
    }
  }
  const sourceRevision = deriveAlertFeedsRevision(feeds, latestUpdate);
  return { sourceRecords, geoRecords, geoRecordSources, latestUpdate, sourceRevision };
}

export interface TransportGtfsRealtimeConnectorOptions {
  client?: HttpClient;
  keyProvider?: () => string | undefined;
}

export class TransportGtfsRealtimeConnector implements Connector {
  readonly sourceId = SOURCE_ID;
  private readonly client: HttpClient;
  private readonly keyProvider: () => string | undefined;

  constructor(
    clientOrOptions: HttpClient | TransportGtfsRealtimeConnectorOptions = new HttpClient(),
    keyProvider: () => string | undefined = () => process.env.TRANSPORT_VICTORIA_KEY_ID,
  ) {
    if (clientOrOptions instanceof HttpClient) {
      this.client = clientOrOptions;
      this.keyProvider = keyProvider;
    } else {
      this.client = clientOrOptions.client ?? new HttpClient();
      this.keyProvider = clientOrOptions.keyProvider ?? keyProvider;
    }
  }

  async collect(input: ConnectorInput): Promise<ConnectorResult> {
    if (input.sourceId !== SOURCE_ID) return failure(input, 'validation_failed', 0);
    const key = this.keyProvider();
    if (!key) return failure(input, 'auth_failed', 0);
    const feeds: { mode: AlertMode; resourceUrl: string; parsed: ParsedAlertFeed;
      fetchedAt: string }[] = [];
    for (const feed of FEEDS) {
      try {
        const response = await this.client.getBytes({
          url: new URL(feed.path, BASE_URL), headers: { KeyID: key },
          timeoutMs: 20_000, maxAttempts: 3,
        });
        feeds.push({ mode: feed.mode, resourceUrl: feed.resourceUrl,
          parsed: parseAlertFeed(response.body), fetchedAt: response.fetchedAt });
      } catch (error) {
        const code = error instanceof HttpFailure ? error.code : 'schema_changed';
        const retryAfterSeconds = error instanceof HttpFailure && error.retryAfterMs !== null
          ? Math.ceil(error.retryAfterMs / 1000) : null;
        return failure(input, code, feeds.length, retryAfterSeconds);
      }
    }
    const normalized = normalizeAlertFeeds(feeds, input);
    const alertCount = feeds.reduce((sum, feed) => sum + feed.parsed.alerts.length, 0);
    return { kind: 'success', sourceId: SOURCE_ID, runId: input.runId,
      fetchedAt: feeds.at(-1)?.fetchedAt ?? new Date().toISOString(),
      sourceRevision: normalized.sourceRevision,
      sourceLatestUpdateAt: normalized.latestUpdate,
      checkpointAfter: input.window.kind === 'time' ? input.window.to : input.window.revision,
      completeness: { complete: true, method: 'feed_snapshot',
        expected_records: alertCount, fetched_records: alertCount,
        expected_pages: FEEDS.length, fetched_pages: feeds.length,
        evidence: 'Both advertised Metro Train and Yarra Trams FULL_DATASET alert feeds parsed; no Bus Service Alerts feed is advertised' },
      inputCount: alertCount, outputCount: normalized.sourceRecords.length,
      rejectedCount: 0, sourceRecords: normalized.sourceRecords,
      geoRecords: normalized.geoRecords,
      geoRecordSources: normalized.geoRecordSources,
      boundaries: [], areaIndicators: [], parkingBays: [], parkingObservations: [],
      parkingRules: [], sensorLocations: [], pedestrianObservations: [],
      retainableRawRecords: null };
  }
}

export const connector: Connector = new TransportGtfsRealtimeConnector();
export default connector;
