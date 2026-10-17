import { z } from 'zod';
import { readFile } from 'node:fs/promises';

import type { Connector, ConnectorInput, ConnectorResult } from '../../core/connector.js';
import { parseSourceManifest } from '../../core/registry.js';
import { HttpFailure } from '../../core/http.js';
import { OdsIncompleteWindow, OpenDataSoftClient } from '../../core/opendatasoft.js';
import {
  pedestrianLocationCheckpointSchema,
  pedestrianLocationHistorySchema,
  pedestrianPointSchema,
} from '../../core/pedestrian-location-history.js';
import type { GeoRecord, GeoRecordSource, SensorLocation, SourceRecord } from '../../core/types.js';
import { validateGeoRecordGeography } from '../../validation/geography.js';
import { sourceRecordId, sourceVersionId } from '../../validation/record.js';

export const SOURCE_ID = 'melbourne.pedestrian.locations';
export const DATASET_ID = 'pedestrian-counting-system-sensor-locations';
export const LANDING_URL = `https://data.melbourne.vic.gov.au/explore/dataset/${DATASET_ID}/`;
export const DEFAULT_PORTAL_URL = 'https://data.melbourne.vic.gov.au';

export const rowSchema = z.object({
  location_id: z.number().int().nonnegative(),
  sensor_description: z.string().nullable().optional(),
  sensor_name: z.string().nullable().optional(),
  installation_date: z.iso.date().nullable().optional(),
  note: z.string().nullable().optional(),
  location_type: z.string().nullable().optional(),
  status: z.string().trim().nullable().optional(),
  direction_1: z.string().nullable().optional(),
  direction_2: z.string().nullable().optional(),
  latitude: z.number().finite().min(-90).max(90).nullable().optional(),
  longitude: z.number().finite().min(-180).max(180).nullable().optional(),
  location: z.object({
    lon: z.number().finite().min(-180).max(180).nullable().optional(),
    lat: z.number().finite().min(-90).max(90).nullable().optional(),
  }).nullable().optional(),
  valid_from: z.string().nullable().optional(),
  valid_to: z.string().nullable().optional(),
}).passthrough();

export type PedestrianLocationRow = z.infer<typeof rowSchema>;

export function parsePedestrianLocationRow(value: unknown): PedestrianLocationRow {
  return rowSchema.parse(value);
}

function failure(
  input: ConnectorInput,
  code: 'rate_limited' | 'upstream_unavailable' | 'schema_changed' | 'auth_failed' | 'incomplete_window' | 'validation_failed',
  message: string,
): ConnectorResult {
  return {
    kind: 'failure',
    sourceId: SOURCE_ID,
    runId: input.runId,
    checkedAt: new Date().toISOString(),
    code,
    message,
    retryAfterSeconds: null,
    completeness: {
      complete: false,
      expected_records: null,
      fetched_records: 0,
      expected_pages: null,
      fetched_pages: 0,
      evidence: 'A complete location snapshot is required to identify removed or moved sensors',
    },
    sourceLatestUpdateAt: null,
  };
}

function geometryChanged(prevGeometry: string | null, currentGeometry: string | null): boolean {
  if (prevGeometry === currentGeometry) return false;
  if (prevGeometry === null || currentGeometry === null) return true;
  try {
    const p1 = pedestrianPointSchema.parse(JSON.parse(prevGeometry));
    const p2 = pedestrianPointSchema.parse(JSON.parse(currentGeometry));
    const [lon1, lat1] = p1.coordinates;
    const [lon2, lat2] = p2.coordinates;
    return Math.abs(lon1 - lon2) > 1e-6 || Math.abs(lat1 - lat2) > 1e-6;
  } catch {
    return true;
  }
  return true;
}

function statusChanged(prevStatus: string | null, currentStatus: string | null): boolean {
  const norm = (s: string | null) => s?.trim().toLowerCase() ?? '';
  return norm(prevStatus) !== norm(currentStatus);
}

