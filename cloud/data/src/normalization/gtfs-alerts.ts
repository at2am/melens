import { z } from 'zod';

import {
  SOURCE_ID as STATIC_SOURCE_ID,
  type GtfsStaticSnapshot,
  type NormalizedGtfsResult,
} from '../connectors/tv_gtfs_static/index.js';
import {
  SOURCE_ID as REALTIME_SOURCE_ID,
  type AlertMode,
  type ParsedAlertFeed,
} from '../connectors/tv_gtfs_realtime/index.js';
import type { GeoRecord, GeoRecordSource, SourceRecord } from '../core/types.js';
import { sourceRecordId, sourceVersionId } from '../validation/record.js';

const tripStartDateSchema = z.string().regex(/^\d{8}$/).refine(value =>
  z.iso.date().safeParse(`${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`).success);
const tripStartTimeSchema = z.string().regex(/^\d{2,}:[0-5]\d:[0-5]\d$/);

const selectorSchema = z.object({
  agencyId: z.string().nullable(),
  routeId: z.string().nullable(),
  routeType: z.number().int().nullable(),
  stopId: z.string().nullable(),
  directionId: z.number().int().nullable(),
  tripId: z.string().nullable(),
  tripRouteId: z.string().nullable(),
  tripStartDate: tripStartDateSchema.nullable(),
  tripStartTime: tripStartTimeSchema.nullable(),
});
const summarySchema = z.object({
  mode: z.enum(['metro_train', 'yarra_tram']),
  feed_timestamp: z.string().nullable(),
  feed_version: z.string().min(1).nullable(),
  alert_id: z.string().min(1),
  selectors: z.array(selectorSchema).min(1),
});
type AlertSummary = z.infer<typeof summarySchema>;
type AlertSelector = AlertSummary['selectors'][number];

export interface StaticGtfsVersion {
  /** Both values must describe the same downloaded GTFS archive. */
  snapshot: GtfsStaticSnapshot;
  normalized: NormalizedGtfsResult;
  /** Runtime references require a publisher archive relationship for this mode. */
  publisherMode?: AlertMode;
}

export type GtfsMappingStatus =
  | 'located' | 'route_only' | 'unmapped' | 'ambiguous'
  | 'version_unverified' | 'trip_instance_unverified' | 'invalid_alert';

export interface GtfsAlertMapping {
  geoRecordId: string;
  status: GtfsMappingStatus;
  staticFeedVersion: string | null;
  routeIds: readonly string[];
  stopIds: readonly string[];
}

export interface JoinedGtfsAlerts {
  geoRecords: GeoRecord[];
  geoRecordSources: GeoRecordSource[];
  mappings: GtfsAlertMapping[];
}

interface PreparedStatic {
  version: StaticGtfsVersion;
  routes: Map<string, StaticGtfsVersion['snapshot']['routes'][number]>;
  stops: Map<string, NormalizedGtfsResult['stops'][number]>;
  trips: Map<string, StaticGtfsVersion['snapshot']['trips'][number]>;
  tripStops: Set<string>;
  records: Map<string, SourceRecord>;
  stopGeography: Map<string, GeoRecord>;
}

function prepare(version: StaticGtfsVersion): PreparedStatic {
  const routes = new Map(version.snapshot.routes.map(route => [route.route_id, route]));
  const stops = new Map(version.normalized.stops.map(stop => [stop.stop_id, stop]));
  const trips = new Map(version.snapshot.trips.map(trip => [trip.trip_id, trip]));
  const tripStops = new Set(version.snapshot.stop_times.map(time =>
    `${time.trip_id}\u0000${time.stop_id}`));
  const records = new Map(version.normalized.sourceRecords.map(record =>
    [record.source_record_id, record]));
  const stopGeography = new Map(version.normalized.geoRecords.map(record =>
    [record.geo_record_id, record]));
  return { version, routes, stops, trips, tripStops, records, stopGeography };
}

