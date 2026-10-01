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

export const MAX_HOURLY_SUMMARIES = 50_000;
const checkpointCursorSchema = z.union([z.iso.datetime({ offset: false }), z.iso.date()]);
const hourlyRecordSummarySchema = z.object({
  recordId: z.string().min(1),
  sensorHourKey: z.string().regex(/^\d+:/).refine(key =>
    z.iso.datetime({ offset: false }).safeParse(key.slice(key.indexOf(':') + 1)).success,
  'Invalid sensor-hour timestamp'),
  versionId: z.string().min(1),
  sourceUpdatedAt: z.iso.datetime({ offset: false }).nullable(),
  count: z.number().int().nonnegative().nullable(),
}).strict();
const hourlyCheckpointSchema = z.object({
  cursor: checkpointCursorSchema,
  summaries: z.array(hourlyRecordSummarySchema).max(MAX_HOURLY_SUMMARIES),
}).strict().superRefine((checkpoint, ctx) => {
  const seen = new Set<string>();
  for (const summary of checkpoint.summaries) {
    if (seen.has(summary.sensorHourKey)) {
      ctx.addIssue({ code: 'custom', message: 'Duplicate sensor-hour checkpoint summary' });
    }
    seen.add(summary.sensorHourKey);
  }
});
const previousObservationSchema = z.object({
  source_record_id: z.string().min(1),
  sensor_id: z.string().regex(/^\d+$/),
  observed_at: z.iso.datetime({ offset: false }),
  version_id: z.string().min(1),
  total_count: z.number().int().nonnegative().nullable(),
}).passthrough();
const legacyHourlyCheckpointSchema = z.object({
  previousObservations: z.array(previousObservationSchema).max(MAX_HOURLY_SUMMARIES),
  cursor: checkpointCursorSchema,
}).strict();

export type HourlyRecordSummary = z.infer<typeof hourlyRecordSummarySchema>;
export type HourlyCheckpoint = z.infer<typeof hourlyCheckpointSchema>;