export interface PedestrianLocationsConnectorOptions {
  portalUrl?: string;
  client?: OpenDataSoftClient;
  previousLocations?: readonly SensorLocation[] | Iterable<SensorLocation> | Map<string, SensorLocation>;
  /** Legacy fixture option; every connector instance is now isolated. */
  isolated?: boolean;
}

export class PedestrianLocationsConnector implements Connector {
  readonly sourceId = SOURCE_ID;
  private readonly portalUrl: string;
  private readonly client: OpenDataSoftClient;
  private readonly initialLocations: readonly SensorLocation[];
  private knownLocations = new Map<string, SensorLocation>();
  private historicalLocations: SensorLocation[] = [];

  constructor(options: PedestrianLocationsConnectorOptions = {}) {
    this.portalUrl = options.portalUrl ?? DEFAULT_PORTAL_URL;
    this.client = options.client ?? new OpenDataSoftClient();

    const previous = options.previousLocations instanceof Map
      ? options.previousLocations.values() : options.previousLocations ?? [];
    this.initialLocations = pedestrianLocationHistorySchema.parse(Array.from(previous));
  }

  getKnownLocations(): readonly SensorLocation[] {
    return Array.from(this.knownLocations.values());
  }

  getHistoricalLocations(): readonly SensorLocation[] {
    return [...this.historicalLocations];
  }

  getAllLocations(): readonly SensorLocation[] {
    return [...this.historicalLocations, ...this.knownLocations.values()];
  }