function modeMatches(mode: AlertMode, routeType: number): boolean {
  return mode === 'yarra_tram' ? routeType === 0 : routeType === 1 || routeType === 2;
}

function publisherFeedVersion(staticFeed: PreparedStatic): string | null {
  const { feed_info: feedInfo } = staticFeed.version.snapshot;
  if (feedInfo.length === 0) return null;
  // The official reader flattens train/tram feed_info and replaces the
  // publisher's version with an HTTP archive validator. Even two matching
  // rows cannot prove that each mode supplied one, so fail closed here.
  if (staticFeed.version.normalized.feedVersion.startsWith('archive-sha256:')) return null;
  const versions = feedInfo.map(info => info.feed_version?.trim() ?? '');
  if (versions.some(version => version.length === 0)) return null;
  const version = versions[0];
  return version === staticFeed.version.normalized.feedVersion
    && versions.every(other => other === version) ? version : null;
}

function versionMatches(alert: AlertSummary, staticFeed: PreparedStatic): boolean {
  if (staticFeed.version.publisherMode !== undefined
    && staticFeed.version.publisherMode !== alert.mode) return false;
  if (alert.feed_version === null || alert.feed_timestamp === null
    || alert.feed_version !== publisherFeedVersion(staticFeed)) return false;
  const timestamp = Date.parse(alert.feed_timestamp);
  if (!Number.isFinite(timestamp)) return false;
  const { validFrom, validTo } = staticFeed.version.normalized;
  return (validFrom === null || timestamp >= Date.parse(validFrom))
    && (validTo === null || timestamp <= Date.parse(validTo));
}

interface ResolvedSelector {
  routeIds: string[];
  stopId: string | null;
  /** Broad selectors do not assert every route as an individually affected route. */
  exactRouteIds: string[];
}

type SelectorResolution =
  | { kind: 'matched'; selector: ResolvedSelector }
  | { kind: 'unmapped' }
  | { kind: 'trip_instance_unverified' };

function resolveSelector(
  selector: AlertSelector,
  mode: AlertMode,
  staticFeed: PreparedStatic,
): SelectorResolution {
  // A trip instance needs calendar/frequency evidence that the current static
  // snapshot does not preserve. Do not silently drop these AND constraints.
  if (selector.tripStartDate !== null || selector.tripStartTime !== null) {
    return { kind: 'trip_instance_unverified' };
  }
  const { snapshot } = staticFeed.version;
  const trip = selector.tripId === null ? null : staticFeed.trips.get(selector.tripId);
  if (selector.tripId !== null && trip === undefined) return { kind: 'unmapped' };
  if (selector.routeId !== null && selector.tripRouteId !== null
    && selector.routeId !== selector.tripRouteId) return { kind: 'unmapped' };
  if (trip && ((selector.routeId !== null && selector.routeId !== trip.route_id)
    || (selector.tripRouteId !== null && selector.tripRouteId !== trip.route_id))) return { kind: 'unmapped' };

  const stop = selector.stopId === null ? null : staticFeed.stops.get(selector.stopId);
  if (selector.stopId !== null && stop === undefined) return { kind: 'unmapped' };
  if (trip && stop && (!staticFeed.version.normalized.tripStopMembershipComplete
    || !staticFeed.tripStops.has(`${trip.trip_id}\u0000${stop.stop_id}`))) return { kind: 'unmapped' };

  const explicitRouteId = selector.routeId ?? selector.tripRouteId ?? trip?.route_id ?? null;
  const routeIds = (explicitRouteId === null
    ? [...staticFeed.routes.keys()]
    : [explicitRouteId]).filter(routeId => {
    const route = staticFeed.routes.get(routeId);
    if (!route || !modeMatches(mode, route.route_type)) return false;
    if (selector.routeType !== null && route.route_type !== selector.routeType) return false;
    if (selector.agencyId !== null && route.agency_id !== selector.agencyId) return false;
    if (stop && !stop.route_ids.includes(routeId)) return false;
    if (selector.directionId !== null) {
      if (trip) return trip.direction_id === selector.directionId;
      if (stop && !staticFeed.version.normalized.tripStopMembershipComplete) return false;
      return snapshot.trips.some(candidate => candidate.route_id === routeId
        && candidate.direction_id === selector.directionId
        && (!stop || staticFeed.tripStops.has(`${candidate.trip_id}\u0000${stop.stop_id}`)));
    }
    return true;
  });
  if (routeIds.length === 0) return { kind: 'unmapped' };
  return { kind: 'matched', selector: {
    routeIds, stopId: stop?.stop_id ?? null,
    exactRouteIds: explicitRouteId === null ? [] : routeIds,
  } };
}

