import { createHash } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { BigQuery } from '@google-cloud/bigquery';
import { Storage } from '@google-cloud/storage';

import { loadConfig } from '../core/config.js';
import { GcsStore } from '../core/gcs.js';
import { BigQueryPublisher } from '../core/publisher.js';
import { loadSourceRegistry } from '../core/registry.js';
import { cleanupSourceContent, SOURCE_RETENTION } from '../core/source-retention.js';

/** A rights request can immediately withdraw the whole Ticketmaster source. */
export async function sourceRetention(args: readonly string[], env = process.env): Promise<void> {
  const config = loadConfig(env);
  const bigquery = new BigQuery({ projectId: config.projectId });
  const gcs = new GcsStore(new Storage({ projectId: config.projectId }), config.bucketName);
  if (args.length === 2 && args[0] === '--withdraw-source' && args[1] === 'ticketmaster.events') {
    const registry = await loadSourceRegistry(join(dirname(fileURLToPath(import.meta.url)), '../connectors'));
    const source = registry.get('ticketmaster.events')?.dataSource;
    if (!source) throw new Error('Ticketmaster source is unavailable');
    const result = await new BigQueryPublisher(config, bigquery, gcs).pauseSource(source);
    process.stdout.write(JSON.stringify({ source_id: source.source_id,
      action: 'withdrawn', deleted_copies: result.deletedCopies }) + '\n');
    return;
  }
  if (args.length) throw new Error('Expected no arguments or --withdraw-source ticketmaster.events');
  // One source failing must not stop the others from being cleaned, or a backlog in one
  // source lets every later source grow. The job still exits non-zero at the end.
  const failures: string[] = [];
  for (const source of Object.keys(SOURCE_RETENTION)) {
    const lease = `source_${createHash('sha256').update(source).digest('hex')}`;
    try {
      let result;
      for (let attempt = 0; attempt < 5; attempt += 1) {
        try {
          result = await gcs.withBatchLease(lease,
            () => cleanupSourceContent(config, bigquery, gcs, source));
          break;
        } catch (error) {
          if (!(error instanceof Error)
            || error.message !== 'Batch publication is already in progress; inspect the job before clearing a stale lease'
            || attempt === 4) throw error;
          await setTimeout(30_000);
        }
      }
      if (!result) throw new Error('Retention lease could not be acquired');
      process.stdout.write(JSON.stringify({ action: 'retention_checked', ...result }) + '\n');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'retention failed';
      process.stderr.write(JSON.stringify({ action: 'retention_failed', source_id: source, message }) + '\n');
      failures.push(source);
    }
  }
  if (failures.length) throw new Error(`Retention failed for: ${failures.join(', ')}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  sourceRetention(process.argv.slice(2)).catch(() => {
    process.stderr.write('Source content retention failed; the per-source retention_failed lines above name the tables\n');
    process.exitCode = 1;
  });
}
