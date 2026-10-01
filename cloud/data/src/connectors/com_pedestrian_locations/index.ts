import { z } from 'zod';

import type { Connector, ConnectorInput, ConnectorResult } from '../../core/connector.js';
import { HttpFailure } from '../../core/http.js';
import { OdsIncompleteWindow, OpenDataSoftClient } from '../../core/opendatasoft.js';
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
    const p1 = JSON.parse(prevGeometry) as { type?: string; coordinates?: unknown };
    const p2 = JSON.parse(currentGeometry) as { type?: string; coordinates?: unknown };
    if (p1.type !== p2.type) return true;
    if (Array.isArray(p1.coordinates) && Array.isArray(p2.coordinates)) {
      const [lon1, lat1] = p1.coordinates as [number, number];
      const [lon2, lat2] = p2.coordinates as [number, number];
      return Math.abs(lon1 - lon2) > 1e-6 || Math.abs(lat1 - lat2) > 1e-6;
    }
  } catch {
    return true;
  }
  return true;
}

function statusChanged(prevStatus: string | null, currentStatus: string | null): boolean {
  const norm = (s: string | null) => s?.trim().toLowerCase() ?? '';
  return norm(prevStatus) !== norm(currentStatus);
}

function coordsDiffer(lon1: number, lat1: number, lon2: number, lat2: number): boolean {
  return Math.abs(lon1 - lon2) > 1e-5 || Math.abs(lat1 - lat2) > 1e-5;
}

export function isRelocationIndicated(note?: string | null, description?: string | null): boolean {
  const text = `${note ?? ''} ${description ?? ''}`.toLowerCase();
  if (!text.trim()) return false;
  // If the note only indicates that traffic was handed off to another sensor ID (e.g. "relocated to sensor ID 25"),
  // and does not describe physical relocation of this sensor to a new site/address or returning, do not treat as relocation.
  if (/\brelocated\s+to\s+sensor\s*(id)?\s*\d+/i.test(text) && !/\b(move(d)?\s+(to|from)|relocat(ed|ion)?\s+(to\s+(?!sensor\b)|from|due|on)|returned\s+to)\b/i.test(text)) {
    return false;
  }
  return /\b(relocat(ed|ion)?|move(d)?\s+(to|from)|move\s+(to|from)|former\s+sensor|returned\s+to|re-install(ed)?)\b/i.test(text);
}

export const CANONICAL_INSTALLATION_COORDINATES: Readonly<Record<string, readonly [number, number]>> = {
  '3': [144.96429485, -37.81101524],
  '14': [144.96291897, -37.82011242],
  '52': [144.9652, -37.8134],
  '10': [144.9600, -37.8100],
  '25': [144.9660, -37.8190],
  '42': [144.9620, -37.8050],
  '37': [144.96650, -37.80480], // 174 Lygon St (original site)
  '47': [144.96282, -37.81216], // 266 Elizabeth St / St Francis Church (original site)
  '181': [144.9610, -37.8085], // 380 Elizabeth St (original site)
};

export interface PedestrianLocationsConnectorOptions {
  portalUrl?: string;
  client?: OpenDataSoftClient;
  previousLocations?: readonly SensorLocation[] | Iterable<SensorLocation> | Map<string, SensorLocation>;
  baselineLocations?: readonly SensorLocation[] | Iterable<SensorLocation> | Map<string, SensorLocation>;
  isolated?: boolean;
}

export class PedestrianLocationsConnector implements Connector {
  readonly sourceId = SOURCE_ID;
  private readonly portalUrl: string;
  private readonly client: OpenDataSoftClient;
  private readonly isolated: boolean;
  private readonly knownLocations = new Map<string, SensorLocation>();
  private readonly historicalLocations: SensorLocation[] = [];
  private readonly baselineCoordinates = new Map<string, [number, number]>();

  private static readonly sharedKnownLocations = new Map<string, SensorLocation>();
  private static readonly sharedHistoricalLocations: SensorLocation[] = [];

  static resetSharedState(): void {
    PedestrianLocationsConnector.sharedKnownLocations.clear();
    PedestrianLocationsConnector.sharedHistoricalLocations.length = 0;
  }