function staticRecord(staticFeed: PreparedStatic, kind: 'stop' | 'route', id: string): SourceRecord | null {
  const recordId = sourceRecordId({ sourceId: STATIC_SOURCE_ID,
    nativeId: `${kind}:${id}`, originalUrl: null, sourceTime: null });
  return staticFeed.records.get(recordId) ?? null;
}

function parseSummary(row: GeoRecord): AlertSummary | null {
  if (row.source_id !== REALTIME_SOURCE_ID || row.summary === null) return null;
  try {
    const parsed = summarySchema.safeParse(JSON.parse(row.summary));
    if (!parsed.success) return null;
    const alert = parsed.data;
    const expectedId = sourceRecordId({ sourceId: REALTIME_SOURCE_ID,
      nativeId: `alert:${alert.mode}:${alert.alert_id}`, originalUrl: null, sourceTime: null });
    return expectedId === row.geo_record_id ? alert : null;
  } catch {
    return null;
  }
}

/**
 * Enrich only an exact stop match in the same static feed version and mode.
 * A route, agency, or mode selector alone has no defensible point geometry.
 * Call this before publishing the realtime batch, with an admitted static feed.
 */
export function joinGtfsAlertLocations(input: {
  alerts: readonly GeoRecord[];
  alertSources: readonly GeoRecordSource[];
  staticVersions: readonly StaticGtfsVersion[];
}): JoinedGtfsAlerts {
  const staticFeeds = input.staticVersions.map(prepare);
  const geoRecords: GeoRecord[] = [];
  const geoRecordSources: GeoRecordSource[] = [];
  const mappings: GtfsAlertMapping[] = [];
  for (const original of input.alerts) {
    const summary = parseSummary(original);
    const originalLinks = input.alertSources.filter(link =>
      link.geo_record_id === original.geo_record_id && link.version_id === original.version_id);
    let status: GtfsMappingStatus = 'invalid_alert';
    let staticFeed: PreparedStatic | null = null;
    let routeIds: string[] = [];
    let stopIds: string[] = [];
    let locatedStopId: string | null = null;
    const alertSelfLink = originalLinks.find(link => link.evidence_role === 'alert_entity'
      && link.source_record_id === original.geo_record_id);

    if (summary !== null) {
      const eligible = staticFeeds.filter(feed => versionMatches(summary, feed));
      if (eligible.length === 1 && alertSelfLink) {
        staticFeed = eligible[0] ?? null;
        if (staticFeed) {
          const resolved = summary.selectors.map(selector =>
            resolveSelector(selector, summary.mode, staticFeed!));
          const matched = resolved.flatMap(item => item.kind === 'matched' ? [item.selector] : []);
          routeIds = [...new Set(matched.flatMap(item => item.exactRouteIds))].sort();
          stopIds = [...new Set(matched.flatMap(item => item.stopId === null ? [] : [item.stopId]))].sort();
          if (resolved.some(item => item.kind === 'trip_instance_unverified')) {
            status = 'trip_instance_unverified';
          }
          else if (matched.length === 0) status = 'unmapped';
          else if (matched.length !== resolved.length || stopIds.length > 1
            || (stopIds.length === 1 && matched.some(item => item.stopId === null))) {
            // A stop selector alongside a route or agency selector describes
            // more than one possible location for the whole alert.
            status = 'ambiguous';
          }
          else if (stopIds.length === 0) status = 'route_only';
          else {
            const stopId = stopIds[0];
            const stopRow = stopId === undefined ? null : staticRecord(staticFeed, 'stop', stopId);
            const stopGeo = stopId === undefined ? null : staticFeed.stopGeography.get(stopRow?.source_record_id ?? '');
            if (stopRow && stopGeo?.geometry_geojson && stopGeo.centroid_lat !== null
              && stopGeo.centroid_lon !== null) {
              status = 'located';
              locatedStopId = stopId ?? null;
            } else status = 'unmapped';
          }
        }
      } else status = 'version_unverified';
    }

    let record = original;
    if (locatedStopId !== null && staticFeed !== null && alertSelfLink) {
      const stopRow = staticRecord(staticFeed, 'stop', locatedStopId);
      const stopGeo = stopRow ? staticFeed.stopGeography.get(stopRow.source_record_id) : null;
      if (stopRow && stopGeo) {
        const versionId = sourceVersionId(original.source_updated_at, {
          alertSourceVersionId: alertSelfLink.source_version_id,
          staticFeedVersion: staticFeed.version.normalized.feedVersion,
          staticStopVersionId: stopRow.version_id,
          geometry: stopGeo.geometry_geojson,
        });
        record = { ...original, version_id: versionId,
          geometry_geojson: stopGeo.geometry_geojson,
          centroid_lat: stopGeo.centroid_lat, centroid_lon: stopGeo.centroid_lon,
          location_role: 'event_site', location_confidence: 'official_join' };
      }
    }
    geoRecords.push(record);
    geoRecordSources.push(...originalLinks.map(link => ({ ...link, version_id: record.version_id })));

    if (staticFeed !== null) {
      for (const [kind, ids] of [
        ['route', routeIds], ['stop', stopIds],
      ] as const) {
        for (const id of ids) {
          const referenced = staticRecord(staticFeed, kind, id);
          if (!referenced) continue;
          geoRecordSources.push({ batch_id: record.batch_id, source_id: record.source_id,
            schema_version: record.schema_version, fetched_at: record.fetched_at,
            geo_record_id: record.geo_record_id, version_id: record.version_id,
            source_record_id: referenced.source_record_id,
            source_version_id: referenced.version_id,
            evidence_role: kind === 'route' ? 'gtfs_static_route_id' : 'gtfs_static_stop_location',
            original_url: referenced.original_url });
        }
      }
    }
    mappings.push({ geoRecordId: record.geo_record_id, status,
      staticFeedVersion: staticFeed?.version.normalized.feedVersion ?? null,
      routeIds, stopIds });
  }
  const unique = new Map<string, GeoRecordSource>();
  for (const link of geoRecordSources) {
    unique.set(`${link.geo_record_id}\u0000${link.version_id}\u0000${link.source_record_id}\u0000${link.source_version_id}`, link);
  }
  return { geoRecords, geoRecordSources: [...unique.values()], mappings };
}

/** A FULL_DATASET omission ends snapshot membership; it is not a cancellation. */
export function compareFullGtfsSnapshots(input: {
  previous: ParsedAlertFeed;
  current: ParsedAlertFeed;
}): { currentAlertIds: readonly string[]; disappearedAlertIds: readonly string[] } {
  const previousTime = input.previous.feedTimestamp;
  const currentTime = input.current.feedTimestamp;
  if (previousTime === null || currentTime === null || currentTime <= previousTime) {
    throw new Error('GTFS snapshots require increasing feed timestamps');
  }
  const currentAlertIds = [...new Set(input.current.alerts.map(alert => alert.id))].sort();
  const present = new Set(currentAlertIds);
  return { currentAlertIds, disappearedAlertIds:
    [...new Set(input.previous.alerts.map(alert => alert.id))].filter(id => !present.has(id)).sort() };
}