export function parseHourlyCheckpoint(checkpoint: string | null): HourlyCheckpoint | null {
  if (checkpoint === null) return null;
  if (!/^[\[{]/.test(checkpoint.trim())) {
    return { cursor: checkpointCursorSchema.parse(checkpoint), summaries: [] };
  }
  const parsed: unknown = JSON.parse(checkpoint);
  const canonical = hourlyCheckpointSchema.safeParse(parsed);
  if (canonical.success) return canonical.data;
  const legacy = legacyHourlyCheckpointSchema.safeParse(parsed);
  if (!legacy.success) throw new Error('Invalid hourly checkpoint state');
  return hourlyCheckpointSchema.parse({
    cursor: legacy.data.cursor,
    summaries: legacy.data.previousObservations.map(obs => ({
      recordId: obs.source_record_id,
      sensorHourKey: `${obs.sensor_id}:${obs.observed_at}`,
      versionId: obs.version_id,
      sourceUpdatedAt: null,
      count: obs.total_count,
    })),
  });
}

export interface HourlyConnectorOptions {
  portalUrl?: string;
  client?: OpenDataSoftClient;
  http?: HttpClient;
  previousObservations?: readonly PedestrianObservation[];
  isolated?: boolean;
}

export class PedestrianHourlyConnector implements Connector {
  readonly sourceId = SOURCE_ID;
  private readonly portalUrl: string;
  private readonly client: OpenDataSoftClient;
  private readonly http: HttpClient;
  private readonly isolated: boolean;
  private readonly knownSummariesByRecordId = new Map<string, HourlyRecordSummary>();
  private readonly knownSummariesBySensorHour = new Map<string, HourlyRecordSummary>();

  constructor(options: HourlyConnectorOptions = {}) {
    this.portalUrl = options.portalUrl ?? DEFAULT_PORTAL_URL;
    this.client = options.client ?? new OpenDataSoftClient();
    this.http = options.http ?? new HttpClient();
    this.isolated = options.isolated ?? false;

    if (options.previousObservations) {
      for (const obs of options.previousObservations) {
        const summary: HourlyRecordSummary = {
          recordId: obs.source_record_id,
          sensorHourKey: `${obs.sensor_id}:${obs.observed_at}`,
          versionId: obs.version_id,
          sourceUpdatedAt: null,
          count: obs.total_count,
        };
        if (summary.recordId) this.knownSummariesByRecordId.set(summary.recordId, summary);
        this.knownSummariesBySensorHour.set(summary.sensorHourKey, summary);
      }
    }
  }

  getKnownSummaries(): readonly HourlyRecordSummary[] {
    return Array.from(this.knownSummariesBySensorHour.values());
  }

  clearHistory(): void {
    this.knownSummariesByRecordId.clear();
    this.knownSummariesBySensorHour.clear();
  }

  async collect(input: ConnectorInput): Promise<ConnectorResult> {
    if (input.sourceId !== SOURCE_ID) {
      return failure(input, 'validation_failed', `Expected source ID ${SOURCE_ID}, got ${input.sourceId}`);
    }

    try {
      let parsedCheckpoint: HourlyCheckpoint | null;
      try {
        parsedCheckpoint = parseHourlyCheckpoint(input.checkpoint);
      } catch {
        return failure(input, 'validation_failed', 'Invalid hourly checkpoint state');
      }
      if (parsedCheckpoint && parsedCheckpoint.summaries.length > 0) {
        for (const s of parsedCheckpoint.summaries) {
          if (s.recordId) this.knownSummariesByRecordId.set(s.recordId, s);
          if (s.sensorHourKey) this.knownSummariesBySensorHour.set(s.sensorHourKey, s);
        }
      }

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
      const seenSensorHour = new Map<string, string>();
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
        const sensorHourKey = `${sensorId}:${observedAt}`;

        const earlierRecord = seen.get(recordId);
        if (earlierRecord !== undefined) {
          if (earlierRecord !== versionId) {
            return failure(input, 'validation_failed', 'Conflicting duplicate sensor-hour readings');
          }
          continue;
        }

        const earlierSensorHour = seenSensorHour.get(sensorHourKey);
        if (earlierSensorHour !== undefined) {
          if (earlierSensorHour !== versionId) {
            return failure(input, 'validation_failed', 'Conflicting duplicate sensor-hour readings');
          }
          continue;
        }

        const priorSummary = this.knownSummariesBySensorHour.get(sensorHourKey)
          ?? this.knownSummariesByRecordId.get(recordId);

        if (priorSummary !== undefined && priorSummary.versionId !== versionId) {
          if (sourceUpdatedAt === null || priorSummary.sourceUpdatedAt === null) {
            return failure(input, 'validation_failed',
              'Conflicting duplicate sensor-hour readings across versions without revision order');
          }

          const newTimeMs = Date.parse(sourceUpdatedAt);
          const oldTimeMs = Date.parse(priorSummary.sourceUpdatedAt);
          if (!Number.isFinite(newTimeMs) || !Number.isFinite(oldTimeMs)) {
            return failure(input, 'validation_failed',
              'Conflicting duplicate sensor-hour readings across versions without valid revision timestamp');
          }

          if (newTimeMs === oldTimeMs) {
            return failure(input, 'validation_failed',
              'Conflicting duplicate sensor-hour readings with identical revision timestamp');
          }

          if (newTimeMs < oldTimeMs) {
            return failure(input, 'validation_failed',
              'Conflicting duplicate sensor-hour readings with older revision timestamp arriving late');
          }
        }

        seen.set(recordId, versionId);
        seenSensorHour.set(sensorHourKey, versionId);

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

      // Keep only the collected window. Published history for each next window
      // is supplied by the runner rather than accumulated in an unbounded cursor.
      const currentSummaries = pedestrianObservations.map(obs => ({
        recordId: obs.source_record_id,
        sensorHourKey: `${obs.sensor_id}:${obs.observed_at}`,
        versionId: obs.version_id,
        sourceUpdatedAt,
        count: obs.total_count,
      }));
      if (currentSummaries.length > MAX_HOURLY_SUMMARIES) {
        return failure(input, 'incomplete_window', 'Hourly checkpoint window exceeds the bounded summary limit');
      }
      if (!this.isolated) {
        this.clearHistory();
        for (const summary of currentSummaries) {
          this.knownSummariesByRecordId.set(summary.recordId, summary);
          this.knownSummariesBySensorHour.set(summary.sensorHourKey, summary);
        }
      }

      const contentDigest = createHash('sha256')
        .update(sourceRecords.map(r => r.version_id).sort().join('\n'))
        .digest('hex');

      const baseRevision = targetRevision === 'latest'
        ? (sourceUpdatedAt ?? latestSensingDate ?? 'latest')
        : (targetRevision ?? sourceUpdatedAt ?? (input.window.kind === 'time' ? `${input.window.from}_${input.window.to}` : 'hourly'));

      const sourceRevision = `${baseRevision}@${contentDigest}`;
      const sourceLatestUpdateAt = sourceUpdatedAt;
      const baseCursor = input.window.kind === 'time'
        ? input.window.to
        : (targetRevision === 'latest' ? (latestSensingDate ?? sourceRevision) : (targetRevision ?? sourceRevision));

      const checkpointAfter = JSON.stringify({
        cursor: baseCursor,
        summaries: currentSummaries,
      });

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

export function createConnector(options: HourlyConnectorOptions = {}): PedestrianHourlyConnector {
  return new PedestrianHourlyConnector(options);
}

export const connector: Connector = new PedestrianHourlyConnector();
