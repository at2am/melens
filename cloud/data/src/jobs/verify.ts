import { fileURLToPath } from 'node:url';

import { BigQuery } from '@google-cloud/bigquery';

import { loadConfig } from '../core/config.js';

function timestampValue(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && value !== null && 'value' in value
    && typeof value.value === 'string') return value.value;
  return null;
}

function parseArgs(args: readonly string[]): { source: string; batch: string | null } {
  let source: string | null = null;
  let batch: string | null = null;
  for (let index = 0; index < args.length; index += 2) {
    const option = args[index];
    const value = args[index + 1];
    if (!value) throw new Error(`Missing value for ${option ?? 'option'}`);
    if (option === '--source') source = value;
    else if (option === '--batch') batch = value;
    else throw new Error(`Unknown option ${option ?? ''}`);
  }
  if (!source) throw new Error('Missing --source');
  return { source, batch };
}

export async function verify(args: readonly string[]): Promise<void> {
  const { source, batch } = parseArgs(args);
  const config = loadConfig();
  if (config.maxBytesBilled === null || config.maxBytesBilled === undefined) {
    throw new Error('BQ_MAXIMUM_BYTES_BILLED is required for verification');
  }
  const client = new BigQuery({ projectId: config.projectId });
  const batchFilter = batch === null ? '' : 'AND batch_id = @batch';
  const [batchRows] = await client.query({
    query: `SELECT batch_id, source_id, state, window_from, window_to,
      started_at, finished_at, published_at, input_count, output_count,
      rejected_count, checkpoint_before, checkpoint_after, error_code
      FROM \`${config.projectId}.${config.ingestDataset}.sync_batches\`
      WHERE source_id = @source ${batchFilter}
      QUALIFY ROW_NUMBER() OVER (PARTITION BY batch_id ORDER BY state_updated_at DESC) = 1
      ORDER BY started_at DESC LIMIT 1`,
    params: batch === null ? { source } : { source, batch },
    location: config.region,
    maximumBytesBilled: config.maxBytesBilled,
  });
  const current = batchRows[0];
  if (!current || typeof current.batch_id !== 'string') throw new Error('Batch not found');
  const [counts] = await client.query({
    query: `SELECT COUNT(DISTINCT geo_record_id) AS logical_records,
      COUNT(DISTINCT IF(geometry_geojson IS NOT NULL, geo_record_id, NULL)) AS located_records,
      MAX(published_at) AS latest_source_publication,
      MAX(observed_at) AS latest_source_observation,
      MAX(fetched_at) AS latest_fetch,
      TIMESTAMP_DIFF(MAX(fetched_at), MAX(COALESCE(observed_at, published_at)), SECOND) AS source_delay_seconds,
      COUNTIF(geometry_geojson IS NULL) AS unlocated_rows
      FROM \`${config.projectId}.${config.ingestDataset}.geo_records\`
      WHERE batch_id = @batch AND source_id = @source`,
    params: { source, batch: current.batch_id }, location: config.region,
    maximumBytesBilled: config.maxBytesBilled,
  });
  const summary = counts[0] ?? {};
  process.stdout.write(JSON.stringify({
    source_id: source, batch_id: current.batch_id, state: current.state,
    window_from: current.window_from, window_to: current.window_to,
    started_at: current.started_at, finished_at: current.finished_at,
    published_at: current.published_at, input_count: current.input_count,
    output_count: current.output_count, rejected_count: current.rejected_count,
    checkpoint_before: current.checkpoint_before, checkpoint_after: current.checkpoint_after,
    gap_detected: timestampValue(current.window_from) !== null
      && typeof current.checkpoint_before === 'string'
      && Date.parse(timestampValue(current.window_from) ?? '') > Date.parse(current.checkpoint_before),
    error_code: current.error_code, logical_records: summary.logical_records ?? 0,
    located_records: summary.located_records ?? 0,
    unlocated_rows: summary.unlocated_rows ?? 0,
    latest_source_publication: summary.latest_source_publication ?? null,
    latest_source_observation: summary.latest_source_observation ?? null,
    latest_fetch: summary.latest_fetch ?? null,
    source_delay_seconds: summary.source_delay_seconds ?? null,
  }) + '\n');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  verify(process.argv.slice(2)).catch(error => {
    const message = error instanceof Error ? error.message : 'Unknown verification failure';
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
