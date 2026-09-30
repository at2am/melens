import { z } from 'zod';

import type { Connector, ConnectorInput, ConnectorResult } from '../../core/connector.js';
import { HttpClient, HttpFailure } from '../../core/http.js';
import { OdsIncompleteWindow, OpenDataSoftClient } from '../../core/opendatasoft.js';
import type { PedestrianObservation, SourceRecord } from '../../core/types.js';
import { sourceRecordId, sourceVersionId } from '../../validation/record.js';

const SOURCE_ID = 'melbourne.pedestrian.minute';
const DATASET_ID = 'pedestrian-counting-system-past-hour-counts-per-minute';
const LANDING_URL = `https://data.melbourne.vic.gov.au/explore/dataset/${DATASET_ID}/`;
const OVERLAP_MS = 15 * 60_000;
const SOURCE_WINDOW_MS = 60 * 60_000;

const rowSchema = z.object({
  location_id: z.number().int().nonnegative(),
  sensing_datetime: z.iso.datetime({ offset: true }),
  direction_1: z.number().int().nonnegative().nullable(),
  direction_2: z.number().int().nonnegative().nullable(),
  total_of_directions: z.number().int().nonnegative().nullable(),
}).passthrough();

function failure(input: ConnectorInput, code: 'rate_limited' | 'upstream_unavailable' | 'schema_changed'
  | 'auth_failed' | 'incomplete_window' | 'validation_failed', message: string): ConnectorResult {
  return { kind: 'failure', sourceId: SOURCE_ID, runId: input.runId,
    checkedAt: new Date().toISOString(), code, message, retryAfterSeconds: null,
    completeness: { complete: false, expected_records: null, fetched_records: 0,
      expected_pages: null, fetched_pages: 0, evidence: 'The requested minute window was not fully collected' },
    sourceLatestUpdateAt: null };
}

/** Latest-hour feed; a missing minute is not a zero count. */
export const connector: Connector = {
  sourceId: SOURCE_ID,
  async collect(input: ConnectorInput): Promise<ConnectorResult> {
    if (input.sourceId !== SOURCE_ID || input.window.kind !== 'time') {
      return failure(input, 'validation_failed', 'A canonical source ID and UTC time window are required');
    }
    const client = new OpenDataSoftClient();
    try {
      const latestUrl = new URL(`https://data.melbourne.vic.gov.au/api/explore/v2.1/catalog/datasets/${DATASET_ID}/records`);
      latestUrl.searchParams.set('order_by', 'sensing_datetime DESC');
      latestUrl.searchParams.set('limit', '1');
      const latest = z.object({ results: z.array(rowSchema) }).parse(
        (await new HttpClient().getJson({ url: latestUrl })).body);
      if (latest.results.length === 0) {
        return failure(input, 'upstream_unavailable', 'The upstream past-hour feed has no records');
      }
      const latestRow = latest.results[0];
      if (latestRow === undefined) return failure(input, 'upstream_unavailable', 'The upstream feed has no latest record');
      const latestObservedAt = new Date(latestRow.sensing_datetime).toISOString();
      const overlapFrom = new Date(Date.parse(input.window.from) - OVERLAP_MS);
      if (overlapFrom.getTime() < Date.parse(latestObservedAt) - SOURCE_WINDOW_MS) {
        return failure(input, 'incomplete_window', 'Requested minutes have expired from the past-hour feed');
      }
      const where = `sensing_datetime >= '${overlapFrom.toISOString()}' AND sensing_datetime < '${input.window.to}'`;
      const response = await client.fetchRecords({ portalUrl: 'https://data.melbourne.vic.gov.au',
        datasetId: DATASET_ID, where, orderBy: 'sensing_datetime ASC, location_id ASC' });
      const sourceRecords: SourceRecord[] = [];
      const pedestrianObservations: PedestrianObservation[] = [];
      const seen = new Map<string, string>();
      for (const unknownRow of response.records) {
        const row = rowSchema.parse(unknownRow);
        const observedAt = new Date(row.sensing_datetime).toISOString();
        if (row.direction_1 !== null && row.direction_2 !== null
          && row.total_of_directions !== null
          && row.direction_1 + row.direction_2 !== row.total_of_directions) {
          return failure(input, 'validation_failed', 'Upstream direction counts conflict with total');
        }
        const sensorId = String(row.location_id);
        const recordId = sourceRecordId({ sourceId: SOURCE_ID,
          nativeId: `${sensorId}:${observedAt}`, originalUrl: LANDING_URL, sourceTime: observedAt });
        const versionId = sourceVersionId(observedAt, row);
        const earlier = seen.get(recordId);
        if (earlier !== undefined) {
          if (earlier !== versionId) {
            return failure(input, 'validation_failed', 'Conflicting duplicate sensor-minute readings');
          }
          continue;
        }
        seen.set(recordId, versionId);
        sourceRecords.push({ batch_id: input.runId, source_id: SOURCE_ID, schema_version: 1,
          fetched_at: response.fetchedAt, source_record_id: recordId, version_id: versionId,
          original_url: LANDING_URL, raw_uri: null, published_at: null, observed_at: observedAt,
          first_accessible_at: null, time_missing_reason: null, valid_from: null, valid_to: null,
          source_updated_at: observedAt, source_version_ordinal: null, record_status: 'active',
          assertion_kind: 'observation', rights_status: 'review_required' });
        pedestrianObservations.push({ batch_id: input.runId, source_id: SOURCE_ID, schema_version: 1,
          fetched_at: response.fetchedAt, sensor_id: sensorId, observed_at: observedAt,
          version_id: versionId,
          direction_a_count: row.direction_1, direction_b_count: row.direction_2,
          total_count: row.total_of_directions, source_record_id: recordId });
      }
      return { kind: 'success', sourceId: SOURCE_ID, runId: input.runId,
        fetchedAt: response.fetchedAt, sourceRevision: latestObservedAt,
        sourceLatestUpdateAt: latestObservedAt, checkpointAfter: input.window.to,
        completeness: { complete: true, method: 'pagination', expected_records: response.totalCount,
          fetched_records: response.records.length, expected_pages: response.pageCount,
          fetched_pages: response.pageCount, evidence: 'All filtered OpenDataSoft pages matched total_count' },
        inputCount: response.records.length, outputCount: sourceRecords.length, rejectedCount: 0,
        sourceRecords, geoRecords: [], geoRecordSources: [], boundaries: [], areaIndicators: [],
        parkingBays: [], parkingObservations: [], parkingRules: [], sensorLocations: [],
        pedestrianObservations, retainableRawRecords: null };
    } catch (error) {
      const code = error instanceof OdsIncompleteWindow ? 'incomplete_window'
        : error instanceof HttpFailure ? error.code
          : error instanceof z.ZodError ? 'schema_changed' : 'validation_failed';
      return failure(input, code, 'Pedestrian minute feed could not be validated');
    }
  },
};
