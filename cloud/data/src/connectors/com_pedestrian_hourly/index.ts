import { createHash } from 'node:crypto';

import { z } from 'zod';

import type { Connector, ConnectorInput, ConnectorResult } from '../../core/connector.js';
import { HttpClient, HttpFailure } from '../../core/http.js';
import { OdsIncompleteWindow, OpenDataSoftClient } from '../../core/opendatasoft.js';
import type { PedestrianObservation, SourceRecord } from '../../core/types.js';
import { sourceRecordId, sourceVersionId } from '../../validation/record.js';

export const SOURCE_ID = 'melbourne.pedestrian.hourly';
export const DATASET_ID = 'pedestrian-counting-system-monthly-counts-per-hour';
export const LANDING_URL = `https://data.melbourne.vic.gov.au/explore/dataset/${DATASET_ID}/`;
export const DEFAULT_PORTAL_URL = 'https://data.melbourne.vic.gov.au';

export const rowSchema = z.object({
  id: z.union([z.number().int(), z.string()]).nullable().optional(),
  location_id: z.number().int().nonnegative(),
  sensing_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  hourday: z.number().int().min(0).max(23),
  direction_1: z.number().int().nonnegative().nullable().optional(),
  direction_2: z.number().int().nonnegative().nullable().optional(),
  pedestriancount: z.number().int().nonnegative().nullable().optional(),
  sensor_name: z.string().nullable().optional(),
  location: z.object({
    lon: z.number().finite().min(-180).max(180),
    lat: z.number().finite().min(-90).max(90),
  }).nullable().optional(),
}).passthrough();

export type PedestrianHourlyRow = z.infer<typeof rowSchema>;

export function parsePedestrianHourlyRow(value: unknown): PedestrianHourlyRow {
  return rowSchema.parse(value);
}

/** Reject a repeated or nonexistent daylight-saving hour without inventing UTC. */
export function melbourneHourToUtc(sensingDate: string, hourday: number): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const localStr = `${sensingDate}T${pad(hourday)}:00:00`;
  const localAsUtc = Date.parse(`${localStr}Z`);
  if (!Number.isFinite(localAsUtc) || hourday < 0 || hourday > 23 || !Number.isInteger(hourday)) {
    throw new Error('Invalid Melbourne local sensor hour');
  }
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
  const matches = [10, 11].map(hours => localAsUtc - hours * 3600_000)
    .filter(utcMs => {
      const parts = dtf.formatToParts(new Date(utcMs));
      const getPart = (type: Intl.DateTimeFormatPartTypes) =>
        parts.find(p => p.type === type)?.value ?? '00';
      const formattedLocal = `${getPart('year')}-${getPart('month')}-${getPart('day')}`
        + `T${getPart('hour')}:${getPart('minute')}:${getPart('second')}`;
      return formattedLocal === localStr;
    });
  if (matches.length !== 1 || matches[0] === undefined) {
    throw new Error(`Melbourne sensor hour is ambiguous or nonexistent: ${localStr}`);
  }
  return new Date(matches[0]).toISOString();
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
      evidence: 'Hourly pedestrian counts could not be validated or collected',
    },
    sourceLatestUpdateAt: null,
  };
}

export interface HourlyConnectorOptions {
  portalUrl?: string;
  client?: OpenDataSoftClient;
  http?: HttpClient;
}

export class PedestrianHourlyConnector implements Connector {
  readonly sourceId = SOURCE_ID;
  private readonly portalUrl: string;
  private readonly client: OpenDataSoftClient;
  private readonly http: HttpClient;

  constructor(options: HourlyConnectorOptions = {}) {
    this.portalUrl = options.portalUrl ?? DEFAULT_PORTAL_URL;
    this.client = options.client ?? new OpenDataSoftClient();
    this.http = options.http ?? new HttpClient();
  }