  async collect(input: ConnectorInput): Promise<ConnectorResult> {
    if (input.sourceId !== SOURCE_ID) {
      return failure(input, 'validation_failed', `Expected source ID ${SOURCE_ID}, got ${input.sourceId}`);
    }
    if (input.window.kind !== 'snapshot') {
      return failure(input, 'validation_failed', 'Pedestrian locations require a complete snapshot');
    }
    // Records carry the source's reviewed licence, as the parking connectors do; review_required
    // until admission, after which the serving views can publish them.
    const rights = await reviewedRights();

    let previousLocations = this.initialLocations;
    if (input.checkpoint && /^[\s]*[\[{]/.test(input.checkpoint)) {
      try {
        previousLocations = pedestrianLocationCheckpointSchema.parse(JSON.parse(input.checkpoint)).locations;
      } catch (error) {
        return failure(input, 'validation_failed', error instanceof Error ? error.message : 'Invalid published location history');
      }
    }
    const knownLocations = new Map(previousLocations.filter(location => location.valid_to === null)
      .map(location => [location.sensor_id, location]));
    const historicalLocations = previousLocations.filter(location => location.valid_to !== null);

    try {
      const response = await this.client.fetchRecords({
        portalUrl: this.portalUrl,
        datasetId: DATASET_ID,
        orderBy: 'location_id ASC',
      });

      let sourceUpdatedAt: string | null = null;
      if (response.lastModified !== null) {
        const time = Date.parse(response.lastModified);
        if (Number.isFinite(time)) {
          sourceUpdatedAt = new Date(time).toISOString();
        }
      }

      const sourceRecords: SourceRecord[] = [];
      const closedSourceRecords: SourceRecord[] = [];
      const sensorLocations: SensorLocation[] = [];
      const closedLocations: SensorLocation[] = [];
      const geoRecords: GeoRecord[] = [];
      const geoRecordSources: GeoRecordSource[] = [];
      const seen = new Set<number>();
      const rows = response.records.map(row => rowSchema.parse(row));
      const snapshotRevision = sourceVersionId(sourceUpdatedAt,
        [...rows].sort((a, b) => a.location_id - b.location_id));
      z.iso.datetime({ offset: false }).parse(response.fetchedAt);
      for (const previous of previousLocations) {
        if (Date.parse(response.fetchedAt) < Date.parse(previous.fetched_at)) {
          return failure(input, 'validation_failed', `Snapshot observation time precedes published history for sensor ${previous.sensor_id}`);
        }
        if (previous.source_updated_at !== null && (sourceUpdatedAt === null
          || Date.parse(sourceUpdatedAt) < Date.parse(previous.source_updated_at))) {
          return failure(input, 'validation_failed', `Snapshot source revision is missing or precedes published history for sensor ${previous.sensor_id}`);
        }
      }

      const closeLocation = (previous: SensorLocation, validTo: string,
        successorVersion: string | null, reason: string): void => {
        const versionId = sourceVersionId(sourceUpdatedAt, {
          kind: 'observed_location_interval_closure', previous_version_id: previous.version_id,
          snapshot_revision: snapshotRevision, successor_version_id: successorVersion,
          valid_from: previous.valid_from, valid_to: validTo,
          geometry_geojson: previous.geometry_geojson, device_status: previous.device_status,
        });
        const closed: SensorLocation = { ...previous,
          batch_id: input.runId, fetched_at: response.fetchedAt, version_id: versionId,
          valid_to: validTo, source_updated_at: sourceUpdatedAt, source_version_ordinal: null,
        };
        closedLocations.push(closed);
        historicalLocations.push(closed);
        closedSourceRecords.push({
          batch_id: input.runId, source_id: SOURCE_ID, schema_version: 1,
          fetched_at: response.fetchedAt, source_record_id: previous.source_record_id,
          version_id: versionId, original_url: LANDING_URL, raw_uri: null,
          published_at: null, observed_at: null, first_accessible_at: null,
          time_missing_reason: reason, valid_from: previous.valid_from, valid_to: validTo,
          source_updated_at: sourceUpdatedAt, source_version_ordinal: null,
          record_status: 'corrected', assertion_kind: 'observation', rights_status: rights,
        });
      };

      for (const row of rows) {

        if (seen.has(row.location_id)) {
          return failure(input, 'validation_failed', `Duplicate location_id detected in snapshot: ${row.location_id}`);
        }
        seen.add(row.location_id);

        const lat = row.latitude ?? (row.location?.lat !== undefined ? row.location.lat : null);
        const lon = row.longitude ?? (row.location?.lon !== undefined ? row.location.lon : null);

        if ((lat === null && lon !== null) || (lat !== null && lon === null)) {
          return failure(input, 'validation_failed', `Sensor ${row.location_id} has incomplete coordinates`);
        }

        if (row.latitude != null && row.location?.lat != null && Math.abs(row.latitude - row.location.lat) > 0.001) {
          return failure(input, 'validation_failed', `Sensor ${row.location_id} has conflicting latitude coordinates`);
        }
        if (row.longitude != null && row.location?.lon != null && Math.abs(row.longitude - row.location.lon) > 0.001) {
          return failure(input, 'validation_failed', `Sensor ${row.location_id} has conflicting longitude coordinates`);
        }

        const hasPoint = lat !== null && lon !== null;
        const geometry = hasPoint
          ? JSON.stringify({ type: 'Point', coordinates: [lon, lat] })
          : null;

        const sensorId = String(row.location_id);
        const deviceStatus = row.status ?? null;
        const isRemoved = deviceStatus?.trim().toUpperCase() === 'R'
          || deviceStatus?.trim().toLowerCase() === 'removed';

        const previousLocation = knownLocations.get(sensorId);
        const isRelocated = previousLocation !== undefined && geometryChanged(previousLocation.geometry_geojson, geometry);
        const isStatusTransition = previousLocation !== undefined && statusChanged(previousLocation.device_status, deviceStatus);

        // Effective dates:
        // Distinguish device installation date from coordinate valid interval.
        // Never invent dates from natural-language notes.
        // When no explicit official relocation date is provided across versions,
        // DO NOT backdate new coordinates to the original installation date,
        // and DO NOT claim fetch time is official move time.
        let validFrom: string;
        // Source-fact content must remain identical when the same version is replayed.
        // The transition-specific explanation belongs to the new closure source fact.
        const timeMissingReason = row.valid_from
          ? 'Official valid_from defines the location interval; the row has no per-row publication or observation timestamp'
          : 'The location interval starts at its earliest observed snapshot timestamp, not official relocation time or device installation date; prior history and any unobserved transition gap remain unknown';

        if (row.valid_from) {
          if (!z.iso.datetime({ offset: true }).safeParse(row.valid_from).success) {
            return failure(input, 'validation_failed', `Sensor ${row.location_id} has invalid valid_from timestamp: ${row.valid_from}`);
          }
          validFrom = new Date(row.valid_from).toISOString();
        } else if (isRelocated || isStatusTransition) {
          validFrom = response.fetchedAt;
        } else if (previousLocation) {
          validFrom = previousLocation.valid_from;
        } else {
          validFrom = response.fetchedAt;
        }

        let validTo: string | null = null;
        if (row.valid_to) {
          if (!z.iso.datetime({ offset: true }).safeParse(row.valid_to).success) {
            return failure(input, 'validation_failed', `Sensor ${row.location_id} has invalid valid_to timestamp: ${row.valid_to}`);
          }
          validTo = new Date(row.valid_to).toISOString();
        }

        if (validTo !== null && Date.parse(validTo) < Date.parse(validFrom)) {
          return failure(input, 'validation_failed', `valid_to precedes valid_from for sensor ${row.location_id}`);
        }

        const recordId = sourceRecordId({
          sourceId: SOURCE_ID,
          nativeId: sensorId,
          originalUrl: LANDING_URL,
          sourceTime: null,
        });

        // The observed interval is persisted evidence, not a provider relocation date.
        const versionId = sourceVersionId(sourceUpdatedAt, { row, valid_from: validFrom, valid_to: validTo });
        if (previousLocation && (isRelocated || isStatusTransition)) {
          if (Date.parse(validFrom) <= Date.parse(previousLocation.valid_from)) {
            return failure(input, 'validation_failed', `Changed sensor ${sensorId} needs a later location interval or explicit correction review`);
          }
          const lastConfirmed = Date.parse(previousLocation.fetched_at) >= Date.parse(previousLocation.valid_from)
            ? previousLocation.fetched_at : previousLocation.valid_from;
          closeLocation(previousLocation, row.valid_from ? validFrom : lastConfirmed,
            versionId, row.valid_from
              ? 'Previous location interval closed by the successor row official valid_from'
              : 'Location or status changed without an official change date; previous interval ends at its last confirmed snapshot and the transition gap remains unknown');
        }

        sourceRecords.push({
          batch_id: input.runId,
          source_id: SOURCE_ID,
          schema_version: 1,
          fetched_at: response.fetchedAt,
          source_record_id: recordId,
          version_id: versionId,
          original_url: LANDING_URL,
          raw_uri: null,
          published_at: null,
          observed_at: null,
          first_accessible_at: null,
          time_missing_reason: timeMissingReason,
          valid_from: validFrom,
          valid_to: validTo,
          source_updated_at: sourceUpdatedAt,
          source_version_ordinal: null,
          record_status: 'active',
          assertion_kind: 'observation',
          rights_status: rights,
        });

        const currentLocation: SensorLocation = {
          batch_id: input.runId,
          source_id: SOURCE_ID,
          schema_version: 1,
          fetched_at: response.fetchedAt,
          sensor_id: sensorId,
          version_id: versionId,
          geometry_geojson: geometry,
          device_status: deviceStatus,
          valid_from: validFrom,
          valid_to: validTo,
          source_record_id: recordId,
          source_updated_at: sourceUpdatedAt,
          source_version_ordinal: null,
        };

        sensorLocations.push(currentLocation);
        if (validTo === null) knownLocations.set(sensorId, currentLocation);
        else {
          knownLocations.delete(sensorId);
          historicalLocations.push(currentLocation);
        }

        const geoRecord: GeoRecord = {
          batch_id: input.runId,
          source_id: SOURCE_ID,
          schema_version: 1,
          fetched_at: response.fetchedAt,
          geo_record_id: recordId,
          version_id: versionId,
          topic: 'pedestrian',
          assertion_kind: 'observation',
          title: row.sensor_description ?? row.sensor_name ?? null,
          summary: row.note ?? null,
          original_url: LANDING_URL,
          geometry_geojson: geometry,
          centroid_lat: hasPoint ? lat : null,
          centroid_lon: hasPoint ? lon : null,
          location_role: hasPoint ? 'sensor_site' : 'unknown',
          location_confidence: hasPoint ? 'source_coordinate' : 'unverified',
          area_refs: [],
          published_at: null,
          observed_at: null,
          valid_from: validFrom,
          valid_to: validTo,
          source_updated_at: sourceUpdatedAt,
          source_version_ordinal: null,
          freshness_state: 'unknown',
          record_status: isRemoved ? 'resolved' : 'active',
          rights_status: rights,
          public_query_allowed: rights !== 'review_required',
        };

        const geoValidation = validateGeoRecordGeography(geoRecord);
        if (!geoValidation.valid) {
          return failure(
            input,
            'validation_failed',
            `Invalid geography for sensor ${sensorId}: ${geoValidation.issues.join(', ')}`,
          );
        }

        geoRecords.push(geoRecord);

        geoRecordSources.push({
          batch_id: input.runId,
          source_id: SOURCE_ID,
          schema_version: 1,
          fetched_at: response.fetchedAt,
          geo_record_id: recordId,
          version_id: versionId,
          source_record_id: recordId,
          source_version_id: versionId,
          evidence_role: 'official_sensor_location',
          original_url: LANDING_URL,
        });
      }

      for (const previous of previousLocations) {
        if (previous.valid_to !== null || seen.has(Number(previous.sensor_id))) continue;
        const lastConfirmed = Date.parse(previous.fetched_at) >= Date.parse(previous.valid_from)
          ? previous.fetched_at : previous.valid_from;
        closeLocation(previous, lastConfirmed, null,
          'Sensor is absent from a complete successor snapshot; last confirmed location ends at its previous observed snapshot, with no inferred removal time or status');
        knownLocations.delete(previous.sensor_id);
      }

      // Exposed state is only the last successful result, never an input to a later run.
      this.knownLocations = knownLocations;
      this.historicalLocations = historicalLocations;

      const checkpointAfter = input.window.revision === 'latest'
        ? (sourceUpdatedAt ?? response.fetchedAt) : input.window.revision;

      return {
        kind: 'success',
        sourceId: SOURCE_ID,
        runId: input.runId,
        fetchedAt: response.fetchedAt,
        // This is an acquisition identity, not an upstream revision timestamp.
        // A later unchanged check must persist its new location confirmation.
        sourceRevision: `observation-snapshot:${response.fetchedAt}:${snapshotRevision}`,
        sourceLatestUpdateAt: sourceUpdatedAt,
        checkpointAfter,
        completeness: {
          complete: true,
          method: 'pagination',
          expected_records: response.totalCount,
          fetched_records: response.records.length,
          expected_pages: response.pageCount,
          fetched_pages: response.pageCount,
          evidence: 'All OpenDataSoft pages match total_count',
        },
        inputCount: response.records.length,
        outputCount: sourceRecords.length + closedSourceRecords.length,
        rejectedCount: 0,
        sourceRecords: [...sourceRecords, ...closedSourceRecords],
        geoRecords,
        geoRecordSources,
        boundaries: [],
        areaIndicators: [],
        parkingBays: [],
        parkingObservations: [],
        parkingRules: [],
        sensorLocations: [...sensorLocations, ...closedLocations],
        pedestrianObservations: [],
        retainableRawRecords: null,
      };
    } catch (error) {
      const code = error instanceof OdsIncompleteWindow ? 'incomplete_window'
        : error instanceof HttpFailure ? error.code
          : error instanceof z.ZodError ? 'schema_changed' : 'validation_failed';
      return failure(input, code, error instanceof Error ? error.message : 'Pedestrian location snapshot could not be validated');
    }
  }
}

export const connector: Connector = new PedestrianLocationsConnector();

/** The licence the reviewed manifest declares, read beside the compiled connector. */
async function reviewedRights() {
  return parseSourceManifest(JSON.parse(await readFile(new URL('./source.json', import.meta.url), 'utf8'))).license_status;
}

