/**
 * Connector: City of Melbourne Microclimate Sensors (Source #18)
 *
 * Source ID: melbourne.microclimate
 * Upstream Dataset: microclimate-sensors-data (City of Melbourne Explore API)
 * Contract: specs/001-melbourne-data-aggregation/contracts/connector.md
 *
 * Task T054 Requirements:
 *  1. Comply strictly with ConnectorSuccess in core/connector.ts.
 *  2. Map microclimate sensor readings into areaIndicators with standard representation:
 *     - assertion_kind: 'observation'
 *     - numeric values with scientific units: celsius, percent, m_s, ug_m3, decibels
 *     - null readings preserved with status 'missing' or 'suppressed' (never zero-filled)
 *     - sensor site / area identification preserved.
 *  3. Remove extraneous non-standard fields from ConnectorSuccess.
 *  4. Current sensor presence, names, and spatial coordinates are sourced directly from the active
 *     telemetry stream, rejecting deprecated historical sensor location tables as active inventory.
 *  5. Missing coordinates are quarantined with null geometry and centroid without fabricating (0,0).
 *  6. Comply with Connector interface and source.json format, license_status remains review_required.
 */

import { createHash } from 'node:crypto';
import { z } from 'zod';

import type {
  Connector,
  ConnectorErrorCode,
  ConnectorFailure,
  ConnectorInput,
  ConnectorResult,
  ConnectorSuccess,
} from '../../core/connector.js';
import { HttpFailure } from '../../core/http.js';
import { OdsIncompleteWindow, OpenDataSoftClient } from '../../core/opendatasoft.js';
import type {
  AreaIndicator,
  GeoRecord,
  GeoRecordSource,
  SensorLocation,
  SourceRecord,
  UtcTimestamp,
} from '../../core/types.js';
import { sourceRecordId, sourceVersionId } from '../../validation/record.js';

export const SOURCE_ID = 'melbourne.microclimate';
export const DATASET_ID = 'microclimate-sensors-data';
export const LANDING_URL = `https://data.melbourne.vic.gov.au/explore/dataset/${DATASET_ID}/`;
export const DEFAULT_PORTAL_URL = 'https://data.melbourne.vic.gov.au';

export const CADENCE_SECONDS = 900;
export const CADENCE_MS = CADENCE_SECONDS * 1000;
export const ACTIVE_RECENCY_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24 hours

export const ALLOWED_FIELDS = [
  'device_id',
  'received_at',
  'sensorlocation',
  'latlong',
  'minimumwinddirection',
  'averagewinddirection',
  'maximumwinddirection',
  'minimumwindspeed',
  'averagewindspeed',
  'gustwindspeed',
  'airtemperature',
  'relativehumidity',
  'atmosphericpressure',
  'pm25',
  'pm10',
  'noise',
] as const;

const pointSchema = z.object({
  lon: z.number().finite().min(-180).max(180),
  lat: z.number().finite().min(-90).max(90),
});

export const rawRecordSchema = z.object({
  device_id: z.string().trim().min(1),
  received_at: z.iso.datetime({ offset: true }),
  sensorlocation: z.string().nullable().optional(),
  latlong: pointSchema.nullable().optional(),
  minimumwinddirection: z.number().finite().nullable().optional(),
  averagewinddirection: z.number().finite().nullable().optional(),
  maximumwinddirection: z.number().finite().nullable().optional(),
  minimumwindspeed: z.number().finite().nullable().optional(),
  averagewindspeed: z.number().finite().nullable().optional(),
  gustwindspeed: z.number().finite().nullable().optional(),
  airtemperature: z.number().finite().nullable().optional(),
  relativehumidity: z.number().finite().nullable().optional(),
  atmosphericpressure: z.number().finite().nullable().optional(),
  pm25: z.number().finite().nullable().optional(),
  pm10: z.number().finite().nullable().optional(),
  noise: z.number().finite().nullable().optional(),
}).passthrough();

export type ComMicroclimateRawRecord = z.infer<typeof rawRecordSchema>;

export type ObservationMetricStatus = 'observed' | 'missing';

export interface MicroclimateMetric {
  value: number | null;
  unit: string;
  status: ObservationMetricStatus;
}

