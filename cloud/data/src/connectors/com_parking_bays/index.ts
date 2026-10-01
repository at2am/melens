import { z } from 'zod';

import type { Connector, ConnectorInput, ConnectorResult } from '../../core/connector.js';
import { HttpClient, HttpFailure } from '../../core/http.js';
import type { ParkingBay, SourceRecord } from '../../core/types.js';
import { sourceRecordId, sourceVersionId } from '../../validation/record.js';

export const SOURCE_ID = 'melbourne.parking.bays';
export const DATASET_ID = 'on-street-parking-bays';
export const LANDING_URL = `https://data.melbourne.vic.gov.au/explore/dataset/${DATASET_ID}/`;
export const API_BASE = `https://data.melbourne.vic.gov.au/api/explore/v2.1/catalog/datasets/${DATASET_ID}`;

export const rowSchema = z.object({
  roadsegmentid: z.union([z.number().int().nonnegative(), z.string().min(1)]),
  kerbsideid: z.union([z.string(), z.number().int().nonnegative()]).nullable().optional(),
  roadsegmentdescription: z.string().nullable().optional(),
  latitude: z.number().finite().min(-90).max(90).nullable().optional(),
  longitude: z.number().finite().min(-180).max(180).nullable().optional(),
  lastupdated: z.string().nullable().optional(),
  marker_id: z.union([z.string(), z.number()]).nullable().optional(),
  markerid: z.union([z.string(), z.number()]).nullable().optional(),
  location: z.object({
    lat: z.number().finite().min(-90).max(90).nullable().optional(),
    lon: z.number().finite().min(-180).max(180).nullable().optional(),
  }).nullable().optional(),
}).passthrough();

export type BayRow = z.infer<typeof rowSchema>;

export const countSchema = z.object({ total_count: z.number().int().nonnegative() });

export function extractKerbsideId(val: unknown): string | null {
  if (val === null || val === undefined) return null;
  const str = String(val).trim();
  return str.length > 0 ? str : null;
}

export function extractMarkerId(row: {
  marker_id?: unknown;
  markerid?: unknown;
}): string | null {
  const rawMarker = row.marker_id ?? row.markerid;
  if (rawMarker === null || rawMarker === undefined) return null;
  const str = String(rawMarker).trim();
  return str.length > 0 ? str : null;
}

