import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { BigQuery } from '@google-cloud/bigquery';
import { Storage } from '@google-cloud/storage';

import { parseConnectorInput, type ConnectorInput } from '../core/connector.js';
import { loadConfig } from '../core/config.js';
import { GcsStore } from '../core/gcs.js';
import { BigQueryPublisher } from '../core/publisher.js';
import { loadConnector, loadSourceRegistry } from '../core/registry.js';
import type { CsaSuccess } from '../connectors/csa_recorded_offences/index.js';
import { normalizeCsaStatistics } from '../normalization/area-indicators.js';

function options(args: readonly string[]): Map<string, string | true> {
  const result = new Map<string, string | true>();
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token?.startsWith('--')) throw new Error('Expected named arguments');
    if (token === '--backfill') {
      result.set(token, true);
      continue;
    }
    const value = args[++index];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${token}`);
    if (!['--source', '--from', '--to', '--revision', '--initial-cursor'].includes(token)) {
      throw new Error(`Unknown option ${token}`);
    }
    result.set(token, value);
  }
  return result;
}

function required(map: ReadonlyMap<string, string | true>, key: string): string {
  const value = map.get(key);
  if (typeof value !== 'string') throw new Error(`Missing ${key}`);
  return value;
}

export async function ingest(args: readonly string[],
  collectGuard: <T>(work: () => Promise<T>) => Promise<T> = work => work(),
  env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const flags = options(args);
  const config = loadConfig(env);
  if (config.maxBytesBilled === null || config.maxBytesBilled === undefined) {
    throw new Error('BQ_MAXIMUM_BYTES_BILLED is required for ingestion');
  }
  const connectorsRoot = join(dirname(fileURLToPath(import.meta.url)), '../connectors');
  const registry = await loadSourceRegistry(connectorsRoot);
  const entry = registry.get(required(flags, '--source'));
  if (!entry) throw new Error('Unknown source ID');
  const source = entry.dataSource;
  if (source.license_status === 'review_required' || source.access_status !== 'active') {
    throw new Error(`Source admission is incomplete: ${source.source_id}`);
  }
  const from = flags.get('--from');
  const to = flags.get('--to');
  const revision = flags.get('--revision');
  if ((from === undefined) !== (to === undefined)) throw new Error('--from and --to must appear together');
  if (from !== undefined && revision !== undefined) throw new Error('Choose a time window or revision');
  if (from === undefined && revision === undefined) {
    throw new Error('Specify --from and --to, or an explicit --revision for a snapshot');
  }
  if (flags.has('--backfill') && from === undefined) throw new Error('--backfill requires --from and --to');
  if (flags.has('--initial-cursor') && from === undefined) {
    throw new Error('--initial-cursor requires --from and --to');
  }
  const window: ConnectorInput['window'] = typeof from === 'string' && typeof to === 'string'
    ? { kind: 'time', from, to }
    : { kind: 'snapshot', revision: required(flags, '--revision') };
  const storage = new Storage({ projectId: config.projectId });
  const gcs = new GcsStore(storage, config.bucketName);
  const explicitCursor = flags.get('--initial-cursor');
  const initialCheckpoint = window.kind === 'time'
    ? (typeof explicitCursor === 'string' ? explicitCursor : source.coverage_from) : null;
  if (initialCheckpoint !== null && window.kind === 'time'
    && (!Number.isFinite(Date.parse(initialCheckpoint))
      || !initialCheckpoint.endsWith('Z')
      || Date.parse(initialCheckpoint) > Date.parse(window.from))) {
    throw new Error('Initial cursor must be a UTC timestamp no later than --from');
  }
  const checkpointState = window.kind === 'time'
    ? await gcs.readCheckpoint(source.source_id, initialCheckpoint ?? window.from) : null;
  if (checkpointState?.generation === '0' && initialCheckpoint === null) {
    throw new Error('First time-window ingest requires --initial-cursor when source coverage_from is unknown');
  }
  if (checkpointState?.generation !== '0' && typeof explicitCursor === 'string') {
    throw new Error('--initial-cursor is only valid before the first published time window');
  }
  const checkpoint = checkpointState?.manifest.checkpoint ?? null;
  const runId = `run_${createHash('sha256').update(`${source.source_id}\n${JSON.stringify(window)}`)
    .digest('hex').slice(0, 40)}`;
  const input = parseConnectorInput({ sourceId: source.source_id, window, checkpoint, runId });
  const connector = await loadConnector(entry);
  // Only source collection consumes the upstream request quota. Google Cloud
  // publication and checkpoint calls are not upstream source requests.
  const result = await collectGuard(() => connector.collect(input));
  const publisher = new BigQueryPublisher(config, new BigQuery({ projectId: config.projectId }), gcs);
  if (result.kind === 'failure') {
    await publisher.recordConnectorFailure(source, result,
      window.kind === 'time' ? window.from : null,
      window.kind === 'time' ? window.to : null);
    throw new Error(`Connector failed: ${result.code}`);
  }
  // CSA's official Table 01 omits a boundary code and vintage. Retain its
  // statistical area name and mark the boundary mapping unresolved until the
  // exact source geography is documented; never attach a current LGA by guess.
  const normalized = source.source_id === 'victoria.csa.recorded_offences'
    ? normalizeCsaStatistics(result as CsaSuccess) : null;
  const publishable = normalized === null ? result : {
    ...result, areaIndicators: normalized.indicators,
    outputCount: result.outputCount + normalized.indicators.length,
  };
  const batch = await publisher.publish({ source, result: publishable,
    windowFrom: window.kind === 'time' ? window.from : null,
    windowTo: window.kind === 'time' ? window.to : null,
    initialCheckpoint: window.kind === 'time' ? initialCheckpoint ?? window.from : null });
  process.stdout.write(JSON.stringify({ source_id: source.source_id, batch_id: batch.batch_id,
    state: batch.state, input_count: batch.input_count, output_count: batch.output_count,
    rejected_count: batch.rejected_count, checkpoint_after: batch.checkpoint_after }) + '\n');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  ingest(process.argv.slice(2)).catch(error => {
    const message = error instanceof Error ? error.message : 'Unknown ingestion failure';
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