export interface MicroclimateMetricDefinition {
  metricId: string;
  field: keyof ComMicroclimateRawRecord;
  unit: string;
  definition: string;
}

export const MICROCLIMATE_METRICS: readonly MicroclimateMetricDefinition[] = [
  {
    metricId: 'air_temperature',
    field: 'airtemperature',
    unit: 'celsius',
    definition: 'Ambient air temperature measured by microclimate sensor in degrees Celsius',
  },
  {
    metricId: 'relative_humidity',
    field: 'relativehumidity',
    unit: 'percent',
    definition: 'Relative humidity measured by microclimate sensor in percent',
  },
  {
    metricId: 'atmospheric_pressure',
    field: 'atmosphericpressure',
    unit: 'hPa',
    definition: 'Atmospheric pressure measured by microclimate sensor in hectopascals',
  },
  {
    metricId: 'wind_speed',
    field: 'averagewindspeed',
    unit: 'm_s',
    definition: 'Average wind speed measured by microclimate sensor in meters per second',
  },
  {
    metricId: 'wind_speed_average',
    field: 'averagewindspeed',
    unit: 'm_s',
    definition: 'Average wind speed measured by microclimate sensor in meters per second',
  },
  {
    metricId: 'wind_speed_minimum',
    field: 'minimumwindspeed',
    unit: 'm_s',
    definition: 'Minimum wind speed measured by microclimate sensor in meters per second',
  },
  {
    metricId: 'wind_speed_gust',
    field: 'gustwindspeed',
    unit: 'm_s',
    definition: 'Gust wind speed measured by microclimate sensor in meters per second',
  },
  {
    metricId: 'wind_direction_minimum',
    field: 'minimumwinddirection',
    unit: 'degrees',
    definition: 'Minimum wind direction measured by microclimate sensor in degrees',
  },
  {
    metricId: 'wind_direction_average',
    field: 'averagewinddirection',
    unit: 'degrees',
    definition: 'Average wind direction measured by microclimate sensor in degrees',
  },
  {
    metricId: 'wind_direction_maximum',
    field: 'maximumwinddirection',
    unit: 'degrees',
    definition: 'Maximum wind direction measured by microclimate sensor in degrees',
  },
  {
    metricId: 'pm25',
    field: 'pm25',
    unit: 'ug_m3',
    definition: 'Fine particulate matter PM2.5 measured by microclimate sensor in micrograms per cubic meter',
  },
  {
    metricId: 'pm10',
    field: 'pm10',
    unit: 'ug_m3',
    definition: 'Particulate matter PM10 measured by microclimate sensor in micrograms per cubic meter',
  },
  {
    metricId: 'noise',
    field: 'noise',
    unit: 'decibels',
    definition: 'Ambient noise level measured by microclimate sensor in decibels',
  },
] as const;

export type MicroclimateSuccess = ConnectorSuccess;
export type MicroclimateResult = ConnectorResult;

export interface CollectMicroclimateOptions {
  client?: OpenDataSoftClient;
  portalUrl?: string;
  fixtureRows?: unknown[];
  fetchMetadataRevision?: boolean;
}

export async function fetchMicroclimateDataProcessed(
  client: OpenDataSoftClient = new OpenDataSoftClient(),
  portalUrl: string = DEFAULT_PORTAL_URL,
): Promise<string> {
  return client.fetchDatasetDataProcessed({ portalUrl, datasetId: DATASET_ID });
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function failure(
  input: ConnectorInput,
  code: ConnectorErrorCode,
  message: string,
  retryAfterSeconds: number | null = null,
): ConnectorFailure {
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
      evidence: message,
    },
    sourceLatestUpdateAt: null,
  };
}

/**
 * Wraps raw measurement in MicroclimateMetric.
 * Invariant: Missing or null values remain null with status 'missing', NEVER zero-filled.
 */
export function toMetric(value: number | null | undefined, unit: string): MicroclimateMetric {
  if (value === null || value === undefined || typeof value !== 'number' || !Number.isFinite(value)) {
    return { value: null, unit, status: 'missing' };
  }
  return { value, unit, status: 'observed' };
}

/**
 * Filters raw record to permissible fields declared in source.json.
 */