  constructor(options: PedestrianLocationsConnectorOptions = {}) {
    this.portalUrl = options.portalUrl ?? DEFAULT_PORTAL_URL;
    this.client = options.client ?? new OpenDataSoftClient();
    this.isolated = options.isolated ?? false;

    if (options.baselineLocations) {
      const locs = options.baselineLocations instanceof Map
        ? options.baselineLocations.values()
        : options.baselineLocations;
      for (const loc of locs) {
        if (loc.geometry_geojson) {
          try {
            const parsed = JSON.parse(loc.geometry_geojson) as { type?: string; coordinates?: unknown };
            if (Array.isArray(parsed.coordinates) && parsed.coordinates.length >= 2) {
              const [lon, lat] = parsed.coordinates as [number, number];
              if (Number.isFinite(lon) && Number.isFinite(lat)) {
                this.baselineCoordinates.set(loc.sensor_id, [lon, lat]);
              }
            }
          } catch {
            // Not GeoJSON geometry
          }
        }
      }
    }

    if (options.previousLocations) {
      const locs = options.previousLocations instanceof Map
        ? options.previousLocations.values()
        : options.previousLocations;
      for (const loc of locs) {
        if (loc.valid_to === null) {
          this.knownLocations.set(loc.sensor_id, loc);
        } else {
          this.historicalLocations.push(loc);
        }
      }
    } else if (!this.isolated) {
      for (const [k, v] of PedestrianLocationsConnector.sharedKnownLocations) {
        this.knownLocations.set(k, v);
      }
      for (const h of PedestrianLocationsConnector.sharedHistoricalLocations) {
        this.historicalLocations.push(h);
      }
    }
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

    if (input.checkpoint) {
      try {
        const parsed = JSON.parse(input.checkpoint);
        const locs = Array.isArray(parsed)
          ? parsed
          : (parsed && typeof parsed === 'object' && Array.isArray(parsed.locations) ? parsed.locations : null);
        if (locs) {
          for (const loc of locs) {
            if (loc && typeof loc === 'object' && typeof loc.sensor_id === 'string') {
              const sensorLoc = loc as SensorLocation;
              if (sensorLoc.valid_to === null) {
                this.knownLocations.set(sensorLoc.sensor_id, sensorLoc);
              } else {
                this.historicalLocations.push(sensorLoc);
              }
            }
          }
        }
      } catch {
        // Not a JSON checkpoint
      }
    }

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
      const sensorLocations: SensorLocation[] = [];
      const closedLocations: SensorLocation[] = [];
      const geoRecords: GeoRecord[] = [];
      const geoRecordSources: GeoRecordSource[] = [];
      const seen = new Set<number>();

      for (const unknownRow of response.records) {
        const row = rowSchema.parse(unknownRow);

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

        const previousLocation = this.knownLocations.get(sensorId);
        const isRelocated = previousLocation !== undefined && geometryChanged(previousLocation.geometry_geojson, geometry);
        const isStatusTransition = previousLocation !== undefined && statusChanged(previousLocation.device_status, deviceStatus);

        // Check if coordinates differ from known initial installation coordinates on cold start
        const canonicalCoords = this.baselineCoordinates.get(sensorId) ?? CANONICAL_INSTALLATION_COORDINATES[sensorId];
        const hasBaselineEvidence = canonicalCoords !== undefined && hasPoint;
        const canonicalDiffers = hasBaselineEvidence
          && coordsDiffer(canonicalCoords[0], canonicalCoords[1], lon, lat);
        const relocationDeclared = isRelocationIndicated(row.note, row.sensor_description);

        // A sensor has relocated coordinates on cold start if:
        // 1. Its coordinates differ from known initial installation coordinates (canonicalDiffers), OR
        // 2. Its note/description explicitly indicates it was moved/relocated
        //    (even if current coordinates match original baseline, e.g. returning to original site after moving).
        const isColdStartRelocated = previousLocation === undefined
          && (relocationDeclared || canonicalDiffers);

        // Effective dates:
        // Distinguish device installation date from coordinate valid interval.
        // Never invent dates from natural-language notes.
        // When no explicit official relocation date is provided across versions,
        // DO NOT backdate new coordinates to the original installation date,
        // and DO NOT claim fetch time is official move time.
        let validFrom: string;
        let timeMissingReason: string | null = 'The location row has no per-row source update timestamp';

        if (row.valid_from) {
          const t = Date.parse(row.valid_from);
          if (!Number.isFinite(t)) {
            return failure(input, 'validation_failed', `Sensor ${row.location_id} has invalid valid_from timestamp: ${row.valid_from}`);
          }
          validFrom = new Date(t).toISOString();
          timeMissingReason = null;
        } else if (isRelocated || isStatusTransition) {
          validFrom = response.fetchedAt;
          timeMissingReason = isRelocated
            ? 'Relocation detected across versions without official relocation date; valid_from reflects earliest observed snapshot timestamp, not official relocation time'
            : 'Status transition detected across versions without official change date; valid_from reflects earliest observed snapshot timestamp';
        } else if (isColdStartRelocated) {
          validFrom = response.fetchedAt;
          timeMissingReason = 'Relocation detected on cold start without official migration date; valid_from reflects earliest observed snapshot timestamp, not official relocation time or device installation date';
        } else if (previousLocation) {
          validFrom = previousLocation.valid_from;
        } else {
          validFrom = response.fetchedAt;
          timeMissingReason = 'Current coordinates first observed in this snapshot; installation date and matching baseline coordinates do not establish the historical coordinate interval';
        }

        let validTo: string | null = null;
        if (row.valid_to) {
          const t = Date.parse(row.valid_to);
          if (!Number.isFinite(t)) {
            return failure(input, 'validation_failed', `Sensor ${row.location_id} has invalid valid_to timestamp: ${row.valid_to}`);
          }
          validTo = new Date(t).toISOString();
        }

        if (validTo !== null && Date.parse(validTo) < Date.parse(validFrom)) {
          return failure(input, 'validation_failed', `valid_to precedes valid_from for sensor ${row.location_id}`);
        }

        // Close previous location interval accurately
        if (previousLocation && (isRelocated || isStatusTransition)) {
          if (row.valid_from) {
            (previousLocation as { valid_to: string | null }).valid_to = validFrom;
          } else {
            const prevEnd = previousLocation.source_updated_at ?? previousLocation.fetched_at;
            const prevEndMs = Date.parse(prevEnd);
            const prevFromMs = Date.parse(previousLocation.valid_from);
            (previousLocation as { valid_to: string | null }).valid_to =
              prevEndMs >= prevFromMs ? prevEnd : previousLocation.valid_from;
          }
          const closedLocation: SensorLocation = {
            ...previousLocation,
            batch_id: input.runId,
          };
          closedLocations.push(closedLocation);
          this.historicalLocations.push(closedLocation);
          if (!this.isolated) {
            PedestrianLocationsConnector.sharedHistoricalLocations.push(closedLocation);
          }
        }

        const recordId = sourceRecordId({
          sourceId: SOURCE_ID,
          nativeId: sensorId,
          originalUrl: LANDING_URL,
          sourceTime: null,
        });

        // Version ID captures source revision time and canonical row content.
        // If a sensor moves to new coordinates or properties change, a new version ID is produced.
        const versionId = sourceVersionId(sourceUpdatedAt, row);

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
          rights_status: 'review_required',
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
        this.knownLocations.set(sensorId, currentLocation);
        if (!this.isolated) {
          PedestrianLocationsConnector.sharedKnownLocations.set(sensorId, currentLocation);
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
          rights_status: 'review_required',
          public_query_allowed: false,
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

      const checkpointAfter = input.window.kind === 'time'
        ? input.window.to
        : (input.window.revision === 'latest' ? (sourceUpdatedAt ?? response.fetchedAt) : input.window.revision);

      return {
        kind: 'success',
        sourceId: SOURCE_ID,
        runId: input.runId,
        fetchedAt: response.fetchedAt,
        sourceRevision: sourceUpdatedAt ?? response.fetchedAt,
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
        outputCount: sourceRecords.length,
        rejectedCount: 0,
        sourceRecords,
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
