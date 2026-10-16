import { strFromU8, unzipSync } from 'fflate';
import { z } from 'zod';

import { fetchOfficialGtfsArchive, type OfficialGtfsArchive } from './archive.js';
import { HttpFailure } from '../../core/http.js';
import type { Connector, ConnectorCompleteness, ConnectorErrorCode, ConnectorInput, ConnectorResult } from '../../core/connector.js';
import type { GeoRecord, GeoRecordSource, SourceRecord } from '../../core/types.js';
import { parseGeometryGeojson, type ValidGeometry } from '../../validation/geography.js';
import { sourceRecordId, sourceVersionId } from '../../validation/record.js';

export const SOURCE_ID = 'victoria.transport.gtfs_static';
export const LANDING_URL = 'https://opendata.transport.vic.gov.au/dataset/gtfs-schedule';

export type GtfsTransportMode =
  | 'tram'
  | 'metro'
  | 'train'
  | 'bus'
  | 'ferry'
  | 'cable_tram'
  | 'gondola'
  | 'funicular'
  | 'other';

/**
 * Maps GTFS route_type integer to canonical transport mode string.
 * Reference: GTFS specification & Victorian Public Transport modes:
 *  0 - Tram, Streetcar, Light rail
 *  1 - Subway, Metro
 *  2 - Rail (Regional / Metro train)
 *  3 - Bus
 *  4 - Ferry
 *  5 - Cable tram
 *  6 - Aerial lift / Gondola
 *  7 - Funicular
 */
export function gtfsRouteTypeToMode(routeType: number): GtfsTransportMode {
  switch (routeType) {
    case 0:
      return 'tram';
    case 1:
      return 'metro';
    case 2:
    case 400:
      return 'train';
    case 3:
    case 700:
      return 'bus';
    case 4:
    case 1000:
      return 'ferry';
    case 5:
      return 'cable_tram';
    case 6:
      return 'gondola';
    case 7:
      return 'funicular';
    default:
      return 'other';
  }
}

export const feedInfoSchema = z.object({
  feed_publisher_name: z.string().trim().min(1).nullish(),
  feed_publisher_url: z.string().nullish(),
  feed_lang: z.string().nullish(),
  feed_version: z.string().trim().min(1).nullish(),
  feed_start_date: z.string().regex(/^\d{8}$/).nullish(),
  feed_end_date: z.string().regex(/^\d{8}$/).nullish(),
}).passthrough();

export const routeSchema = z.object({
  route_id: z.string().trim().min(1),
  agency_id: z.string().nullish(),
  route_short_name: z.string().nullish(),
  route_long_name: z.string().nullish(),
  route_type: z.coerce.number().int(),
  route_color: z.string().nullish(),
  route_text_color: z.string().nullish(),
}).passthrough();

export const stopSchema = z.object({
  stop_id: z.string().trim().min(1),
  stop_name: z.string().trim().min(1),
  stop_lat: z.coerce.number().min(-90).max(90),
  stop_lon: z.coerce.number().min(-180).max(180),
  location_type: z.coerce.number().int().nullish(),
  parent_station: z.string().nullish(),
  wheelchair_boarding: z.coerce.number().int().nullish(),
}).passthrough();

export const tripSchema = z.object({
  route_id: z.string().trim().min(1),
  service_id: z.string().nullish(),
  trip_id: z.string().trim().min(1),
  trip_headsign: z.string().nullish(),
  direction_id: z.coerce.number().int().nullish(),
}).passthrough();

export const stopTimeSchema = z.object({
  trip_id: z.string().trim().min(1),
  arrival_time: z.string().nullish(),
  departure_time: z.string().nullish(),
  stop_id: z.string().trim().min(1),
  stop_sequence: z.coerce.number().int().nullish(),
}).passthrough();

export const gtfsSnapshotSchema = z.object({
  feed_info: z.array(feedInfoSchema).default([]),
  routes: z.array(routeSchema),
  stops: z.array(stopSchema),
  trips: z.array(tripSchema).default([]),
  stop_times: z.array(stopTimeSchema).default([]),
}).passthrough();

export type GtfsFeedInfo = z.infer<typeof feedInfoSchema>;
export type GtfsRoute = z.infer<typeof routeSchema>;
export type GtfsStop = z.infer<typeof stopSchema>;
export type GtfsTrip = z.infer<typeof tripSchema>;
export type GtfsStopTime = z.infer<typeof stopTimeSchema>;
export type GtfsStaticSnapshot = z.infer<typeof gtfsSnapshotSchema>;

