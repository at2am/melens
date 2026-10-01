import { z } from 'zod';

import type { Connector, ConnectorInput, ConnectorResult } from '../../core/connector.js';
import { HttpFailure } from '../../core/http.js';
import { OdsIncompleteWindow, OpenDataSoftClient } from '../../core/opendatasoft.js';
import type { GeoRecord, GeoRecordSource, ParkingObservation, SourceRecord } from '../../core/types.js';
import { sourceRecordId, sourceVersionId } from '../../validation/record.js';

export const SOURCE_ID = 'melbourne.parking.sensors';
export const DATASET_ID = 'on-street-parking-bay-sensors';
export const LANDING_URL = `https://data.melbourne.vic.gov.au/explore/dataset/${DATASET_ID}/`;

export const rowSchema = z.object({
  kerbsideid: z.union([
    z.number().int().nonnegative(),
    z.string().trim().min(1, 'kerbsideid must not be empty'),
  ]),
  lastupdated: z.iso.datetime({ offset: true }),
  status_timestamp: z.iso.datetime({ offset: true }).nullable().optional(),
  observed_at: z.iso.datetime({ offset: true }).nullable().optional(),
  status_description: z.string().nullable().optional(),
  occupied: z.boolean().nullable().optional(),
  marker_id: z.union([z.string(), z.number()]).nullable().optional(),
  markerid: z.union([z.string(), z.number()]).nullable().optional(),
  bay_id: z.union([z.string(), z.number()]).nullable().optional(),
  bayid: z.union([z.string(), z.number()]).nullable().optional(),
  zone_number: z.number().int().nullable().optional(),
  location: z.object({
    lon: z.number().finite().min(-180).max(180),
    lat: z.number().finite().min(-90).max(90),
  }).nullable().optional(),
}).passthrough();

export type ParkingSensorRow = z.infer<typeof rowSchema>;

export function parseSensorRow(unknownRow: unknown): ParkingSensorRow {
  return rowSchema.parse(unknownRow);
}

/**
 * Derives occupancy boolean (true / false / null).
 * Missing, fault, or unknown descriptions are kept as null; unrecorded bays are never assumed vacant.
 */
export function deriveOccupancy(
  statusDescription: string | null | undefined,
  explicitOccupied?: boolean | null,
): boolean | null {
  if (explicitOccupied !== undefined) {
    return explicitOccupied;
  }
  if (!statusDescription) {
    return null;
  }
  const normalized = statusDescription.trim().toLowerCase();
  if (normalized === 'present' || normalized === 'occupied') {
    return true;
  }
  if (normalized === 'unoccupied' || normalized === 'vacant' || normalized === 'empty') {
    return false;
  }
  return null;
}

/**
 * Extracts marker and bay identifiers from sensor row data.
 * Missing or empty marker_id or bay_id MUST remain null - never fall back to sensorKey
 * or claim an unverified bay join.
 */
export function extractMarkerAndBayId(row: {
  kerbsideid: number | string;
  marker_id?: string | number | null | undefined;
  markerid?: string | number | null | undefined;
  bay_id?: string | number | null | undefined;
  bayid?: string | number | null | undefined;
}): { sensorKey: string; markerId: string | null; bayId: string | null } {
  const kerbsideStr = String(row.kerbsideid).trim();
  if (kerbsideStr.length === 0) {
    throw new Error('kerbsideid must not be empty');
  }
  const sensorKey = `kerbside:${kerbsideStr}`;

  const rawMarker = row.marker_id ?? row.markerid;
  const markerId = rawMarker != null && String(rawMarker).trim().length > 0
    ? String(rawMarker).trim()
    : null;

  const rawBay = row.bay_id ?? row.bayid;
  const bayId = rawBay != null && String(rawBay).trim().length > 0
    ? String(rawBay).trim()
    : null;

  return { sensorKey, markerId, bayId };
}

export function computeUpstreamLatency(record: {
  source_updated_at: string | null;
  observed_at: string | null;
  fetched_at?: string | null;
}): {
  sensorToSourceLatencySeconds: number | null;
  sourceToFetchLatencySeconds: number | null;
  totalLatencySeconds: number | null;
} {
  const observedMs = record.observed_at ? Date.parse(record.observed_at) : Number.NaN;
  const updatedMs = record.source_updated_at ? Date.parse(record.source_updated_at) : Number.NaN;
  const fetchedMs = record.fetched_at ? Date.parse(record.fetched_at) : Number.NaN;

  const sensorToSourceLatencySeconds = Number.isFinite(observedMs) && Number.isFinite(updatedMs)
    ? Math.max(0, Math.round((updatedMs - observedMs) / 1000))
    : null;

  const sourceToFetchLatencySeconds = Number.isFinite(updatedMs) && Number.isFinite(fetchedMs)
    ? Math.max(0, Math.round((fetchedMs - updatedMs) / 1000))
    : null;

  const totalLatencySeconds = Number.isFinite(observedMs) && Number.isFinite(fetchedMs)
    ? Math.max(0, Math.round((fetchedMs - observedMs) / 1000))
    : null;

  return { sensorToSourceLatencySeconds, sourceToFetchLatencySeconds, totalLatencySeconds };
}

