import { fileURLToPath } from 'node:url';

import { Storage } from '@google-cloud/storage';
import { z } from 'zod';

import { GcsStore } from '../core/gcs.js';

const configSchema = z.object({
  GOOGLE_CLOUD_PROJECT: z.string().regex(/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/),
  GCS_BUCKET: z.string().min(3).max(63).regex(/^[a-z0-9][a-z0-9._-]*[a-z0-9]$/),
});

/** A single Cloud Run Job invocation scans at most 1000 staging objects. */
export async function cleanupStaging(
  env: NodeJS.ProcessEnv = process.env,
  storage?: Storage,
  now = new Date(),
): Promise<number> {
  const config = configSchema.parse({
    GOOGLE_CLOUD_PROJECT: env.GOOGLE_CLOUD_PROJECT,
    GCS_BUCKET: env.GCS_BUCKET,
  });
  const store = new GcsStore(storage ?? new Storage({ projectId: config.GOOGLE_CLOUD_PROJECT }), config.GCS_BUCKET);
  return store.cleanupExpired('staging', now, 1000);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  cleanupStaging().then(deleted => {
    process.stdout.write(`Staging cleanup complete: deleted ${deleted} expired objects\n`);
  }).catch(error => {
    process.stderr.write(`${error instanceof Error ? error.message : 'Staging cleanup failed'}\n`);
    process.exitCode = 1;
  });
}