export function filterRetainableRawRecord(raw: Record<string, unknown>): Record<string, unknown> {
  const filtered: Record<string, unknown> = {};
  for (const field of ALLOWED_FIELDS) {
    if (field in raw) {
      filtered[field] = raw[field];
    }
  }
  return filtered;
}

/**
 * Main collection function for City of Melbourne Microclimate telemetry.
 */
export async function collectMicroclimate(
  input: ConnectorInput,
  options?: CollectMicroclimateOptions,
): Promise<ConnectorResult> {
  if (input.sourceId !== SOURCE_ID) {
    return failure(input, 'validation_failed', `Invalid source ID "${input.sourceId}". Expected "${SOURCE_ID}"`);
  }

  try {
    let records: unknown[];
    let totalCount: number;
    let pageCount: number;
    let fetchedAt: string;
    let lastModified: string | null = null;

    if (options?.fixtureRows) {
      records = options.fixtureRows;
      totalCount = records.length;
      pageCount = 1;
      fetchedAt = new Date().toISOString();
    } else {
      let where: string | undefined;
      if (input.window.kind === 'time') {
        where = `received_at >= '${input.window.from}' AND received_at < '${input.window.to}'`;
      } else if (input.window.kind === 'snapshot') {
        if (input.window.revision.includes('=')) {
          where = input.window.revision;
        } else if (/^\d{4}-\d{2}-\d{2}/.test(input.window.revision)) {
          where = `received_at >= '${input.window.revision}'`;
        }
      }

      const client = options?.client ?? new OpenDataSoftClient();
      const portalUrl = options?.portalUrl ?? DEFAULT_PORTAL_URL;
      const response = await client.fetchRecords({
        portalUrl,
        datasetId: DATASET_ID,
        ...(where ? { where } : {}),
        orderBy: 'received_at ASC, device_id ASC',
      });
      records = response.records;
      totalCount = response.totalCount;
      pageCount = response.pageCount;
      fetchedAt = response.fetchedAt;
      lastModified = response.lastModified;
    }

    const sourceRecords: SourceRecord[] = [];
    const geoRecords: GeoRecord[] = [];
    const geoRecordSources: GeoRecordSource[] = [];
    const sensorLocations: SensorLocation[] = [];
    const areaIndicators: AreaIndicator[] = [];
    const retainableRawRecords: unknown[] = [];

    interface ParsedObservation {
      row: ComMicroclimateRawRecord;
      unknownRow: unknown;
      observedAt: string;
      sensorId: string;
      recordId: string;
      versionId: string;
      geometry: string | null;
      hasPoint: boolean;
      point: { lon: number; lat: number } | null;
    }

    const observations: ParsedObservation[] = [];
    const seen = new Map<string, string>();
    let latestObservedAt: string | null = null;

    for (const unknownRow of records) {
      const row = rawRecordSchema.parse(unknownRow);
      const observedAt = new Date(row.received_at).toISOString();
      const sensorId = row.device_id.trim();

      if (latestObservedAt === null || observedAt > latestObservedAt) {
        latestObservedAt = observedAt;
      }

      const recordId = sourceRecordId({
        sourceId: SOURCE_ID,
        nativeId: `${sensorId}:${observedAt}`,
        originalUrl: LANDING_URL,
        sourceTime: observedAt,
      });
      const versionId = sourceVersionId(observedAt, { observation: row, validity: 'point_observation' });

      const earlier = seen.get(recordId);
      if (earlier !== undefined) {
        if (earlier !== versionId) {
          return failure(input, 'validation_failed', `Conflicting duplicate reading for device ${sensorId} at ${observedAt}`);
        }
        continue;
      }
      seen.set(recordId, versionId);

      const point = row.latlong ?? null;
      const hasPoint = point !== null
        && typeof point.lon === 'number'
        && typeof point.lat === 'number'
        && Number.isFinite(point.lon)
        && Number.isFinite(point.lat)
        && point.lon >= -180 && point.lon <= 180
        && point.lat >= -90 && point.lat <= 90
        && !(point.lon === 0 && point.lat === 0);

      const geometry = hasPoint
        ? JSON.stringify({ type: 'Point', coordinates: [point.lon, point.lat] })
        : null;

      observations.push({
        row,
        unknownRow,
        observedAt,
        sensorId,
        recordId,
        versionId,
        geometry,
        hasPoint,
        point,
      });
    }

    for (const obs of observations) {
      const { row, observedAt, sensorId, recordId, versionId, geometry, hasPoint, point, unknownRow } = obs;

      // Invariant: Historical observations are strictly preserved as immutable observation facts
      sourceRecords.push({
        batch_id: input.runId,
        source_id: SOURCE_ID,
        schema_version: 1,
        fetched_at: fetchedAt,
        source_record_id: recordId,
        version_id: versionId,
        original_url: LANDING_URL,
        raw_uri: null,
        published_at: null,
        observed_at: observedAt,
        first_accessible_at: null,
        time_missing_reason: null,
        valid_from: observedAt,
        valid_to: null,
        source_updated_at: observedAt,
        source_version_ordinal: null,
        record_status: 'active',
        assertion_kind: 'observation',
        rights_status: 'review_required',
      });

      // Telemetry proves a location at this instant, without an asset-status or
      // validity interval. Current recency must be derived in a query, so replay
      // cannot change immutable facts when its fetch time or neighbouring rows change.
      const validTo = observedAt;

      sensorLocations.push({
        batch_id: input.runId,
        source_id: SOURCE_ID,
        schema_version: 1,
        fetched_at: fetchedAt,
        sensor_id: sensorId,
        version_id: versionId,
        geometry_geojson: geometry,
        device_status: null,
        valid_from: observedAt,
        valid_to: validTo,
        source_record_id: recordId,
        source_updated_at: observedAt,
        source_version_ordinal: null,
      });

      const summaryParts = [`Microclimate observation from ${sensorId} at ${row.sensorlocation ?? 'unspecified location'}`];
      const metricSummaries: string[] = [];
      if (row.airtemperature !== null && row.airtemperature !== undefined) {
        metricSummaries.push(`temp: ${row.airtemperature} celsius`);
      }
      if (row.relativehumidity !== null && row.relativehumidity !== undefined) {
        metricSummaries.push(`humidity: ${row.relativehumidity}%`);
      }
      if (row.averagewindspeed !== null && row.averagewindspeed !== undefined) {
        metricSummaries.push(`wind: ${row.averagewindspeed} m_s`);
      }
      if (row.pm25 !== null && row.pm25 !== undefined) {
        metricSummaries.push(`pm25: ${row.pm25} ug_m3`);
      }
      if (row.noise !== null && row.noise !== undefined) {
        metricSummaries.push(`noise: ${row.noise} decibels`);
      }
      if (metricSummaries.length > 0) {
        summaryParts.push(`(${metricSummaries.join(', ')})`);
      }
      const summary = summaryParts.join(' ');

      geoRecords.push({
        batch_id: input.runId,
        source_id: SOURCE_ID,
        schema_version: 1,
        fetched_at: fetchedAt,
        geo_record_id: recordId,
        version_id: versionId,
        topic: 'other',
        assertion_kind: 'observation',
        title: row.sensorlocation ?? `Microclimate Sensor ${sensorId}`,
        summary,
        original_url: LANDING_URL,
        geometry_geojson: geometry,
        centroid_lat: hasPoint ? point!.lat : null,
        centroid_lon: hasPoint ? point!.lon : null,
        location_role: hasPoint ? 'sensor_site' : 'unknown',
        location_confidence: hasPoint ? 'source_coordinate' : 'unverified',
        area_refs: [],
        published_at: null,
        observed_at: observedAt,
        valid_from: observedAt,
        valid_to: validTo,
        source_updated_at: observedAt,
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
        geo_record_id: recordId,
        version_id: versionId,
        source_record_id: recordId,
        source_version_id: versionId,
        evidence_role: 'official_sensor_telemetry',
        original_url: LANDING_URL,
      });

      for (const metric of MICROCLIMATE_METRICS) {
        const rawVal = row[metric.field] as number | null | undefined;
        const parsed = toMetric(rawVal, metric.unit);
        const indicatorId = `${SOURCE_ID}:${sensorId}:${metric.metricId}`;
        const boundaryId = `sensor_site:${sensorId}`;
        const versionId = digest(`${indicatorId}\0${boundaryId}\0${parsed.status}\0${parsed.value}\0${observedAt}`);

        const baseIndicator = {
          batch_id: input.runId,
          source_id: SOURCE_ID,
          schema_version: 1,
          fetched_at: fetchedAt,
          indicator_id: indicatorId,
          version_id: versionId,
          boundary_id: boundaryId,
          period_start: observedAt,
          period_end: observedAt,
          unit: metric.unit,
          assertion_kind: 'observation' as const,
          source_record_id: recordId,
          definition: metric.definition,
          source_area_name: row.sensorlocation ?? null,
          source_area_code: sensorId,
          source_area_vintage: null,
          source_updated_at: observedAt,
          source_version_ordinal: null,
        };

        const indicator: AreaIndicator = parsed.status === 'observed'
          ? { ...baseIndicator, status: 'observed', value: parsed.value as number }
          : { ...baseIndicator, status: 'missing', value: null };

        areaIndicators.push(indicator);
      }

      if (typeof unknownRow === 'object' && unknownRow !== null) {
        retainableRawRecords.push(filterRetainableRawRecord(unknownRow as Record<string, unknown>));
      }
    }

    const checkpointAfter = input.window.kind === 'time'
      ? input.window.to
      : (input.window.revision || latestObservedAt);

    let sourceLatestUpdateAt: string | null = null;
    if (options?.fetchMetadataRevision) {
      try {
        const client = options?.client ?? new OpenDataSoftClient();
        const portalUrl = options?.portalUrl ?? DEFAULT_PORTAL_URL;
        sourceLatestUpdateAt = await fetchMicroclimateDataProcessed(client, portalUrl);
      } catch {
        sourceLatestUpdateAt = null;
      }
    }
    if (!sourceLatestUpdateAt) {
      if (lastModified) {
        try {
          sourceLatestUpdateAt = new Date(lastModified).toISOString();
        } catch {
          sourceLatestUpdateAt = latestObservedAt;
        }
      } else {
        sourceLatestUpdateAt = latestObservedAt;
      }
    }

    const successResult: ConnectorSuccess = {
      kind: 'success',
      sourceId: SOURCE_ID,
      runId: input.runId,
      fetchedAt,
      sourceRevision: latestObservedAt,
      sourceLatestUpdateAt,
      checkpointAfter,
      completeness: {
        complete: true,
        method: 'pagination',
        expected_records: totalCount,
        fetched_records: records.length,
        expected_pages: pageCount,
        fetched_pages: pageCount,
        evidence: 'All filtered OpenDataSoft pages matched total_count',
      },
      inputCount: records.length,
      outputCount: sourceRecords.length,
      rejectedCount: 0,
      sourceRecords,
      geoRecords,
      geoRecordSources,
      boundaries: [],
      areaIndicators,
      parkingBays: [],
      parkingObservations: [],
      parkingRules: [],
      sensorLocations,
      pedestrianObservations: [],
      retainableRawRecords,
    };

    return successResult;
  } catch (error) {
    const code: ConnectorErrorCode = error instanceof OdsIncompleteWindow
      ? 'incomplete_window'
      : error instanceof HttpFailure
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
      error instanceof Error ? error.message : 'Microclimate feed could not be collected',
      retryAfterSeconds,
    );
  }
}

/**
 * Connector class conforming to shared Connector interface.
 */
export class MicroclimateConnector implements Connector {
  readonly sourceId = SOURCE_ID;

  constructor(
    private readonly client: OpenDataSoftClient = new OpenDataSoftClient(),
    private readonly portalUrl: string = DEFAULT_PORTAL_URL,
    private readonly options?: Omit<CollectMicroclimateOptions, 'client' | 'portalUrl'>,
  ) {}

  async collect(input: ConnectorInput): Promise<ConnectorResult> {
    return collectMicroclimate(input, {
      client: this.client,
      portalUrl: this.portalUrl,
      ...this.options,
    });
  }
}

/**
 * Standard Connector instance conforming to Connector interface.
 */
export const connector: Connector = new MicroclimateConnector();

export default connector;