export function hasValidCoordinates(latitude: unknown, longitude: unknown): boolean {
  if (latitude === null || latitude === undefined || longitude === null || longitude === undefined) {
    return false;
  }
  const lat = typeof latitude === 'number' ? latitude : Number(latitude);
  const lon = typeof longitude === 'number' ? longitude : Number(longitude);
  return Number.isFinite(lat) && Number.isFinite(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
}

export function parseBayRow(unknownRow: unknown): BayRow {
  return rowSchema.parse(unknownRow);
}

function failure(
  input: ConnectorInput,
  code:
    | 'rate_limited'
    | 'upstream_unavailable'
    | 'schema_changed'
    | 'auth_failed'
    | 'incomplete_window'
    | 'validation_failed',
  message = 'Parking bay source snapshot could not be validated',
  retryAfterSeconds: number | null = null,
): ConnectorResult {
  return {
    kind: 'failure',
    sourceId: SOURCE_ID,
    runId: input.runId,
    checkedAt: new Date().toISOString(),
    code,
    message,
    retryAfterSeconds,
    completeness: {
      complete: false,
      expected_records: null,
      fetched_records: 0,
      expected_pages: null,
      fetched_pages: 0,
      evidence: 'Full export count and stable native identities required',
    },
    sourceLatestUpdateAt: null,
  };
}

/**
 * Source-faithful parking bays connector.
 * The current export provides point geometry, not bay polygons or a sensor crosswalk.
 * Invariant: marker_id is null unless actual upstream marker is present (the export has none);
 * never manufacture a synthetic marker mapping (e.g. `kerbside:${kerbsideId}`).
 * When kerbsideid is null, parking bay rows with valid coordinates are preserved.
 */
export class ParkingBaysConnector implements Connector {
  readonly sourceId = SOURCE_ID;

  constructor(private readonly http: HttpClient = new HttpClient()) {}

  async collect(input: ConnectorInput): Promise<ConnectorResult> {
    if (input.sourceId !== SOURCE_ID) {
      return failure(input, 'validation_failed', `Expected sourceId ${SOURCE_ID}, got ${input.sourceId}`);
    }

    try {
      const countResponse = await this.http.getJson({ url: `${API_BASE}/records?limit=0` });
      const expectedCount = countSchema.parse(countResponse.body).total_count;
      const exportResponse = await this.http.getJson({ url: `${API_BASE}/exports/json`, timeoutMs: 120_000 });
      const rows = z.array(rowSchema).parse(exportResponse.body);
      if (rows.length !== expectedCount) {
        return failure(input, 'incomplete_window', `Export row count (${rows.length}) did not match total_count (${expectedCount})`);
      }

      const sourceRecords: SourceRecord[] = [];
      const parkingBays: ParkingBay[] = [];
      const seen = new Map<string, string>();

      for (const row of rows) {
        const kerbsideId = extractKerbsideId(row.kerbsideid);
        const markerId = extractMarkerId(row);
        const locObj = row.location && typeof row.location === 'object' ? (row.location as { lat?: unknown; lon?: unknown }) : null;
        const effectiveLat = row.latitude ?? (locObj?.lat !== undefined && locObj.lat !== null ? Number(locObj.lat) : null);
        const effectiveLon = row.longitude ?? (locObj?.lon !== undefined && locObj.lon !== null ? Number(locObj.lon) : null);
        const hasCoords = hasValidCoordinates(effectiveLat, effectiveLon);

        const nativeId = [
          row.roadsegmentid,
          kerbsideId ?? 'null',
          effectiveLat ?? 'null',
          effectiveLon ?? 'null',
        ].join(':');

        const recordId = sourceRecordId({
          sourceId: SOURCE_ID,
          nativeId,
          originalUrl: LANDING_URL,
          sourceTime: null,
        });
        const versionId = sourceVersionId(null, row);

        const earlier = seen.get(recordId);
        if (earlier !== undefined) {
          if (earlier !== versionId) {
            return failure(input, 'validation_failed', `Conflicting duplicate native ID: ${recordId}`);
          }
          continue;
        }
        seen.set(recordId, versionId);

        sourceRecords.push({
          batch_id: input.runId,
          source_id: SOURCE_ID,
          schema_version: 1,
          fetched_at: exportResponse.fetchedAt,
          source_record_id: recordId,
          version_id: versionId,
          original_url: LANDING_URL,
          raw_uri: null,
          published_at: null,
          observed_at: null,
          first_accessible_at: null,
          time_missing_reason: 'The source provides only an unzoned date, not an exact UTC update time',
          valid_from: null,
          valid_to: null,
          source_updated_at: null,
          source_version_ordinal: null,
          record_status: 'active',
          assertion_kind: 'observation',
          rights_status: 'review_required',
        });

        // Requirement 1, 2, 3:
        // - Preserve actual point geometry and missing keys.
        // - Do NOT manufacture a bay polygon or marker mapping.
        //   marker_id is null unless present upstream (export has no marker_id).
        // - When kerbsideid is null, preserve parking bay row if valid coordinates exist.
        if (hasCoords || kerbsideId !== null) {
          const lat = typeof effectiveLat === 'number' ? effectiveLat : Number(effectiveLat);
          const lon = typeof effectiveLon === 'number' ? effectiveLon : Number(effectiveLon);

          parkingBays.push({
            batch_id: input.runId,
            source_id: SOURCE_ID,
            schema_version: 1,
            fetched_at: exportResponse.fetchedAt,
            bay_id: `bay_export:${recordId}`,
            version_id: versionId,
            marker_id: markerId,
            geometry_geojson: hasCoords
              ? JSON.stringify({
                  type: 'Point',
                  coordinates: [lon, lat],
                })
              : null,
            valid_from: null,
            valid_to: null,
            public_access: null,
            source_record_id: recordId,
            source_updated_at: null,
            source_version_ordinal: null,
          });
        }
      }

      return {
        kind: 'success',
        sourceId: SOURCE_ID,
        runId: input.runId,
        fetchedAt: exportResponse.fetchedAt,
        sourceRevision: null,
        sourceLatestUpdateAt: null,
        checkpointAfter: input.window.kind === 'time' ? input.window.to : input.window.revision,
        completeness: {
          complete: true,
          method: 'export_count',
          expected_records: expectedCount,
          fetched_records: rows.length,
          expected_pages: null,
          fetched_pages: 1,
          evidence: 'JSON export row count matched independent records total_count',
        },
        inputCount: rows.length,
        outputCount: sourceRecords.length,
        rejectedCount: 0,
        sourceRecords,
        geoRecords: [],
        geoRecordSources: [],
        boundaries: [],
        areaIndicators: [],
        parkingBays,
        parkingObservations: [],
        parkingRules: [],
        sensorLocations: [],
        pedestrianObservations: [],
        retainableRawRecords: null,
      };
    } catch (error) {
      const code = error instanceof HttpFailure
        ? error.code
        : error instanceof z.ZodError
          ? 'schema_changed'
          : 'validation_failed';
      const retryAfterSeconds = error instanceof HttpFailure && error.retryAfterMs !== null
        ? Math.ceil(error.retryAfterMs / 1000)
        : null;
      return failure(
        input,
        code,
        error instanceof Error ? error.message : undefined,
        retryAfterSeconds,
      );
    }
  }
}

export const connector: Connector = new ParkingBaysConnector();
