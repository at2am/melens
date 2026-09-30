import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Storage } from '@google-cloud/storage';
import { z } from 'zod';

import { loadConfig } from '../core/config.js';
import { loadSourceRegistry } from '../core/registry.js';
import { ingest } from './ingest.js';
import { GcsScheduledRequestStore, withScheduledRequestGuard } from './scheduled-guard.js';

const sourceId = z.string().regex(/^[a-z][a-z0-9]*(?:[._][a-z0-9]+)*$/);
const positiveSeconds = z.coerce.number().int().positive().max(31_536_000);
const nonnegativeSeconds = z.coerce.number().int().nonnegative().max(86_400);
const positiveRequests = z.coerce.number().int().positive().max(1_000_000_000);
const jobConfig = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('time'),
    sourceId,
    intervalSeconds: positiveSeconds,
    overlapSeconds: nonnegativeSeconds,
    dailyRequestCap: positiveRequests,
    executionRequestCap: positiveRequests,
  }),
  z.object({
    mode: z.literal('snapshot'),
    sourceId,
    revision: z.string().trim().min(1).max(128),
    dailyRequestCap: positiveRequests,
    executionRequestCap: positiveRequests,
  }),
]);

export type ScheduledJobConfig = z.infer<typeof jobConfig>;

/** Cloud Scheduler can retry a trigger. Aligning the window makes retries idempotent. */
export function scheduledWindow(
  now: Date,
  intervalSeconds: number,
  overlapSeconds: number,
): { from: string; to: string } {
  positiveSeconds.parse(intervalSeconds);
  nonnegativeSeconds.parse(overlapSeconds);
  const nowMs = now.getTime();
  if (!Number.isFinite(nowMs)) throw new Error('Invalid schedule clock');
  const intervalMs = intervalSeconds * 1000;
  const endMs = Math.floor(nowMs / intervalMs) * intervalMs;
  if (endMs <= intervalMs + overlapSeconds * 1000) throw new Error('Invalid schedule window');
  return {
    from: new Date(endMs - intervalMs - overlapSeconds * 1000).toISOString(),
    to: new Date(endMs).toISOString(),
  };
}

export function parseScheduledJobConfig(env: NodeJS.ProcessEnv): ScheduledJobConfig {
  const mode = env.MELENS_SCHEDULE_MODE;
  if (mode === 'time') {
    return jobConfig.parse({
      mode,
      sourceId: env.MELENS_SOURCE_ID,
      intervalSeconds: env.MELENS_INTERVAL_SECONDS,
      overlapSeconds: env.MELENS_OVERLAP_SECONDS ?? 0,
      dailyRequestCap: env.MELENS_REQUEST_CAP_PER_DAY,
      executionRequestCap: env.MELENS_MAX_REQUESTS_PER_EXECUTION,
    });
  }
  if (mode === 'snapshot') {
    return jobConfig.parse({
      mode,
      sourceId: env.MELENS_SOURCE_ID,
      revision: env.MELENS_SNAPSHOT_REVISION,
      dailyRequestCap: env.MELENS_REQUEST_CAP_PER_DAY,
      executionRequestCap: env.MELENS_MAX_REQUESTS_PER_EXECUTION,
    });
  }
  throw new Error('MELENS_SCHEDULE_MODE must be time or snapshot');
}

export async function scheduledRun(env: NodeJS.ProcessEnv = process.env, now = new Date()): Promise<void> {
  const config = parseScheduledJobConfig(env);
  const connectorsRoot = join(dirname(fileURLToPath(import.meta.url)), '../connectors');
  const registry = await loadSourceRegistry(connectorsRoot);
  const source = registry.get(config.sourceId)?.dataSource;
  if (!source || source.source_id !== config.sourceId) throw new Error('Unknown scheduled source');
  if (source.access_status !== 'active' || source.license_status === 'review_required'
    || source.admission_evidence.missing_requirements.length > 0) {
    throw new Error(`Source admission is incomplete: ${config.sourceId}`);
  }
  const reviewedCap = source.admission_evidence.quota_requests_per_day;
  if (reviewedCap === null || config.dailyRequestCap > reviewedCap) {
    throw new Error(`Scheduled request cap exceeds reviewed source quota: ${config.sourceId}`);
  }
  const cloud = loadConfig(env);
  if (cloud.maxBytesBilled === null) {
    throw new Error(`Scheduled BigQuery query ceiling is missing: ${config.sourceId}`);
  }
  const store = new GcsScheduledRequestStore(new Storage({ projectId: cloud.projectId }), cloud.bucketName);
  const run = async (args: readonly string[]): Promise<void> => ingest(args,
    work => withScheduledRequestGuard(store, {
      sourceId: config.sourceId,
      dailyCap: config.dailyRequestCap,
      executionCap: config.executionRequestCap,
    }, work), env);
  if (config.mode === 'time') {
    if (source.coverage_from === null) {
      throw new Error(`Time source requires a reviewed initial cursor: ${config.sourceId}`);
    }
    const window = scheduledWindow(now, config.intervalSeconds, config.overlapSeconds);
    await run(['--source', config.sourceId, '--from', window.from, '--to', window.to]);
  } else {
    await run(['--source', config.sourceId, '--revision', config.revision]);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  scheduledRun().catch(error => {
    process.stderr.write(`${error instanceof Error ? error.message : 'Scheduled ingestion failed'}\n`);
    process.exitCode = 1;
  });
}
