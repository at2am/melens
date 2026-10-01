import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Storage } from '@google-cloud/storage';
import { z } from 'zod';

import { parseConnectorInput } from '../core/connector.js';
import { loadConfig, type DataConfig } from '../core/config.js';
import { loadSourceRegistry } from '../core/registry.js';
import { ingest } from './ingest.js';
import { parseScheduledJobConfig, type ScheduledJobConfig } from './scheduled.js';
import { GcsScheduledRequestStore, RequestCapReached, withScheduledIngestionGuard,
  type ScheduledRequestStore } from './scheduled-guard.js';

class ManualIngestionError extends Error {}

export interface ManualRunDependencies {
  createRequestStore(config: DataConfig): ScheduledRequestStore;
  ingest: typeof ingest;
}

const dependencies: ManualRunDependencies = {
  createRequestStore: config => new GcsScheduledRequestStore(
    new Storage({ projectId: config.projectId }), config.bucketName),
  ingest,
};

function validateArguments(args: readonly string[], config: ScheduledJobConfig): void {
  const flags = new Map<string, string | true>();
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token || flags.has(token)) throw new Error('Invalid argument');
    if (token === '--backfill') { flags.set(token, true); continue; }
    if (!['--source', '--from', '--to', '--revision', '--initial-cursor'].includes(token)) {
      throw new Error('Invalid argument');
    }
    const value = args[++index];
    if (!value || value.startsWith('--')) throw new Error('Missing argument');
    flags.set(token, value);
  }
  if (flags.get('--source') !== config.sourceId) {
    throw new ManualIngestionError('Manual source must equal the deployed source');
  }
  const from = flags.get('--from');
  const to = flags.get('--to');
  const revision = flags.get('--revision');
  const initialCursor = flags.get('--initial-cursor');
  if (config.mode === 'time') {
    if (typeof from !== 'string' || typeof to !== 'string' || revision !== undefined) {
      throw new Error('Invalid time arguments');
    }
    parseConnectorInput({ sourceId: config.sourceId,
      window: { kind: 'time', from, to }, checkpoint: null, runId: 'manual-validation' });
    if (initialCursor !== undefined) {
      z.iso.datetime({ offset: false }).parse(initialCursor);
      if (typeof initialCursor !== 'string' || Date.parse(initialCursor) > Date.parse(from)) {
        throw new Error('Invalid initial cursor');
      }
    }
    if (config.sourceId === 'gdelt.news') {
      const interval = 900_000;
      const count = (Date.parse(to) - Date.parse(from)) / interval;
      if (Date.parse(from) % interval !== 0 || Date.parse(to) % interval !== 0
        || count < 1 || count > 16 || count > config.executionRequestCap) {
        throw new Error('Invalid GDELT window');
      }
    }
  } else {
    if (from !== undefined || to !== undefined || initialCursor !== undefined || flags.has('--backfill')) {
      throw new Error('Invalid snapshot arguments');
    }
    z.string().trim().min(1).max(128).parse(revision);
    parseConnectorInput({ sourceId: config.sourceId,
      window: { kind: 'snapshot', revision }, checkpoint: null, runId: 'manual-validation' });
  }
}

/** Manual first collection and backfills share the deployed source lease and request ledger. */
export async function manualRun(args: readonly string[], env: NodeJS.ProcessEnv = process.env,
  runtime: ManualRunDependencies = dependencies): Promise<void> {
  try {
    let config: ScheduledJobConfig;
    try {
      config = parseScheduledJobConfig(env);
      if (config.executionRequestCap > config.dailyRequestCap) throw new Error('Invalid caps');
    } catch { throw new ManualIngestionError('Invalid manual job configuration'); }
    try { validateArguments(args, config); }
    catch (error) {
      if (error instanceof ManualIngestionError) throw error;
      throw new ManualIngestionError('Invalid manual ingestion arguments');
    }

    const connectorsRoot = join(dirname(fileURLToPath(import.meta.url)), '../connectors');
    const registry = await loadSourceRegistry(connectorsRoot);
    const source = registry.get(config.sourceId)?.dataSource;
    if (!source || source.source_id !== config.sourceId || source.access_status !== 'active'
      || source.license_status === 'review_required'
      || source.admission_evidence.missing_requirements.length > 0) {
      throw new ManualIngestionError('Manual source admission is incomplete');
    }
    const reviewedCap = source.admission_evidence.quota_requests_per_day;
    if (reviewedCap === null || config.dailyRequestCap > reviewedCap) {
      throw new ManualIngestionError('Manual request cap exceeds reviewed source quota');
    }
    if (config.mode === 'time' && source.coverage_from === null) {
      throw new ManualIngestionError('Manual time source requires a reviewed initial cursor');
    }
    const cloud = loadConfig(env);
    if (cloud.maxBytesBilled === null || cloud.maxBytesBilled === undefined) {
      throw new ManualIngestionError('Manual BigQuery query ceiling is missing');
    }
    const store = runtime.createRequestStore(cloud);
    await withScheduledIngestionGuard(store, {
      sourceId: config.sourceId, dailyCap: config.dailyRequestCap,
      executionCap: config.executionRequestCap,
    }, collect => runtime.ingest(args, collect, env));
  } catch (error) {
    if (error instanceof ManualIngestionError) throw error;
    if (error instanceof RequestCapReached) throw new ManualIngestionError('Manual request quota reached');
    throw new ManualIngestionError('Manual ingestion failed');
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  manualRun(process.argv.slice(2)).catch(error => {
    const message = error instanceof ManualIngestionError ? error.message : 'Manual ingestion failed';
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
