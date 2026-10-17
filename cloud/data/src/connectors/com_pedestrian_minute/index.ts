import { z } from 'zod';
import { readFile } from 'node:fs/promises';

import type { Connector, ConnectorInput, ConnectorResult } from '../../core/connector.js';
import { parseSourceManifest } from '../../core/registry.js';
import { HttpClient, HttpFailure } from '../../core/http.js';
import { OdsIncompleteWindow, OpenDataSoftClient } from '../../core/opendatasoft.js';
import type { PedestrianObservation, SourceRecord } from '../../core/types.js';
import { sourceRecordId, sourceVersionId } from '../../validation/record.js';

export const SOURCE_ID = 'melbourne.pedestrian.minute';
export const DATASET_ID = 'pedestrian-counting-system-past-hour-counts-per-minute';
export const LANDING_URL = `https://data.melbourne.vic.gov.au/explore/dataset/${DATASET_ID}/`;
export const DEFAULT_PORTAL_URL = 'https://data.melbourne.vic.gov.au';
export const OVERLAP_MS = 15 * 60_000;
export const SOURCE_WINDOW_MS = 60 * 60_000;

export const rowSchema = z.object({
  location_id: z.number().int().nonnegative(),
  sensing_datetime: z.iso.datetime({ offset: true }),
  sensing_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  sensing_time: z.string().regex(/^\d{2}:\d{2}(?::\d{2})?$/).optional(),
  direction_1: z.number().int().nonnegative().nullable().optional(),
  direction_2: z.number().int().nonnegative().nullable().optional(),
  total_of_directions: z.number().int().nonnegative().nullable().optional(),
}).passthrough();

export type PedestrianMinuteRow = z.infer<typeof rowSchema>;

export function parsePedestrianMinuteRow(value: unknown): PedestrianMinuteRow {
  return rowSchema.parse(value);
}

/**
 * Validates that if sensing_date or sensing_time are provided upstream,
 * they agree with sensing_datetime in Melbourne local time (handling AEST / AEDT DST).
 */
export function validateMelbourneSensingDateTime(row: {
  sensing_datetime: string;
  sensing_date?: string | undefined;
  sensing_time?: string | undefined;
}): boolean {
  if (!row.sensing_date && !row.sensing_time) return true;
  const timeMs = Date.parse(row.sensing_datetime);
  if (!Number.isFinite(timeMs)) return false;

  const dtf = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Australia/Melbourne',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const parts = dtf.formatToParts(new Date(timeMs));
  const getPart = (type: Intl.DateTimeFormatPartTypes) => parts.find(p => p.type === type)?.value ?? '00';
  const localDate = `${getPart('year')}-${getPart('month')}-${getPart('day')}`;
  const localTime = `${getPart('hour')}:${getPart('minute')}`;

  if (row.sensing_date && row.sensing_date !== localDate) {
    return false;
  }
  if (row.sensing_time) {
    const normalizedTime = row.sensing_time.slice(0, 5);
    if (normalizedTime !== localTime) {
      return false;
    }
  }
  return true;
}

function failure(
  input: ConnectorInput,
  code: 'rate_limited' | 'upstream_unavailable' | 'schema_changed' | 'auth_failed' | 'incomplete_window' | 'validation_failed',
  message: string,
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
      evidence: 'The requested minute window was not fully collected',
    },
    sourceLatestUpdateAt: null,
  };
}

export interface PedestrianMinuteConnectorOptions {
  portalUrl?: string;
  client?: OpenDataSoftClient;
  http?: HttpClient;
  overlapMs?: number;
  sourceWindowMs?: number;
  clampToAvailable?: boolean;
}

export class PedestrianMinuteConnector implements Connector {
  readonly sourceId = SOURCE_ID;
  private readonly portalUrl: string;
  private readonly client: OpenDataSoftClient;
  private readonly http: HttpClient;
  private readonly overlapMs: number;
  private readonly sourceWindowMs: number;
  private readonly clampToAvailable: boolean;