export interface StopWithAssociations extends GtfsStop {
  modes: readonly GtfsTransportMode[];
  route_ids: readonly string[];
}

export interface NormalizedGtfsResult {
  sourceRecords: SourceRecord[];
  geoRecords: GeoRecord[];
  geoRecordSources: GeoRecordSource[];
  feedVersion: string;
  validFrom: string | null;
  validTo: string | null;
  routes: readonly GtfsRoute[];
  stops: readonly StopWithAssociations[];
  sourceUpdatedAt: string | null;
  tripStopMembershipComplete: boolean;
}

function parseGtfsDate(dateStr: string | null | undefined, isEndOfDay = false): string | null {
  if (!dateStr || !/^\d{8}$/.test(dateStr)) return null;
  const year = dateStr.slice(0, 4);
  const month = dateStr.slice(4, 6);
  const day = dateStr.slice(6, 8);
  const time = isEndOfDay ? 'T23:59:59.000Z' : 'T00:00:00.000Z';
  const iso = `${year}-${month}-${day}${time}`;
  return Number.isNaN(Date.parse(iso)) ? null : iso;
}

export function parseGtfsSnapshot(raw: unknown): GtfsStaticSnapshot {
  return gtfsSnapshotSchema.parse(raw);
}

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      values.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  values.push(current.trim());
  return values;
}

export function parseCsvText<T = Record<string, string>>(csvText: string): T[] {
  const lines = csvText.split(/\r?\n/).filter(line => line.trim().length > 0);
  if (lines.length < 2) return [];
  const headerLine = lines[0];
  if (!headerLine) return [];
  const headers = parseCsvLine(headerLine);
  const rows: T[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const values = parseCsvLine(line);
    const obj: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      const header = headers[j];
      if (header) {
        obj[header] = values[j] ?? '';
      }
    }
    rows.push(obj as unknown as T);
  }
  return rows;
}

/**
 * Extracts and parses a GTFS zip archive into a structured GTFS snapshot.
 */
export function parseGtfsZip(zipBytes: Uint8Array): GtfsStaticSnapshot {
  const unzipped = unzipSync(zipBytes);
  const fileContents = new Map<string, string>();
  for (const [filepath, bytes] of Object.entries(unzipped)) {
    const filename = filepath.split('/').pop();
    if (filename && filename.endsWith('.txt')) {
      if (fileContents.has(filename)) throw new Error(`Duplicate GTFS table: ${filename}`);
      fileContents.set(filename, strFromU8(bytes));
    }
  }

  const feedInfoText = fileContents.get('feed_info.txt');
  const routesText = fileContents.get('routes.txt');
  const stopsText = fileContents.get('stops.txt');
  const tripsText = fileContents.get('trips.txt');
  const stopTimesText = fileContents.get('stop_times.txt');

  if (!routesText || !stopsText) {
    throw new Error('GTFS archive must contain routes.txt and stops.txt');
  }

  const feedInfoRows = feedInfoText ? parseCsvText<Record<string, string>>(feedInfoText) : [];
  const routeRows = parseCsvText<Record<string, string>>(routesText);
  const stopRows = parseCsvText<Record<string, string>>(stopsText);
  const tripRows = tripsText ? parseCsvText<Record<string, string>>(tripsText) : [];
  const stopTimeRows = stopTimesText ? parseCsvText<Record<string, string>>(stopTimesText) : [];

  return parseGtfsSnapshot({
    feed_info: feedInfoRows,
    routes: routeRows,
    stops: stopRows,
    trips: tripRows,
    stop_times: stopTimeRows,
  });
}

function failure(input: ConnectorInput, code: ConnectorErrorCode, message: string, evidence: string): ConnectorResult {
  return {
    kind: 'failure',
    sourceId: SOURCE_ID,
    runId: input.runId,
    checkedAt: new Date().toISOString(),
    code,
    message,
    retryAfterSeconds: null,
    sourceLatestUpdateAt: null,
    completeness: {
      complete: false,
      expected_records: null,
      fetched_records: 0,
      expected_pages: null,
      fetched_pages: 0,
      evidence,
    },
  };
}

