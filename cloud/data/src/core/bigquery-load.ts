import { createHash } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';

import { BigQuery, type JobMetadata } from '@google-cloud/bigquery';

const TABLES = new Set([
  'data_sources', 'sync_batches', 'source_records', 'geo_records',
  'geo_record_sources', 'boundaries', 'area_indicators', 'parking_bays',
  'parking_observations', 'parking_rules', 'sensor_locations',
  'pedestrian_observations',
]);
const RETRYABLE_REASONS = new Set(['backendError', 'internalError', 'rateLimitExceeded', 'jobRateLimitExceeded']);

function errorCode(error: unknown): number | null {
  if (typeof error !== 'object' || error === null || !('code' in error)) return null;
  const code = error.code;
  return typeof code === 'number' ? code : typeof code === 'string' ? Number(code) : null;
}

export function stableLoadJobId(batchId: string, table: string, uri: string): string {
  const digest = createHash('sha256').update(`${batchId}\n${table}\n${uri}`).digest('hex');
  return `melens_load_${digest.slice(0, 48)}`;
}

export interface LoadResult {
  jobId: string;
  outputRows: number;
}

/** Uncertain submissions reuse an ID; only a confirmed failed job permits the next ID. */
export async function loadNdjson(input: {
  bigquery: BigQuery;
  dataset: string;
  table: string;
  batchId: string;
  uri: string;
  location: 'australia-southeast2';
}): Promise<LoadResult> {
  if (!TABLES.has(input.table)) throw new Error('Unknown destination table');
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(input.dataset)) throw new Error('Invalid dataset');
  if (!/^[A-Za-z0-9._-]+$/.test(input.batchId)) throw new Error('Invalid batch ID');
  if (!/^gs:\/\/[a-z0-9][a-z0-9._-]+\/[^*?#]+\.ndjson$/.test(input.uri)) {
    throw new Error('Invalid staging URI');
  }
  const projectId = await input.bigquery.getProjectId();
  const load = {
    destinationTable: { projectId, datasetId: input.dataset, tableId: input.table },
    sourceUris: [input.uri], sourceFormat: 'NEWLINE_DELIMITED_JSON',
    writeDisposition: 'WRITE_APPEND', createDisposition: 'CREATE_NEVER',
    ignoreUnknownValues: false, maxBadRecords: 0, autodetect: false,
  };
  const baseId = stableLoadJobId(input.batchId, input.table, input.uri);
  let freshFailures = 0;
  for (let attempt = 0; attempt < 128; attempt += 1) {
    const jobId = attempt === 0 ? baseId : `${baseId}_retry_${attempt}`;
    let metadata: JobMetadata | undefined;
    let created = false;
    for (let submission = 0; submission < 4; submission += 1) {
      try {
        await input.bigquery.createJob({ jobId, location: input.location, configuration: { load } });
        created = true;
        break;
      } catch (error) {
        // A timeout may have occurred after jobs.insert succeeded. Never pick a new ID here.
        if (errorCode(error) === 409) { created = submission > 0; break; }
        if (![429, 500, 502, 503, 504].includes(errorCode(error) ?? -1) || submission === 3) throw error;
        await sleep(250 * 2 ** submission);
      }
    }
    const job = input.bigquery.job(jobId, { location: input.location });
    for (let poll = 0; poll < 120; poll += 1) {
      try {
        [metadata] = await job.getMetadata();
      } catch (error) {
        if (![429, 500, 502, 503, 504].includes(errorCode(error) ?? -1)) throw error;
        await sleep(1000);
        continue;
      }
      const actual = metadata?.configuration?.load;
      if (!actual || actual.sourceUris?.length !== 1 || actual.sourceUris[0] !== input.uri
        || actual.destinationTable?.projectId !== projectId
        || actual.destinationTable.datasetId !== input.dataset || actual.destinationTable.tableId !== input.table
        || actual.sourceFormat !== load.sourceFormat || actual.writeDisposition !== load.writeDisposition
        || actual.createDisposition !== load.createDisposition || actual.ignoreUnknownValues === true
        || actual.autodetect === true || Number(actual.maxBadRecords ?? 0) !== 0) {
        throw new Error('Existing load job configuration differs');
      }
      if (metadata?.status?.state === 'DONE') break;
      await sleep(1000);
    }
    if (!metadata || metadata.status?.state !== 'DONE') throw new Error('Load job did not complete');
    const reason = metadata.status.errorResult?.reason;
    if (metadata.status.errorResult) {
      if (reason && RETRYABLE_REASONS.has(reason)) {
        if (created) freshFailures += 1;
        if (freshFailures < 4) continue;
      }
      throw new Error(`Load job failed: ${reason ?? 'unknown'}`);
    }
    const outputRows = Number(metadata.statistics?.load?.outputRows ?? NaN);
    if (!Number.isSafeInteger(outputRows) || outputRows < 0) throw new Error('Invalid load row count');
    return { jobId, outputRows };
  }
  throw new Error('Load job failed-attempt history exceeds reconciliation limit');
}