function failure(
  input: ConnectorInput,
  code: 'rate_limited' | 'upstream_unavailable' | 'schema_changed' | 'auth_failed' | 'incomplete_window' | 'validation_failed',
  message = 'Parking sensor snapshot could not be validated',
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
      evidence: 'Entire sensor snapshot is required',
    },
    sourceLatestUpdateAt: null,
  };
}

export class ParkingSensorsConnector implements Connector {
  readonly sourceId = SOURCE_ID;

  constructor(private readonly client: OpenDataSoftClient = new OpenDataSoftClient()) {}

  async collect(input: ConnectorInput): Promise<ConnectorResult> {
    if (input.sourceId !== SOURCE_ID) {
      return failure(input, 'validation_failed', `Expected sourceId ${SOURCE_ID}, got ${input.sourceId}`);
    }

    try {
      const response = await this.client.fetchRecords({
        portalUrl: 'https://data.melbourne.vic.gov.au',
        datasetId: DATASET_ID,
        orderBy: 'kerbsideid ASC',
      });

      const sourceRecords: SourceRecord[] = [];
      const parkingObservations: ParkingObservation[] = [];
      const geoRecords: GeoRecord[] = [];
      const geoRecordSources: GeoRecordSource[] = [];
      const seen = new Set<string>();
      let latestUpdate: string | null = null;

      for (const unknownRow of response.records) {
        const row = parseSensorRow(unknownRow);
        const kerbsideKey = String(row.kerbsideid).trim();

        if (seen.has(kerbsideKey)) {
          return failure(input, 'validation_failed', `Duplicate kerbsideid encountered: ${kerbsideKey}`);
        }
        seen.add(kerbsideKey);

        const { sensorKey, markerId, bayId } = extractMarkerAndBayId(row);
        const updatedAt = new Date(row.lastupdated).toISOString();
        const rawObserved = row.status_timestamp ?? row.observed_at;
        const observedAt = rawObserved ? new Date(rawObserved).toISOString() : null;

        if (latestUpdate === null || updatedAt > latestUpdate) {
          latestUpdate = updatedAt;
        }

        const occupied = deriveOccupancy(row.status_description, row.occupied);

        const recordId = sourceRecordId({
          sourceId: SOURCE_ID,
          nativeId: sensorKey,
          originalUrl: LANDING_URL,
          sourceTime: observedAt,
        });
        const versionId = sourceVersionId(updatedAt, row);

        const point = row.location ?? null;
        const geometry = point === null ? null : JSON.stringify({
          type: 'Point',
          coordinates: [point.lon, point.lat],
        });

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
          observed_at: observedAt,
          first_accessible_at: null,
          time_missing_reason: observedAt === null ? 'Status timestamp absent upstream' : null,
          valid_from: null,
          valid_to: null,
          source_updated_at: updatedAt,
          source_version_ordinal: null,
          record_status: 'active',
          assertion_kind: 'observation',
          rights_status: 'review_required',
        });

        if (observedAt !== null) {
          parkingObservations.push({
            batch_id: input.runId,
            source_id: SOURCE_ID,
            schema_version: 1,
            fetched_at: response.fetchedAt,
            sensor_id: sensorKey,
            bay_id: bayId,
            marker_id: markerId,
            observed_at: observedAt,
            occupied,
            source_record_id: recordId,
            version_id: versionId,
          });
        }

        geoRecords.push({
          batch_id: input.runId,
          source_id: SOURCE_ID,
          schema_version: 1,
          fetched_at: response.fetchedAt,
          geo_record_id: recordId,
          version_id: versionId,
          topic: 'parking',
          assertion_kind: 'observation',
          title: null,
          summary: null,
          original_url: LANDING_URL,
          geometry_geojson: geometry,
          centroid_lat: point?.lat ?? null,
          centroid_lon: point?.lon ?? null,
          location_role: point ? 'sensor_site' : 'unknown',
          location_confidence: point ? 'source_coordinate' : 'unverified',
          area_refs: [],
          published_at: null,
          observed_at: observedAt,
          valid_from: null,
          valid_to: null,
          source_updated_at: updatedAt,
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
          fetched_at: response.fetchedAt,
          geo_record_id: recordId,
          version_id: versionId,
          source_record_id: recordId,
          source_version_id: versionId,
          evidence_role: 'official_sensor_coordinate',
          original_url: LANDING_URL,
        });
      }

      return {
        kind: 'success',
        sourceId: SOURCE_ID,
        runId: input.runId,
        fetchedAt: response.fetchedAt,
        sourceRevision: latestUpdate,
        sourceLatestUpdateAt: latestUpdate,
        checkpointAfter: input.window.kind === 'time' ? input.window.to : input.window.revision,
        completeness: {
          complete: true,
          method: 'pagination',
          expected_records: response.totalCount,
          fetched_records: response.records.length,
          expected_pages: response.pageCount,
          fetched_pages: response.pageCount,
          evidence: 'Every page matched the stable kerbsideid-ordered total_count',
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
        parkingObservations,
        parkingRules: [],
        sensorLocations: [],
        pedestrianObservations: [],
        retainableRawRecords: null,
      };
    } catch (error) {
      const code = error instanceof OdsIncompleteWindow ? 'incomplete_window'
        : error instanceof HttpFailure ? error.code
          : error instanceof z.ZodError ? 'schema_changed' : 'validation_failed';
      return failure(input, code, error instanceof Error ? error.message : undefined);
    }
  }
}

export const connector: Connector = new ParkingSensorsConnector();