export function normalizeGtfsSnapshot(
  snapshot: GtfsStaticSnapshot,
  input: ConnectorInput,
  fetchedAt: string,
  options?: { feedVersion?: string; sourceUpdatedAt?: string | null; tripStopMembershipComplete?: boolean },
): NormalizedGtfsResult {
  const routesById = new Map<string, GtfsRoute>();
  for (const route of snapshot.routes) {
    if (routesById.has(route.route_id)) {
      throw new Error(`Duplicate route_id: ${route.route_id}`);
    }
    routesById.set(route.route_id, route);
  }

  const stopsById = new Map<string, GtfsStop>();
  for (const stop of snapshot.stops) {
    if (stopsById.has(stop.stop_id)) {
      throw new Error(`Duplicate stop_id: ${stop.stop_id}`);
    }
    stopsById.set(stop.stop_id, stop);
  }

  // Map trip_id to route_id
  const tripToRouteId = new Map<string, string>();
  for (const trip of snapshot.trips) {
    if (!routesById.has(trip.route_id)) {
      throw new Error(`Trip ${trip.trip_id} references unknown route ${trip.route_id}`);
    }
    if (tripToRouteId.has(trip.trip_id)) {
      throw new Error(`Duplicate trip_id: ${trip.trip_id}`);
    }
    tripToRouteId.set(trip.trip_id, trip.route_id);
  }

  // Map stop_id to set of serving route_ids
  const stopToRouteIds = new Map<string, Set<string>>();
  for (const stopTime of snapshot.stop_times) {
    if (!stopsById.has(stopTime.stop_id)) {
      throw new Error(`StopTime references unknown stop ${stopTime.stop_id}`);
    }
    const routeId = tripToRouteId.get(stopTime.trip_id);
    if (routeId === undefined) throw new Error(`StopTime references unknown trip ${stopTime.trip_id}`);
    let set = stopToRouteIds.get(stopTime.stop_id);
    if (!set) {
      set = new Set<string>();
      stopToRouteIds.set(stopTime.stop_id, set);
    }
    set.add(routeId);
  }

  const primaryFeedInfo = snapshot.feed_info[0];
  const feedVersion = options?.feedVersion ?? (primaryFeedInfo?.feed_version?.trim()
    || (input.window.kind === 'snapshot' ? input.window.revision : 'snapshot'));
  const validFrom = parseGtfsDate(primaryFeedInfo?.feed_start_date, false);
  const validTo = parseGtfsDate(primaryFeedInfo?.feed_end_date, true);
  const sourceUpdatedAt = options?.sourceUpdatedAt === undefined ? validFrom : options.sourceUpdatedAt;

  const sourceRecords: SourceRecord[] = [];
  const geoRecords: GeoRecord[] = [];
  const geoRecordSources: GeoRecordSource[] = [];
  const enrichedStops: StopWithAssociations[] = [];

  // 1. Feed Version Record
  const versionRecordId = sourceRecordId({
    sourceId: SOURCE_ID,
    nativeId: `feed_version:${feedVersion}`,
    originalUrl: LANDING_URL,
    sourceTime: validFrom ?? fetchedAt,
  });
  const versionContent = { feedVersion, validFrom, validTo, feedInfo: primaryFeedInfo ?? null };
  const versionHash = sourceVersionId(sourceUpdatedAt, versionContent);

  sourceRecords.push({
    batch_id: input.runId,
    source_id: SOURCE_ID,
    schema_version: 1,
    fetched_at: fetchedAt,
    source_record_id: versionRecordId,
    version_id: versionHash,
    original_url: LANDING_URL,
    raw_uri: null,
    published_at: null,
    observed_at: null,
    first_accessible_at: null,
    time_missing_reason: validFrom === null
      ? 'Feed info does not specify calendar start date'
      : 'Static GTFS schedule version is bounded by timetable calendar validity window',
    valid_from: validFrom,
    valid_to: validTo,
    source_updated_at: sourceUpdatedAt,
    source_version_ordinal: null,
    record_status: 'active',
    assertion_kind: 'report',
    rights_status: 'review_required',
  });

  // 2. Routes
  const routeRecordMap = new Map<string, { recordId: string; versionId: string }>();
  for (const route of snapshot.routes) {
    const routeRecordId = sourceRecordId({
      sourceId: SOURCE_ID,
      nativeId: `route:${route.route_id}`,
      originalUrl: LANDING_URL,
      sourceTime: validFrom ?? fetchedAt,
    });
    const mode = gtfsRouteTypeToMode(route.route_type);
    const routeContent = {
      route_id: route.route_id,
      route_short_name: route.route_short_name,
      route_long_name: route.route_long_name,
      route_type: route.route_type,
      transport_mode: mode,
      feed_version: feedVersion,
    };
    const routeVersionId = sourceVersionId(sourceUpdatedAt, routeContent);
    routeRecordMap.set(route.route_id, { recordId: routeRecordId, versionId: routeVersionId });

    sourceRecords.push({
      batch_id: input.runId,
      source_id: SOURCE_ID,
      schema_version: 1,
      fetched_at: fetchedAt,
      source_record_id: routeRecordId,
      version_id: routeVersionId,
      original_url: LANDING_URL,
      raw_uri: null,
      published_at: null,
      observed_at: null,
      first_accessible_at: null,
      time_missing_reason: 'Static GTFS route definition effective over timetable feed version window',
      valid_from: validFrom,
      valid_to: validTo,
      source_updated_at: sourceUpdatedAt,
      source_version_ordinal: null,
      record_status: 'active',
      assertion_kind: 'report',
      rights_status: 'review_required',
    });
  }

  // 3. Stops
  for (const stop of snapshot.stops) {
    const servingRouteIds = [...(stopToRouteIds.get(stop.stop_id) ?? [])].sort();
    const modes = [
      ...new Set(
        servingRouteIds.map(rid => {
          const r = routesById.get(rid);
          return r ? gtfsRouteTypeToMode(r.route_type) : 'other';
        }),
      ),
    ].sort();

    enrichedStops.push({
      ...stop,
      modes,
      route_ids: servingRouteIds,
    });

    const stopRecordId = sourceRecordId({
      sourceId: SOURCE_ID,
      nativeId: `stop:${stop.stop_id}`,
      originalUrl: LANDING_URL,
      sourceTime: validFrom ?? fetchedAt,
    });
    // Only retained schedule fields go into the runtime reference. The official
    // reader currently flattens mode archives, so feed_info cannot establish a
    // publisher version for a particular realtime mode.
    const reference = {
      kind: 'gtfs_static_stop_reference',
      schema_version: 1,
      feed_version: feedVersion,
      publisher_mode: null,
      publisher_feed_info: null,
      stop: {
        stop_id: stop.stop_id, stop_name: stop.stop_name,
        stop_lat: stop.stop_lat, stop_lon: stop.stop_lon,
        location_type: stop.location_type ?? null,
        parent_station: stop.parent_station ?? null,
      },
      routes: servingRouteIds.flatMap(routeId => {
        const route = routesById.get(routeId);
        return route ? [{ route_id: route.route_id,
          route_short_name: route.route_short_name ?? null,
          route_long_name: route.route_long_name ?? null,
          route_type: route.route_type }] : [];
      }),
    };
    const stopContent = {
      stop_id: stop.stop_id,
      stop_name: stop.stop_name,
      stop_lat: stop.stop_lat,
      stop_lon: stop.stop_lon,
      location_type: stop.location_type,
      parent_station: stop.parent_station,
      modes,
      route_ids: servingRouteIds,
      feed_version: feedVersion,
      runtime_reference: reference,
    };
    const stopVersionId = sourceVersionId(sourceUpdatedAt, stopContent);

    sourceRecords.push({
      batch_id: input.runId,
      source_id: SOURCE_ID,
      schema_version: 1,
      fetched_at: fetchedAt,
      source_record_id: stopRecordId,
      version_id: stopVersionId,
      original_url: LANDING_URL,
      raw_uri: null,
      published_at: null,
      observed_at: null,
      first_accessible_at: null,
      time_missing_reason: 'Static GTFS stop location effective over timetable feed version window',
      valid_from: validFrom,
      valid_to: validTo,
      source_updated_at: sourceUpdatedAt,
      source_version_ordinal: null,
      record_status: 'active',
      assertion_kind: 'report',
      rights_status: 'review_required',
    });

    const geometry: ValidGeometry = {
      type: 'Point',
      coordinates: [stop.stop_lon, stop.stop_lat],
    };
    const geometryJson = JSON.stringify(geometry);

    geoRecords.push({
      batch_id: input.runId,
      source_id: SOURCE_ID,
      schema_version: 1,
      fetched_at: fetchedAt,
      geo_record_id: stopRecordId,
      version_id: stopVersionId,
      topic: 'transport',
      assertion_kind: 'report',
      title: stop.stop_name,
      summary: JSON.stringify(reference),
      original_url: LANDING_URL,
      geometry_geojson: geometryJson,
      centroid_lat: stop.stop_lat,
      centroid_lon: stop.stop_lon,
      location_role: 'sensor_site',
      location_confidence: 'source_coordinate',
      area_refs: [],
      published_at: null,
      observed_at: null,
      valid_from: validFrom,
      valid_to: validTo,
      source_updated_at: sourceUpdatedAt,
      source_version_ordinal: null,
      freshness_state: 'unknown',
      record_status: 'active',
      rights_status: 'review_required',
      public_query_allowed: false,
    });

    geoRecordSources.push({
      batch_id: input.runId,
      source_id: SOURCE_ID,
      schema_version: 1,
      fetched_at: fetchedAt,
      geo_record_id: stopRecordId,
      version_id: stopVersionId,
      source_record_id: stopRecordId,
      source_version_id: stopVersionId,
      evidence_role: 'official_stop_location',
      original_url: LANDING_URL,
    });

    for (const routeId of servingRouteIds) {
      const routeRecord = routeRecordMap.get(routeId);
      if (routeRecord) {
        geoRecordSources.push({
          batch_id: input.runId,
          source_id: SOURCE_ID,
          schema_version: 1,
          fetched_at: fetchedAt,
          geo_record_id: stopRecordId,
          version_id: stopVersionId,
          source_record_id: routeRecord.recordId,
          source_version_id: routeRecord.versionId,
          evidence_role: 'serving_route',
          original_url: LANDING_URL,
        });
      }
    }
  }

  return {
    sourceRecords,
    geoRecords,
    geoRecordSources,
    feedVersion,
    validFrom,
    validTo,
    routes: snapshot.routes,
    stops: enrichedStops,
    sourceUpdatedAt,
    tripStopMembershipComplete: options?.tripStopMembershipComplete ?? true,
  };
}