  constructor(options: PedestrianMinuteConnectorOptions = {}) {
    this.portalUrl = options.portalUrl ?? DEFAULT_PORTAL_URL;
    this.http = options.http ?? new HttpClient();
    this.client = options.client ?? new OpenDataSoftClient(this.http);
    this.overlapMs = options.overlapMs ?? OVERLAP_MS;
    this.sourceWindowMs = options.sourceWindowMs ?? SOURCE_WINDOW_MS;
    this.clampToAvailable = options.clampToAvailable ?? false;
  }

  async collect(input: ConnectorInput): Promise<ConnectorResult> {
    if (input.sourceId !== SOURCE_ID || input.window.kind !== 'time') {
      return failure(input, 'validation_failed', 'A canonical source ID and UTC time window are required');
    }
    // Records carry the source's reviewed licence, as the parking connectors do; review_required
    // until admission, after which the serving views can publish them.
    const rights = await reviewedRights();
    try {
      const latestUrl = new URL(`/api/explore/v2.1/catalog/datasets/${DATASET_ID}/records`, this.portalUrl);
      latestUrl.searchParams.set('order_by', 'sensing_datetime DESC');
      latestUrl.searchParams.set('limit', '1');
      const latestResponse = await this.http.getJson({ url: latestUrl });
      const latest = z.object({ results: z.array(rowSchema) }).safeParse(latestResponse.body);
      if (!latest.success) {
        return failure(input, 'schema_changed', 'The upstream past-hour feed schema has changed');
      }
      if (latest.data.results.length === 0) {
        return failure(input, 'upstream_unavailable', 'The upstream past-hour feed has no records');
      }
      const latestRow = latest.data.results[0];
      if (latestRow === undefined) {
        return failure(input, 'upstream_unavailable', 'The upstream feed has no latest record');
      }
      const latestObservedAt = new Date(latestRow.sensing_datetime).toISOString();
      const latestObservedMs = Date.parse(latestObservedAt);
      const upstreamLatestAvailableMs = latestObservedMs + 60_000;
      const upstreamLatestAvailable = new Date(upstreamLatestAvailableMs).toISOString();

      const overlapFrom = new Date(Date.parse(input.window.from) - this.overlapMs);
      if (overlapFrom.getTime() < latestObservedMs - this.sourceWindowMs) {
        return failure(input, 'incomplete_window', 'Requested minutes have expired from the past-hour feed');
      }
      if (Date.parse(input.window.from) >= upstreamLatestAvailableMs) {
        return failure(input, 'incomplete_window', 'Requested window is in the future relative to upstream feed');
      }

      let effectiveTo = input.window.to;
      if (Date.parse(input.window.to) > upstreamLatestAvailableMs) {
        if (!this.clampToAvailable) {
          return failure(input, 'incomplete_window', 'Requested window end exceeds latest upstream available minute');
        }
        effectiveTo = upstreamLatestAvailable;
      }

      const where = `sensing_datetime >= '${overlapFrom.toISOString()}' AND sensing_datetime < '${effectiveTo}'`;
      const response = await this.client.fetchRecords({
        portalUrl: this.portalUrl,
        datasetId: DATASET_ID,
        where,
        orderBy: 'sensing_datetime ASC, location_id ASC',
      });
      // The feed sometimes carries a sensor-minute twice: a partial reading and then a fuller one (on
      // 2026-10-17, 7 and then 32 at one sensor). A reading at least as large in both directions
      // replaces the other; two readings that each exceed the other in a direction still fail closed.
      const readings = new Map<string, { row: z.infer<typeof rowSchema>; versionId: string; observedAt: string; sensorId: string }>();
      let superseded = 0;
      for (const unknownRow of response.records) {
        const row = rowSchema.parse(unknownRow);
        if (!validateMelbourneSensingDateTime(row)) {
          return failure(input, 'validation_failed', 'Upstream sensing date or time conflicts with UTC timestamp');
        }
        if (row.direction_1 !== null && row.direction_1 !== undefined
          && row.direction_2 !== null && row.direction_2 !== undefined
          && row.total_of_directions !== null && row.total_of_directions !== undefined
          && row.direction_1 + row.direction_2 !== row.total_of_directions) {
          return failure(input, 'validation_failed', 'Upstream direction counts conflict with total');
        }
        const observedAt = new Date(row.sensing_datetime).toISOString();
        const sensorId = String(row.location_id);
        const recordId = sourceRecordId({
          sourceId: SOURCE_ID,
          nativeId: `${sensorId}:${observedAt}`,
          originalUrl: LANDING_URL,
          sourceTime: observedAt,
        });
        const versionId = sourceVersionId(observedAt, row);
        const earlier = readings.get(recordId);
        if (earlier !== undefined) {
          if (earlier.versionId === versionId) continue;
          if (dominates(row, earlier.row)) {
            readings.set(recordId, { row, versionId, observedAt, sensorId });
            superseded += 1;
            continue;
          }
          if (dominates(earlier.row, row)) {
            superseded += 1;
            continue;
          }
          return failure(input, 'validation_failed', 'Conflicting duplicate sensor-minute readings');
        }
        readings.set(recordId, { row, versionId, observedAt, sensorId });
      }
      const sourceRecords: SourceRecord[] = [];
      const pedestrianObservations: PedestrianObservation[] = [];
      for (const [recordId, { row, versionId, observedAt, sensorId }] of readings) {
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
          time_missing_reason: null,
          valid_from: null,
          valid_to: null,
          source_updated_at: observedAt,
          source_version_ordinal: null,
          record_status: 'active',
          assertion_kind: 'observation',
          rights_status: rights,
        });
        pedestrianObservations.push({
          batch_id: input.runId,
          source_id: SOURCE_ID,
          schema_version: 1,
          fetched_at: response.fetchedAt,
          sensor_id: sensorId,
          observed_at: observedAt,
          version_id: versionId,
          direction_a_count: row.direction_1 ?? null,
          direction_b_count: row.direction_2 ?? null,
          total_count: row.total_of_directions ?? null,
          source_record_id: recordId,
        });
      }
      return {
        kind: 'success',
        sourceId: SOURCE_ID,
        runId: input.runId,
        fetchedAt: response.fetchedAt,
        sourceRevision: latestObservedAt,
        sourceLatestUpdateAt: latestObservedAt,
        checkpointAfter: effectiveTo,
        completeness: {
          complete: true,
          method: 'pagination',
          expected_records: response.totalCount,
          fetched_records: response.records.length,
          expected_pages: response.pageCount,
          fetched_pages: response.pageCount,
          evidence: effectiveTo === input.window.to
            ? 'All filtered OpenDataSoft pages matched total_count'
            : 'Window clamped to latest available upstream minute; all pages matched total_count',
        },
        inputCount: response.records.length,
        outputCount: sourceRecords.length,
        rejectedCount: 0,
        sourceRecords,
        geoRecords: [],
        geoRecordSources: [],
        boundaries: [],
        areaIndicators: [],
        parkingBays: [],
        parkingObservations: [],
        parkingRules: [],
        sensorLocations: [],
        pedestrianObservations,
        retainableRawRecords: null,
      };
    } catch (error) {
      const code = error instanceof OdsIncompleteWindow ? 'incomplete_window'
        : error instanceof HttpFailure ? error.code
        : error instanceof z.ZodError ? 'schema_changed' : 'validation_failed';
      return failure(
        input,
        code,
        error instanceof Error ? error.message : 'Pedestrian minute feed could not be validated',
        error instanceof HttpFailure && error.retryAfterMs !== null ? Math.ceil(error.retryAfterMs / 1000) : null,
      );
    }
  }
}

/** Whether [a] counts at least as many passages as [b] in each direction (so [b] is a partial [a]). */
function dominates(a: { direction_1?: number | null | undefined; direction_2?: number | null | undefined },
  b: { direction_1?: number | null | undefined; direction_2?: number | null | undefined }): boolean {
  const counts = [a.direction_1, a.direction_2, b.direction_1, b.direction_2];
  if (counts.some((count) => count === null || count === undefined)) return false;
  return a.direction_1! >= b.direction_1! && a.direction_2! >= b.direction_2!;
}

/** The licence the reviewed manifest declares, read beside the compiled connector. */
async function reviewedRights() {
  return parseSourceManifest(JSON.parse(await readFile(new URL('./source.json', import.meta.url), 'utf8'))).license_status;
}

export function createConnector(options: PedestrianMinuteConnectorOptions = {}): Connector {
  return new PedestrianMinuteConnector(options);
}

export const connector: Connector = createConnector();