  async collect(input: ConnectorInput): Promise<ConnectorResult> {
    if (input.sourceId !== SOURCE_ID) {
      return failure(input, 'validation_failed', `Expected source ID ${SOURCE_ID}, got ${input.sourceId}`);
    }

    try {
      let where: string | undefined;
      let fromMs: number | null = null;
      let toMs: number | null = null;
      let targetRevision: string | null = null;
      let latestSensingDate: string | null = null;

      if (input.window.kind === 'time') {
        fromMs = Date.parse(input.window.from);
        toMs = Date.parse(input.window.to);
        const dtfDate = new Intl.DateTimeFormat('en-CA', {
          timeZone: 'Australia/Melbourne',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        });
        const fromDateStr = dtfDate.format(new Date(fromMs));
        const toDateStr = dtfDate.format(new Date(toMs - 1));
        where = fromDateStr === toDateStr
          ? `sensing_date = date'${fromDateStr}'`
          : `sensing_date >= date'${fromDateStr}' AND sensing_date <= date'${toDateStr}'`;
      } else if (input.window.kind === 'snapshot') {
        targetRevision = input.window.revision;
        if (input.window.revision === 'latest') {
          const latestUrl = new URL(`${this.portalUrl}/api/explore/v2.1/catalog/datasets/${DATASET_ID}/records`);
          latestUrl.searchParams.set('order_by', 'sensing_date DESC, hourday DESC');
          latestUrl.searchParams.set('limit', '1');
          const latest = z.object({ results: z.array(rowSchema) }).parse(
            (await this.http.getJson({ url: latestUrl })).body,
          );
          if (latest.results.length === 0 || !latest.results[0]) {
            return failure(input, 'upstream_unavailable', 'The upstream hourly feed has no records');
          }
          const latestRow = latest.results[0];
          latestSensingDate = latestRow.sensing_date;
          where = `sensing_date = date'${latestRow.sensing_date}'`;
        } else if (/^\d{4}-\d{2}-\d{2}$/.test(input.window.revision)) {
          where = `sensing_date = date'${input.window.revision}'`;
        } else {
          return failure(input, 'validation_failed',
            'Hourly snapshot revision must be latest or a YYYY-MM-DD sensing date');
        }
      }

      const response = await this.client.fetchRecords({
        portalUrl: this.portalUrl,
        datasetId: DATASET_ID,
        ...(where ? { where } : {}),
        orderBy: 'sensing_date ASC, hourday ASC, location_id ASC',
      });

      const sourceUpdatedAt = response.lastModified && !Number.isNaN(Date.parse(response.lastModified))
        ? new Date(response.lastModified).toISOString()
        : null;

      const sourceRecords: SourceRecord[] = [];
      const pedestrianObservations: PedestrianObservation[] = [];
      const seen = new Map<string, string>();
      let maxObservedAt: string | null = null;

      for (const unknownRow of response.records) {
        const row = rowSchema.parse(unknownRow);
        const observedAt = melbourneHourToUtc(row.sensing_date, row.hourday);

        if (fromMs !== null && toMs !== null) {
          const obsMs = Date.parse(observedAt);
          if (obsMs < fromMs || obsMs >= toMs) {
            continue;
          }
        }

        if (row.direction_1 !== null && row.direction_1 !== undefined
          && row.direction_2 !== null && row.direction_2 !== undefined
          && row.pedestriancount !== null && row.pedestriancount !== undefined
          && row.direction_1 + row.direction_2 !== row.pedestriancount) {
          return failure(input, 'validation_failed', 'Upstream direction counts conflict with total');
        }

        const sensorId = String(row.location_id);
        const nativeId = row.id !== undefined && row.id !== null ? String(row.id) : `${sensorId}:${observedAt}`;
        const recordId = sourceRecordId({
          sourceId: SOURCE_ID,
          nativeId,
          originalUrl: LANDING_URL,
          sourceTime: observedAt,
        });
        const versionId = sourceVersionId(sourceUpdatedAt, row);

        const earlier = seen.get(recordId);
        if (earlier !== undefined) {
          if (earlier !== versionId) {
            return failure(input, 'validation_failed', 'Conflicting duplicate sensor-hour readings');
          }
          continue;
        }
        seen.set(recordId, versionId);

        if (maxObservedAt === null || observedAt > maxObservedAt) {
          maxObservedAt = observedAt;
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
          observed_at: observedAt,
          first_accessible_at: null,
          time_missing_reason: null,
          valid_from: null,
          valid_to: null,
          source_updated_at: sourceUpdatedAt,
          source_version_ordinal: null,
          record_status: 'active',
          assertion_kind: 'observation',
          rights_status: 'review_required',
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
          total_count: row.pedestriancount ?? null,
          source_record_id: recordId,
        });
      }

      const contentDigest = createHash('sha256')
        .update(sourceRecords.map(r => r.version_id).sort().join('\n'))
        .digest('hex');

      const baseRevision = targetRevision === 'latest'
        ? (sourceUpdatedAt ?? latestSensingDate ?? 'latest')
        : (targetRevision ?? sourceUpdatedAt ?? (input.window.kind === 'time' ? `${input.window.from}_${input.window.to}` : 'hourly'));

      const sourceRevision = `${baseRevision}@${contentDigest}`;
      const sourceLatestUpdateAt = sourceUpdatedAt;
      const checkpointAfter = input.window.kind === 'time'
        ? input.window.to
        : (targetRevision === 'latest' ? (latestSensingDate ?? sourceRevision) : (targetRevision ?? sourceRevision));

      return {
        kind: 'success',
        sourceId: SOURCE_ID,
        runId: input.runId,
        fetchedAt: response.fetchedAt,
        sourceRevision,
        sourceLatestUpdateAt,
        checkpointAfter,
        completeness: {
          complete: true,
          method: 'pagination',
          expected_records: response.totalCount,
          fetched_records: response.records.length,
          expected_pages: response.pageCount,
          fetched_pages: response.pageCount,
          evidence: 'All filtered OpenDataSoft pages matched total_count',
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
      const retryAfterSeconds = error instanceof HttpFailure && error.retryAfterMs !== null
        ? Math.ceil(error.retryAfterMs / 1000)
        : null;
      return failure(
        input,
        code,
        error instanceof Error ? error.message : 'Pedestrian hourly feed could not be validated',
        retryAfterSeconds,
      );
    }
  }
}

export function createConnector(options: HourlyConnectorOptions = {}): Connector {
  return new PedestrianHourlyConnector(options);
}

export const connector: Connector = new PedestrianHourlyConnector();