export class TvGtfsStaticConnector implements Connector {
  readonly sourceId = SOURCE_ID;

  constructor(
    private readonly snapshotProvider?: () => Promise<GtfsStaticSnapshot | OfficialGtfsArchive | null>,
  ) {}

  async collect(input: ConnectorInput): Promise<ConnectorResult> {
    if (input.sourceId !== SOURCE_ID) {
      return failure(input, 'validation_failed', 'Mismatched source ID', 'Input sourceId does not match connector');
    }

    try {
      const acquired = this.snapshotProvider
        ? await this.snapshotProvider() : await fetchOfficialGtfsArchive();
      if (!acquired) {
        return failure(
          input,
          'upstream_unavailable',
          'GTFS static archive provider returned no snapshot',
          'No Transport Victoria GTFS Schedule archive was fetched',
        );
      }
      const official: OfficialGtfsArchive | null = 'archiveVersion' in acquired
        ? acquired as OfficialGtfsArchive : null;
      const snapshot = official ? parseGtfsSnapshot(official.raw) : acquired as GtfsStaticSnapshot;
      const fetchedAt = official?.fetchedAt ?? new Date().toISOString();
      const normalized = normalizeGtfsSnapshot(snapshot, input, fetchedAt, official ? {
        feedVersion: official.archiveVersion,
        sourceUpdatedAt: official.sourceUpdatedAt,
        tripStopMembershipComplete: official.tripStopMembershipComplete,
      } : undefined);
      const totalInput = snapshot.routes.length + snapshot.stops.length + 1;

      const completeness: ConnectorCompleteness = {
        complete: true,
        method: 'feed_snapshot',
        expected_records: totalInput,
        fetched_records: totalInput,
        expected_pages: 1,
        fetched_pages: 1,
        evidence: official
          ? `Official ranged archive verified train/tram modes, routes, stops, trips, and ${official.routeStopPairs} route/stop associations; version derived from archive validator`
          : 'Injected GTFS snapshot verified routes, stops, trips, and mode mappings',
      };

      return {
        kind: 'success',
        sourceId: SOURCE_ID,
        runId: input.runId,
        fetchedAt,
        sourceRevision: normalized.feedVersion,
        sourceLatestUpdateAt: normalized.sourceUpdatedAt,
        checkpointAfter: input.window.kind === 'time'
          ? input.window.to
          : (input.window.revision ?? normalized.feedVersion),
        completeness,
        inputCount: totalInput,
        outputCount: normalized.sourceRecords.length,
        rejectedCount: 0,
        sourceRecords: normalized.sourceRecords,
        geoRecords: normalized.geoRecords,
        geoRecordSources: normalized.geoRecordSources,
        boundaries: [],
        areaIndicators: [],
        parkingBays: [],
        parkingObservations: [],
        parkingRules: [],
        sensorLocations: [],
        pedestrianObservations: [],
        retainableRawRecords: null,
      };
    } catch (error) {
      const code: ConnectorErrorCode = error instanceof z.ZodError
        ? 'schema_changed' : error instanceof HttpFailure ? error.code : 'validation_failed';
      const message = error instanceof Error ? error.message : 'GTFS static parsing error';
      return failure(input, code, message, 'GTFS static snapshot failed referential or schema validation');
    }
  }
}

export const connector: Connector = new TvGtfsStaticConnector();
